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
