/**
 * Provider compatibility.
 * Local servers and cloud APIs differ in small, annoying ways: some reject
 * `tools`, some reject `tool_choice`, some ignore `stream`, some choke on
 * `stream_options`. Instead of making the user discover that by hand, a request
 * that fails for one of those reasons is retried without the offending field and
 * the endpoint is remembered as "does not support X" for the rest of the session.
 */

export type Capability = "tools" | "toolChoice" | "streamOptions" | "stream";

interface EndpointCaps {
  tools: boolean;
  toolChoice: boolean;
  streamOptions: boolean;
  stream: boolean;
  /** Human-readable notes, e.g. "no function calling - using the text protocol". */
  notes: string[];
}

const DEFAULT_CAPS: EndpointCaps = {
  tools: true,
  toolChoice: true,
  streamOptions: true,
  stream: true,
  notes: [],
};

const memory = new Map<string, EndpointCaps>();

function key(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, "")}|${model}`;
}

/** What we currently believe about an endpoint + model. */
export function capabilities(baseUrl: string, model: string): EndpointCaps {
  const found = memory.get(key(baseUrl, model));
  return found ? { ...found, notes: [...found.notes] } : { ...DEFAULT_CAPS, notes: [] };
}

/** Record that a field was rejected, so later calls leave it out. */
export function markUnsupported(
  baseUrl: string,
  model: string,
  what: Capability,
  detail?: string,
): EndpointCaps {
  const id = key(baseUrl, model);
  const caps = memory.get(id) ?? { ...DEFAULT_CAPS, notes: [] };
  caps[what] = false;
  const note = `the endpoint does not support ${LABEL[what]}${detail ? ` (${detail})` : ""} — leaving it out from now on`;
  if (!caps.notes.includes(note)) caps.notes.push(note);
  memory.set(id, caps);
  return { ...caps, notes: [...caps.notes] };
}

export function markSupported(baseUrl: string, model: string, what: Capability): void {
  const id = key(baseUrl, model);
  const caps = memory.get(id) ?? { ...DEFAULT_CAPS, notes: [] };
  caps[what] = true;
  memory.set(id, caps);
}

const LABEL: Record<Capability, string> = {
  tools: "native function calling (tools)",
  toolChoice: "tool_choice",
  streamOptions: "stream_options",
  stream: "streaming (stream)",
};

/** Sniff an error message for the field the endpoint is complaining about. */
export function rejectedField(message: string): Capability | null {
  const text = message.toLowerCase();
  if (/stream_options|include_usage/.test(text)) return "streamOptions";
  if (/tool_choice/.test(text)) return "toolChoice";
  if (/\btools?\b|function[_\s]?call|functions?\b/.test(text)) return "tools";
  if (/\bstream\b/.test(text)) return "stream";
  return null;
}

export function capabilityReport(): Array<{ endpoint: string; notes: string[] }> {
  const rows: Array<{ endpoint: string; notes: string[] }> = [];
  for (const [id, caps] of memory) {
    if (caps.notes.length > 0) rows.push({ endpoint: id.replace("|", "  ·  "), notes: [...caps.notes] });
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Discovering how much context a model has                                   */
/* -------------------------------------------------------------------------- */

export interface ContextProbe {
  /** model id -> max context length in tokens (as reported by the endpoint). */
  models: Record<string, number>;
  /** Which API answered, for display. */
  source: string;
  notes: string[];
}

function originOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Ask the local server how big the model's context window is.
 * LM Studio and Ollama both expose this, just not through the OpenAI route.
 */
export interface ContextProbeRequest {
  baseUrl: string;
  model: string;
}

export async function probeContextLimits(profile: ContextProbeRequest, timeoutMs = 4_000): Promise<ContextProbe> {
  const models: Record<string, number> = {};
  const notes: string[] = [];
  const origin = originOf(profile.baseUrl);
  const signal = AbortSignal.timeout(timeoutMs);

  // LM Studio: GET /api/v0/models -> data[].max_context_length / loaded_context_length
  try {
    const res = await fetch(`${origin}/api/v0/models`, { signal });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ id?: string; max_context_length?: number; loaded_context_length?: number }>;
      };
      for (const entry of data.data ?? []) {
        const id = String(entry?.id ?? "");
        const length = Number(entry?.loaded_context_length || entry?.max_context_length || 0);
        if (id && length > 0) models[id] = length;
      }
      if (Object.keys(models).length > 0) {
        return { models, source: "LM Studio /api/v0/models", notes };
      }
    }
  } catch {
    // not LM Studio, or the native API is off
  }

  // Ollama: POST /api/show {model} -> model_info["<arch>.context_length"]
  try {
    const res = await fetch(`${origin}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: profile.model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = (await res.json()) as { model_info?: Record<string, unknown> };
      const entry = Object.entries(data.model_info ?? {}).find(([k]) => k.endsWith(".context_length"));
      const length = Number(entry?.[1] ?? 0);
      if (length > 0 && profile.model) {
        models[profile.model] = length;
        return { models, source: "Ollama /api/show", notes };
      }
    }
  } catch {
    // not Ollama
  }

  notes.push("the endpoint does not report a context length - set one by hand with /set contextLimit <tokens>");
  return { models, source: "", notes };
}

