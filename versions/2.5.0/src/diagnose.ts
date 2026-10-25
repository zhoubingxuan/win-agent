import type { Config } from "./settings.js";
import { probeContextLimits } from "./providers.js";

/**
 * Endpoint diagnosis.
 *
 * Local servers differ a lot: some have no function calling, some ignore
 * `stream`, some report no token usage. Rather than let the user find out one
 * failing task at a time, this runs a handful of tiny requests and reports what
 * this endpoint + model can actually do.
 *
 * Nothing here touches the conversation history.
 */

export interface Check {
  id: string;
  label: string;
  /** true = works, false = broken, null = could not be determined. */
  ok: boolean | null;
  detail: string;
}

export interface Diagnosis {
  endpoint: string;
  model: string;
  checks: Check[];
  /** Model id -> context length, if the endpoint reported one. */
  context: Record<string, number>;
  contextSource: string;
  /** Rough verdict for the UI header. */
  verdict: "ok" | "degraded" | "broken";
}

const MODELS_TIMEOUT = 6_000;
const CHAT_TIMEOUT = 60_000;

interface ChatProbe {
  ok: boolean;
  status: number;
  detail: string;
  content: string;
  toolCalls: number;
  usage: Record<string, unknown> | null;
  streamed: boolean;
}

/**
 * Describe what came back. Reasoning models can spend the whole token budget on
 * `reasoning_tokens` and return empty `content`, which looks like a failure but
 * is not one.
 */
