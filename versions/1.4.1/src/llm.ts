import type { Config } from "./settings.js";
import { capabilities, markSupported, markUnsupported, rejectedField } from "./providers.js";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments, as returned by the model. */
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface StreamToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatChunk {
  model?: string;
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: StreamToolCall[];
    };
    message?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  timings?: Record<string, unknown>;
  error?: { message?: string };
}

/**
 * Token accounting for one LLM call, normalised across providers.
 *
 * `promptTokens` / `completionTokens` come from the provider's `usage` block.
 * `cachedTokens` is only reported by some of them (OpenAI, DeepSeek, ...) - it
 * stays 0 when the endpoint does not say, and the UI shows "—" rather than a
 * made-up number.
 */
export interface Usage {
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  /** True when the endpoint actually sent a cache counter (0 is meaningful then). */
  cacheReported: boolean;
  /** Wall-clock time of the request, measured here. */
  elapsedMs: number;
  /** Provider-reported speed (LM Studio / llama.cpp `stats`), else null. */
  tokensPerSecond: number | null;
  timeToFirstTokenMs: number | null;
  stopReason: string | null;
  /** True when the counts were derived from text length, not reported. */
  estimated: boolean;
}

export interface ChatResult {
  message: ChatMessage;
  usage: Usage;
}

/** Extra options for one call: cancellation and live token callbacks. */
export interface ChatOptions {
  /** Abort the request (the Stop button / Esc). */
  signal?: AbortSignal;
  /** Called with every new piece of the answer as it arrives. */
  onDelta?: (text: string) => void;
  /** Called with every new piece of "thinking" text (reasoning models). */
  onReasoning?: (text: string) => void;
  /** Override the `stream` setting for this call. */
  stream?: boolean;
}