/* -------------------------------------------------------------------------- */
/* Listing every model the local servers can load                              */
/* -------------------------------------------------------------------------- */

/** One endpoint worth asking for its model list. */
export interface ModelEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  kind: "local" | "api";
}

/** A model found on some endpoint. */
export interface DiscoveredModel {
  id: string;
  endpointId: string;
  endpoint: string;
  baseUrl: string;
  /** Context length when the server reports one, otherwise 0. */
  context: number;
  /** Other endpoints that also serve this model id. */
  alsoOn: string[];
}

export interface EndpointReport {
  id: string;
  label: string;
  baseUrl: string;
  ok: boolean;
  source: string;
  models: string[];
  context: Record<string, number>;
  error: string;
}

export interface DiscoveryResult {
  models: DiscoveredModel[];
  context: Record<string, number>;
  endpoints: EndpointReport[];
}

/** Local servers probed even when no profile points at them. */
export const WELL_KNOWN_LOCAL: ModelEndpoint[] = [
  {
    id: "lmstudio",
    label: "LM Studio (127.0.0.1:1234)",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "local",
    kind: "local",
  },
  {
    id: "ollama",
    label: "Ollama (127.0.0.1:11434)",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "ollama",
    kind: "local",
  },
];

/**
 * Every local endpoint worth asking: the local profiles first (they carry the
 * user's own URL and key), then the well-known ports that no profile covers.
 */
export function localEndpointsFor(
  profiles: Array<{ id: string; name?: string; kind: "local" | "api"; baseUrl: string; apiKey: string }>,
): ModelEndpoint[] {
  const out: ModelEndpoint[] = [];
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (profile.kind !== "local" || !profile.baseUrl) continue;
    const origin = originOf(profile.baseUrl);
    if (seen.has(origin)) continue;
    seen.add(origin);
    out.push({
      id: profile.id,
      label: `${profile.name || profile.id}`,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      kind: "local",
    });
  }
  for (const known of WELL_KNOWN_LOCAL) {
    const origin = originOf(known.baseUrl);
    if (seen.has(origin)) continue;
    seen.add(origin);
    out.push({ ...known });
  }
  return out;
}

