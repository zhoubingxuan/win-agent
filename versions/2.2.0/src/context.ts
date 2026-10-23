import type { ChatMessage } from "./llm.js";

/**
 * Context budgeting.
 *
 * Small local models have a small context window, and a tool result can easily
 * fill it on its own (a `files tree` of C:\Windows, a 20 000 character read...).
 * Before every request we measure what we are about to send and, when it does not
 * fit, trim the *oldest* exchanges and squeeze oversized tool results - newest
 * information always wins.
 *
 * The conversation on disk is never shortened; only the copy sent to the model is.
 */

const CJK =
  /[\u1100-\u11ff\u2e80-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** Rough token estimate: CJK counts about one token per character, Latin ~4 chars/token. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/** Fixed cost of a message's role, name and tool plumbing. */
const MESSAGE_OVERHEAD = 4;

export function measure(messages: ChatMessage[], extraTokens = 0): number {
  let total = extraTokens;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD;
    total += estimateTokens(message.content ?? "");
    if (message.tool_calls && message.tool_calls.length > 0) {
      total += estimateTokens(JSON.stringify(message.tool_calls));
    }
  }
  return total;
}

export interface ContextStats {
  /** Tokens we expect to send (messages + tool schemas). */
  estimatedTokens: number;
  /** The model's window, if we know it. */
  limit: number | null;
  /** How much of the window we allow the prompt to use. */
  budget: number | null;
  /** True when something had to be given up to fit. */
  trimmed: boolean;
  /** Whole exchanges dropped from the old end. */
  droppedMessages: number;
  /** Tool results that were shortened. */
  truncatedToolResults: number;
}

export interface ContextResult {
  messages: ChatMessage[];
  stats: ContextStats;
}

/**
 * Keep the head and the tail of a long text and say how much is missing from the
 * middle. Used both when budgeting a request and when a tool result is stored, so
 * one huge output cannot fill the window (or the conversation file) on its own.
 */
export function capText(text: string, cap: number, note = "characters trimmed to save context"): string {
  if (text.length <= cap) return text;
  const head = Math.floor(cap * 0.7);
  const tail = Math.max(0, cap - head);
  const removed = text.length - cap;
  return `${text.slice(0, head)}\n... (${removed} ${note}) ...\n${text.slice(-tail)}`;
}

function squeeze(text: string, cap: number): string {
  return capText(text, cap);
}

/** Index of the next user message after `from`, or -1. */
function nextUser(messages: ChatMessage[], from: number): number {
  for (let i = from; i < messages.length; i++) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

/**
 * Remove the oldest complete exchange (a user message and everything the model
 * did about it). The system prompt and the newest exchange are never removed.
 */
function dropOldestExchange(messages: ChatMessage[]): ChatMessage[] | null {
  const start = nextUser(messages, 1); // 0 is the system prompt
  if (start < 0) return null;
  const end = nextUser(messages, start + 1);
  if (end < 0) return null; // only one exchange left - nothing safe to drop
  return [...messages.slice(0, start), ...messages.slice(end)];
}

export interface PlanOptions {
  /** Model context window in tokens; null/0 = do not budget. */
  limit?: number | null;
  /** Tool results longer than this are squeezed before anything is dropped. */
  toolCap?: number;
  /** Tokens the tool schemas and system prompt add to every request. */
  extraTokens?: number;
  /** Fraction of the window the prompt may use (the rest is left for the answer). */
  share?: number;
}

/** Build the message list that will actually be sent to the model. */
export function planContext(messages: ChatMessage[], options: PlanOptions = {}): ContextResult {
  const { limit = null, toolCap = 12_000, extraTokens = 0, share = 0.75 } = options;
  const budget = limit && limit > 0 ? Math.max(512, Math.floor(limit * share)) : null;

  let list: ChatMessage[] = messages.map((message) => ({ ...message }));
  let truncatedToolResults = 0;
  let droppedMessages = 0;

  // 1. Squeeze oversized tool results - cheap and keeps the conversation shape.
  for (const message of list) {
    if (message.role === "tool" && typeof message.content === "string" && message.content.length > toolCap) {
      message.content = squeeze(message.content, toolCap);
      truncatedToolResults += 1;
    }
  }

  // 2. Still too big? Drop whole old exchanges, oldest first.
  if (budget !== null) {
    let guard = 0;
    while (measure(list, extraTokens) > budget && guard++ < 200) {
      const next = dropOldestExchange(list);
      if (!next) break;
      list = next;
      droppedMessages += 1;
    }

    // 3. One exchange alone can still be too big: squeeze everything harder.
    //    The system prompt is never touched (it holds the tool catalog).
    if (measure(list, extraTokens) > budget) {
      const hard = Math.max(400, Math.floor(toolCap / 4));
      for (const message of list) {
        if (message.role === "system") continue;
        if (typeof message.content === "string" && message.content.length > hard) {
          message.content = squeeze(message.content, hard);
          truncatedToolResults += 1;
        }
      }
    }
  }

  const estimatedTokens = measure(list, extraTokens);
  return {
    messages: list,
    stats: {
      estimatedTokens,
      limit: limit && limit > 0 ? limit : null,
      budget,
      trimmed: droppedMessages > 0 || truncatedToolResults > 0,
      droppedMessages,
      truncatedToolResults,
    },
  };
}

/** Tokens the tool schemas cost (they are resent with every request). */
export function schemaTokens(schemas: unknown[]): number {
  return schemas.length === 0 ? 0 : estimateTokens(JSON.stringify(schemas));
}

/**
 * Safety cap for a single tool result. Four tool results should still fit in the
 * window, but never squeeze useful output below 2 000 characters.
 */
export function toolCapFor(limit: number | null | undefined): number {
  if (!limit || limit <= 0) return 24_000;
  return Math.max(2_000, Math.min(12_000, Math.floor(limit / 4)));
}