function toInt(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function toFloat(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function pick<T>(source: Record<string, unknown> | undefined, key: string): T | undefined {
  return source?.[key] as T | undefined;
}

/** Turn whatever the endpoint reported into a stable shape. */
function buildUsage(input: {
  raw: Record<string, unknown> | undefined;
  stats: Record<string, unknown>;
  timings: Record<string, unknown>;
  model: string | null;
  elapsedMs: number;
  /** Time until the first token arrived, measured locally while streaming. */
  firstTokenMs: number | null;
  message: ChatMessage | undefined;
}): Usage {
  const { raw = {}, stats, timings, model, elapsedMs, firstTokenMs, message } = input;
  // Every provider names the cache counter slightly differently.
  const cacheRaw =
    pick<Record<string, unknown>>(raw, "prompt_tokens_details")?.cached_tokens ??
    raw.prompt_cache_hit_tokens ?? // DeepSeek
    raw.cached_tokens; // others
  const reasoningTokens = toInt(
    pick<Record<string, unknown>>(raw, "completion_tokens_details")?.reasoning_tokens ??
      raw.reasoning_tokens,
  );

  let promptTokens = toInt(raw.prompt_tokens);
  let completionTokens = toInt(raw.completion_tokens);
  let estimated = false;
  if (completionTokens === 0 && message?.content) {
    // Fall back to a rough character count (~4 chars per token) so the UI can
    // still show something useful; it is flagged as an estimate.
    completionTokens = Math.max(1, Math.round(message.content.length / 4));
    estimated = true;
  }
  const totalTokens = toInt(raw.total_tokens) || promptTokens + completionTokens;

  const statsTtft = toFloat(stats.time_to_first_token);
  const timeToFirstTokenMs = statsTtft ? Math.round(statsTtft * 1000) : firstTokenMs;

  // Speed: prefer what the provider measured, then llama.cpp timings, then our
  // own "completion tokens over pure generation time". Measurement is only
  // trusted for a decent sample, otherwise a 2-token answer would report an
  // absurd millions-of-tokens-per-second number.
  let tokensPerSecond =
    toFloat(stats.tokens_per_second) ?? toFloat(timings.predicted_per_second);
  if (tokensPerSecond === null && completionTokens >= 8 && firstTokenMs !== null) {
    const generationMs = elapsedMs - firstTokenMs;
    if (generationMs >= 200) {
      const speed = completionTokens / (generationMs / 1000);
      if (Number.isFinite(speed) && speed > 0) tokensPerSecond = speed;
    }
  }

  const stopReason =
    (typeof stats.stop_reason === "string" ? stats.stop_reason : null) ??
    (typeof timings.stop_reason === "string" ? timings.stop_reason : null);

  return {
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    cachedTokens: toInt(cacheRaw),
    cacheReported: cacheRaw !== undefined && cacheRaw !== null,
    elapsedMs,
    tokensPerSecond,
    timeToFirstTokenMs,
    stopReason,
    estimated,
  };
}

/** Prompt tokens as reported, or a ~4-chars-per-token estimate. */
function estimatePromptTokens(messages: ChatMessage[], reported: number): number {
  if (reported > 0) return reported;
  const chars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.max(1, Math.round(chars / 4));
}

function finishUsage(usage: Usage, messages: ChatMessage[], reported: boolean): Usage {
  usage.promptTokens = estimatePromptTokens(messages, usage.promptTokens);
  if (usage.totalTokens === 0) usage.totalTokens = usage.promptTokens + usage.completionTokens;
  usage.estimated = usage.estimated || !reported;
  return usage;
}

/** Read a `text/event-stream` reply, assembling deltas into one message. */
async function readStream(
  res: Response,
  options: ChatOptions,
  messages: ChatMessage[],
  startedAt: number,
): Promise<ChatResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("the endpoint did not return a readable stream");
  const decoder = new TextDecoder();

  let buffer = "";
  let content = "";
  let model: string | null = null;
  let usageRaw: Record<string, unknown> | undefined;
  let stats: Record<string, unknown> = {};
  let timings: Record<string, unknown> = {};
  let firstTokenMs: number | null = null;
  const partials = new Map<number, { id: string; name: string; args: string }>();

  const handle = (chunk: ChatChunk): void => {
    if (typeof chunk.model === "string") model = chunk.model;
    if (chunk.usage) usageRaw = chunk.usage;
    if (chunk.stats) stats = chunk.stats;
    if (chunk.timings) timings = chunk.timings;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string" && reasoning) {
      // A reasoning model starts talking here, before any visible content.
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
      options.onReasoning?.(reasoning);
    }
    if (typeof delta.content === "string" && delta.content) {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
      content += delta.content;
      options.onDelta?.(delta.content);
    }
    for (const call of delta.tool_calls ?? []) {
      const index = typeof call.index === "number" ? call.index : 0;
      const entry = partials.get(index) ?? { id: "", name: "", args: "" };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.args += call.function.arguments;
      partials.set(index, entry);
    }
  };

  const consume = (text: string): void => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
      if (!payload || payload === "[DONE]") continue;
      try {
        handle(JSON.parse(payload) as ChatChunk);
      } catch {
        // keep-alive comments and partial frames are not fatal
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(`${decoder.decode()}\n`);

  const tool_calls: ToolCall[] = [...partials.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, part]) => ({
      id: part.id || `call_${index}`,
      type: "function" as const,
      function: { name: part.name, arguments: part.args },
    }));

  const message: ChatMessage = {
    role: "assistant",
    content: content || null,
    ...(tool_calls.length > 0 ? { tool_calls } : {}),
  };
  const usage = finishUsage(
    buildUsage({
      raw: usageRaw,
      stats,
      timings,
      model,
      elapsedMs: Date.now() - startedAt,
      firstTokenMs,
      message,
    }),
    messages,
    usageRaw !== undefined,
  );
  return { message, usage };
}

/** Wait, but give up instantly if the user stops the task. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 429 and 5xx are worth another try; 4xx generally are not. */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/** Honour `Retry-After` when the server sends it, otherwise exponential backoff. */
function backoffMs(attempt: number, res?: Response): number {
  const header = res?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 30_000);
  }
  return Math.min(400 * 2 ** Math.max(0, attempt - 1), 8_000);
}