/** Ask one OpenAI-compatible endpoint which models it serves. */
export async function listModelsAt(
  endpoint: { baseUrl: string; apiKey?: string },
  timeoutMs = 10_000,
): Promise<string[]> {
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  if (!base) throw new Error("no base URL configured for this endpoint");
  const res = await fetch(`${base}/models`, {
    headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`the endpoint answered HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const list = (data.data ?? [])
    .map((entry) => String(entry?.id ?? ""))
    .filter((id) => id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  if (list.length === 0) throw new Error("the endpoint listed no models");
  return list;
}

/**
 * Ask one server what it can load, preferring the API that also reports a
 * context length: LM Studio's native route, then the OpenAI route, then
 * Ollama's own route.
 */
async function probeModels(endpoint: ModelEndpoint, timeoutMs: number): Promise<EndpointReport> {
  const report: EndpointReport = {
    id: endpoint.id,
    label: endpoint.label,
    baseUrl: endpoint.baseUrl,
    ok: false,
    source: "",
    models: [],
    context: {},
    error: "",
  };
  const origin = originOf(endpoint.baseUrl);
  const base = endpoint.baseUrl.replace(/\/+$/, "");

  // 1. LM Studio: ids plus the context window of every downloaded model.
  try {
    const res = await fetch(`${origin}/api/v0/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ id?: string; max_context_length?: number; loaded_context_length?: number }>;
      };
      const entries = (data.data ?? []).filter((entry) => entry?.id);
      if (entries.length > 0) {
        report.ok = true;
        report.source = "LM Studio /api/v0/models";
        report.models = entries.map((entry) => String(entry.id)).sort((a, b) => a.localeCompare(b));
        for (const entry of entries) {
          const length = Number(entry.loaded_context_length || entry.max_context_length || 0);
          if (length > 0) report.context[String(entry.id)] = Math.round(length);
        }
        return report;
      }
    }
  } catch {
    // not LM Studio, or the native API is off
  }

  // 2. The OpenAI-compatible route both LM Studio and Ollama implement.
  try {
    report.models = await listModelsAt(endpoint, timeoutMs);
    report.ok = true;
    report.source = "OpenAI /v1/models";
    return report;
  } catch (error) {
    report.error = (error as Error).message;
  }

  // 3. Ollama's own route, for servers with the OpenAI bridge disabled.
  try {
    const res = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
      const names = (data.models ?? [])
        .map((entry) => String(entry?.name ?? entry?.model ?? ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      if (names.length > 0) {
        report.ok = true;
        report.source = "Ollama /api/tags";
        report.models = names;
        report.error = "";
        return report;
      }
    }
  } catch {
    // not Ollama either
  }

  if (!report.error) report.error = "no model list on this endpoint";
  return report;
}

/**
 * Ask every local endpoint in parallel and merge the answers into one list:
 * this is what makes "sync the models of local Ollama and LM Studio" work —
 * the model picker shows everything that can be loaded, and picking one can
 * switch the endpoint behind it.
 */
export async function discoverLocalModels(
  endpoints: ModelEndpoint[],
  timeoutMs = 8_000,
): Promise<DiscoveryResult> {
  const reports = await Promise.all(endpoints.map((endpoint) => probeModels(endpoint, timeoutMs)));

  const merged: DiscoveredModel[] = [];
  const context: Record<string, number> = {};
  const byId = new Map<string, DiscoveredModel>();

  for (const report of reports) {
    for (const [model, tokens] of Object.entries(report.context)) {
      if (tokens > 0) context[model] = tokens;
    }
    for (const id of report.models) {
      const existing = byId.get(id);
      if (existing) {
        if (!existing.alsoOn.includes(report.label)) existing.alsoOn.push(report.label);
        if (!existing.context && report.context[id]) existing.context = report.context[id];
        continue;
      }
      const found: DiscoveredModel = {
        id,
        endpointId: report.id,
        endpoint: report.label,
        baseUrl: report.baseUrl,
        context: report.context[id] ?? 0,
        alsoOn: [],
      };
      byId.set(id, found);
      merged.push(found);
    }
  }

  merged.sort((a, b) => a.id.localeCompare(b.id));
  return { models: merged, context, endpoints: reports };
}