function describeAnswer(probe: ChatProbe): string {
  const reasoning = Number(
    (probe.usage?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
      ?.reasoning_tokens ?? probe.usage?.reasoning_tokens ?? 0,
  );
  const content = probe.content.trim();
  if (!content && reasoning > 0) {
    return `a reasoning model was used: ${Math.round(reasoning)} reasoning tokens, no visible text (normal)`;
  }
  if (!content) return `answered with no text (${probe.detail})`;
  return `answered ${JSON.stringify(content.slice(0, 40))}`;
}

async function postChat(
  config: Config,
  body: Record<string, unknown>,
  timeoutMs: number,
  stream = false,
): Promise<ChatProbe> {
  const result: ChatProbe = {
    ok: false,
    status: 0,
    detail: "",
    content: "",
    toolCalls: 0,
    usage: null,
    streamed: false,
  };
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey || "none"}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    result.status = res.status;
    const type = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      const text = await res.text();
      try {
        result.detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text.slice(0, 300);
      } catch {
        result.detail = text.slice(0, 300);
      }
      return result;
    }

    if (stream) {
      const reader = res.body?.getReader();
      if (!reader) {
        result.detail = "the endpoint returned no readable stream";
        return result;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let frames = 0;
      let deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        frames += (buffer.match(/^data:/gm) ?? []).length;
        buffer = buffer.split("\n").pop() ?? "";
        if (frames > 0) break; // one frame is enough to prove streaming works
      }
      await reader.cancel().catch(() => undefined);
      result.streamed = frames > 0;
      result.ok = result.streamed;
      result.detail = result.streamed
        ? `received ${frames} SSE frame(s)`
        : "no SSE frames arrived (the endpoint may have answered with plain JSON instead)";
      return result;
    }

    const text = await res.text();
    if (type.includes("text/event-stream")) {
      result.streamed = text.includes("data:");
      result.detail = "the endpoint streamed even though streaming was not requested";
      return result;
    }

    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string }>;
      usage?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (json.error?.message) {
      result.detail = json.error.message;
      return result;
    }
    const choice = json.choices?.[0];
    result.content = choice?.message?.content ?? "";
    result.toolCalls = choice?.message?.tool_calls?.length ?? 0;
    result.usage = json.usage ?? null;
    result.ok = true;
    result.detail = choice?.finish_reason ? `finish_reason: ${choice.finish_reason}` : "completed";
    return result;
  } catch (error) {
    const err = error as Error;
    result.detail = err.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)}s` : err.message;
    return result;
  }
}

/** Run every probe against the configured endpoint. */
export async function diagnose(config: Config): Promise<Diagnosis> {
  const checks: Check[] = [];
  const endpoint = config.baseUrl;
  const model = config.model;

  // 1. Reachability + model list.
  let listed: string[] = [];
  let listDetail = "";
  try {
    const res = await fetch(`${endpoint}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey || "none"}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      listed = (json.data ?? []).map((m) => String(m?.id ?? "")).filter(Boolean);
      listDetail = `${listed.length} model(s)`;
    } else {
      listDetail = `HTTP ${res.status}`;
    }
  } catch (error) {
    listDetail = (error as Error).name === "TimeoutError"
      ? `no answer within ${MODELS_TIMEOUT / 1000}s`
      : (error as Error).message;
  }
  checks.push({
    id: "endpoint",
    label: "Endpoint reachable",
    ok: listed.length > 0 ? true : listDetail.includes("HTTP") ? false : null,
    detail: `${endpoint}/models - ${listDetail}`,
  });
  checks.push({
    id: "model",
    label: "Configured model exists",
    ok: listed.length === 0 ? null : listed.includes(model) ? true : false,
    detail: listed.length === 0
      ? `cannot check "${model}" (no model list)`
      : listed.includes(model)
        ? `"${model}" is loaded`
        : `"${model}" is not in the list. Available: ${listed.slice(0, 8).join(", ")}`,
  });

  // 2. Plain chat completion.
  const basic = await postChat(
    config,
    {
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      temperature: 0,
      max_tokens: 512,
    },
    CHAT_TIMEOUT,
  );
  checks.push({
    id: "chat",
    label: "Plain chat completion",
    ok: basic.ok ? true : false,
    detail: basic.ok ? describeAnswer(basic) : `HTTP ${basic.status}: ${basic.detail}`,
  });
  checks.push({
    id: "usage",
    label: "Reports token usage",
    ok: basic.ok ? Boolean(basic.usage) : null,
    detail: basic.ok
      ? basic.usage
        ? `usage: ${JSON.stringify(basic.usage).slice(0, 160)}`
        : "no usage block — token counts will be estimated locally"
      : "skipped",
  });

  // 3. Native function calling.
  if (basic.ok) {
    const tool = await postChat(
      config,
      {
        model,
        messages: [{ role: "user", content: "Call the tool get_time with no arguments. Do not explain." }],
        temperature: 0,
        max_tokens: 512,
        tools: [
          {
            type: "function",
            function: {
              name: "get_time",
              description: "Return the current time",
              parameters: { type: "object", properties: {}, required: [] },
            },
          },
        ],
        tool_choice: "auto",
      },
      CHAT_TIMEOUT,
    );
    const works = tool.ok && tool.toolCalls > 0;
    checks.push({
      id: "tools",
      label: "Native function calling (tools)",
      ok: tool.ok ? works : false,
      detail: !tool.ok
        ? `HTTP ${tool.status}: ${tool.detail}`
        : works
          ? `${tool.toolCalls} tool call(s) returned`
          : "the model answered in text instead — win-agent falls back to the text protocol (```json {\"tool\": ...}```)",
    });

    // 4. Streaming.
    const stream = await postChat(
      config,
      {
        model,
        messages: [{ role: "user", content: "Count from 1 to 10." }],
        temperature: 0,
        max_tokens: 64,
        stream: true,
      },
      CHAT_TIMEOUT,
      true,
    );
    checks.push({
      id: "stream",
      label: "Streaming (stream: true)",
      ok: stream.ok ? true : false,
      detail: stream.detail,
    });
  } else {
    checks.push({ id: "tools", label: "Native function calling (tools)", ok: null, detail: "skipped" });
    checks.push({ id: "stream", label: "Streaming (stream: true)", ok: null, detail: "skipped" });
  }

  // 5. Context window discovery.
  const probe = await probeContextLimits({ baseUrl: endpoint, model });
  const own = probe.models[model];
  checks.push({
    id: "context",
    label: "Context window known",
    ok: probe.source ? true : null,
    detail: probe.source
      ? `${probe.source}: ${own ? `${model} = ${own} tokens` : `${Object.keys(probe.models).length} model(s) reported`}`
      : probe.notes.join("; ") || "the endpoint does not report a context length — set it with /set contextLimit <tokens>",
  });

  const failed = checks.filter((c) => c.ok === false).length;
  const verdict: Diagnosis["verdict"] =
    !basic.ok ? "broken" : failed > 1 ? "degraded" : "ok";

  return { endpoint, model, checks, context: probe.models, contextSource: probe.source, verdict };
}

/** Render a diagnosis as plain text (used by the CLI `/diagnose`). */
export function formatDiagnosis(diagnosis: Diagnosis): string {
  const mark = (ok: boolean | null): string => (ok === true ? "[ok]" : ok === false ? "[!!]" : "[--]");
  const lines = [
    `Endpoint: ${diagnosis.endpoint}`,
    `Model:    ${diagnosis.model}`,
    `Verdict:  ${diagnosis.verdict}`,
    "",
  ];
  for (const check of diagnosis.checks) {
    lines.push(`${mark(check.ok)} ${check.label}: ${check.detail}`);
  }
  return lines.join("\n");
}