/** Send a chat completion request and return the assistant message. */
export async function chat(
  config: Config,
  messages: ChatMessage[],
  tools: ToolSchema[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  if (!config.apiKey) {
    throw new Error(
      "Missing API key. Set OPENAI_API_KEY in your environment or .env file.",
    );
  }

  const caps = capabilities(config.baseUrl, config.model);
  const timeoutMs = Number.isFinite(config.requestTimeoutMs) && config.requestTimeoutMs > 0
    ? config.requestTimeoutMs
    : 180_000;
  const maxRetries = Math.max(0, Math.min(Number(config.maxRetries) || 0, 10));

  // What we will actually send - may shrink as the endpoint pushes back.
  let useStream = (options.stream ?? config.stream) && caps.stream;
  let useTools = tools.length > 0 && caps.tools;
  let useToolChoice = useTools && caps.toolChoice;
  let useStreamOptions = useStream && caps.streamOptions;

  let attempt = 0;
  let fixes = 0;
  let streamed = false;

  // Wrap the callbacks: once a token has been shown we can no longer retry.
  const emit: ChatOptions = {
    ...options,
    onDelta: options.onDelta && ((text: string) => { streamed = true; options.onDelta?.(text); }),
    onReasoning: options.onReasoning && ((text: string) => { streamed = true; options.onReasoning?.(text); }),
  };

  for (;;) {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: config.temperature,
    };
    if (useTools) {
      body.tools = tools;
      if (useToolChoice) body.tool_choice = "auto";
    }
    if (useStream) {
      body.stream = true;
      if (useStreamOptions) body.stream_options = { include_usage: true };
    }

    const signals = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: signals,
      });
    } catch (error) {
      const err = error as Error & { cause?: { code?: string } };
      if (options.signal?.aborted || err.name === "AbortError") throw error; // user stopped us
      if (attempt < maxRetries && !streamed) {
        attempt += 1;
        await sleep(backoffMs(attempt), options.signal);
        continue;
      }
      if (err.name === "TimeoutError") {
        const limit = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
        throw new Error(`the endpoint did not answer within ${limit}`);
      }
      const reason = err.cause?.code ?? err.message;
      throw new Error(`cannot reach ${config.baseUrl} (${reason})`);
    }

    const contentType = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      const text = await res.text();
      let detail = text.slice(0, 500);
      try {
        detail = (JSON.parse(text) as ChatChunk).error?.message ?? detail;
      } catch {
        /* not JSON */
      }

      // Compatibility: the endpoint told us which field it does not understand.
      if (!streamed && (res.status === 400 || res.status === 422 || res.status >= 500)) {
        const field = rejectedField(detail);
        if (field === "streamOptions" && useStreamOptions) {
          markUnsupported(config.baseUrl, config.model, field, detail.slice(0, 120));
          useStreamOptions = false;
          fixes += 1;
          continue;
        }
        if (field === "toolChoice" && useToolChoice) {
          markUnsupported(config.baseUrl, config.model, field, detail.slice(0, 120));
          useToolChoice = false;
          fixes += 1;
          continue;
        }
        if (field === "tools" && useTools) {
          markUnsupported(config.baseUrl, config.model, field, detail.slice(0, 120));
          useTools = false;
          useToolChoice = false;
          fixes += 1;
          continue;
        }
        if (field === "stream" && useStream) {
          markUnsupported(config.baseUrl, config.model, field, detail.slice(0, 120));
          useStream = false;
          fixes += 1;
          continue;
        }
      }

      if (retryableStatus(res.status) && attempt < maxRetries && !streamed) {
        attempt += 1;
        await sleep(backoffMs(attempt, res), options.signal);
        continue;
      }

      if (res.status === 429) {
        throw new Error(`the endpoint is rate limiting (HTTP 429): ${detail}`);
      }
      throw new Error(`LLM request failed (${res.status}): ${detail}`);
    }

    // It worked - remember which optional fields this endpoint accepted.
    if (useTools) markSupported(config.baseUrl, config.model, "tools");
    if (useStreamOptions) markSupported(config.baseUrl, config.model, "streamOptions");
    if (useStream) markSupported(config.baseUrl, config.model, "stream");

    if (contentType.includes("text/event-stream")) {
      return readStream(res, emit, messages, started);
    }

    const text = await res.text();
    const elapsedMs = Date.now() - started;
    let json: ChatChunk;
    try {
      json = JSON.parse(text) as ChatChunk;
    } catch {
      throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 500)}`);
    }

    const choice = json.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new Error("LLM response contained no message.");
    }

    const chatMessage: ChatMessage = {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    };
    // The endpoint sent it all at once: replay it so the UI still shows something.
    if (chatMessage.content) options.onDelta?.(chatMessage.content);

    const usage = finishUsage(
      buildUsage({
        raw: json.usage,
        stats: json.stats ?? {},
        timings: json.timings ?? {},
        model: json.model ?? null,
        elapsedMs,
        firstTokenMs: null,
        message: chatMessage,
      }),
      messages,
      json.usage !== undefined,
    );
    return { message: chatMessage, usage };
  }
}
