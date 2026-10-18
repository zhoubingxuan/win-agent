import type { AgentMode, Config, Language } from "./settings.js";
import { GUIDED_INSTRUCTIONS, LANGUAGE_INSTRUCTIONS } from "./settings.js";
import { chat, type ChatMessage, type ToolCall, type Usage } from "./llm.js";
import { planContext, schemaTokens, toolCapFor, type ContextStats } from "./context.js";
import type { ToolRegistry } from "./tools/index.js";

export interface AgentEvents {
  onAssistantText?: (text: string) => void;
  /** Live token of an answer as the model produces it (streaming). */
  onAssistantDelta?: (text: string) => void;
  /** Live "thinking" text from a reasoning model (streaming). */
  onReasoning?: (text: string) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, result: string) => void;
  onStep?: (step: number, maxSteps: number) => void;
  /** Token accounting for every LLM call, as it happens. */
  onUsage?: (usage: Usage) => void;
  /** Fired when the prompt had to be trimmed to fit the model's context window. */
  onContext?: (stats: ContextStats) => void;
}

/**
 * Try to recover a tool call from plain assistant text.
 * Many small local models cannot do native function-calling, so we also accept a
 * fenced JSON block shaped like {"tool": "...", "arguments": {...}}.
 */
export function parseTextToolCall(content: string): { call: ToolCall; rest: string } | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const candidate = fence ? fence[1] : content;
  const match = /\{[\s\S]*\}/.exec(candidate);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const name =
    (parsed.tool as string | undefined) ??
    (parsed.name as string | undefined) ??
    (parsed.action as string | undefined);
  if (typeof name !== "string" || name.trim() === "") return null;

  const args =
    (parsed.arguments as unknown) ??
    (parsed.args as unknown) ??
    (parsed.parameters as unknown) ??
    {};

  return {
    call: {
      id: `text_${Date.now()}`,
      type: "function",
      function: {
        name: name.trim(),
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      },
    },
    rest: fence ? content.replace(fence[0], "").trim() : "",
  };
}

/**
 * Local models occasionally leak chat-template artefacts into their text, e.g.
 * an orphan closing tag such as "</antwork>" or a raw "<|end_of_turn|>" token.
 * Drop closing tags that have no matching opening tag and squeeze blank lines.
 */
export function sanitizeAssistantText(text: string): string {
  const opened = new Set<string>();
  for (const match of text.matchAll(/<\s*([a-zA-Z_][\w:.-]*)(?=[\s/>])/g)) {
    opened.add(match[1].toLowerCase());
  }
  return text
    .replace(/<\/\s*([a-zA-Z_][\w:.-]*)\s*>/g, (whole, name: string) =>
      opened.has(name.toLowerCase()) ? whole : "",
    )
    .replace(/<\|[^|]{0,40}\|>/g, "")
    .replace(/[ \t]+(?=\n)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The extra operating procedure of a mode, for testing and for showing the user
 * what the model is actually told. Empty in `normal` mode.
 */
export function guidanceFor(mode: AgentMode, language: Language): string {
  if (mode !== "guided") return "";
  return GUIDED_INSTRUCTIONS[language] ?? GUIDED_INSTRUCTIONS.en;
}

/**
 * `guided` mode runs one tool per step: a small model that fires three calls at
 * once is usually guessing, and the results then arrive after it has already
 * moved on. The extra calls are still answered (the tool protocol requires one
 * message per call) with a short note instead of silence.
 */
export function splitToolCalls(
  calls: ToolCall[],
  mode: AgentMode,
): { go: ToolCall[]; extra: ToolCall[] } {
  if (mode !== "guided" || calls.length <= 1) return { go: calls, extra: [] };
  return { go: calls.slice(0, 1), extra: calls.slice(1) };
}

/** The note sent back for a tool call that was skipped in guided mode. */
export const SKIPPED_TOOL_CALL =
  "Skipped: guided mode runs one tool per step. Read the result above, then call the next tool.";

/**
 * Appended (for one request only, never stored) when a model answers with nothing
 * at all: no text for the user and no tool call. Small reasoning models do this
 * after a long think - the whole completion lands in the thinking channel and the
 * visible answer comes back empty - and asking once more usually gets an answer.
 */
export const EMPTY_REPLY_NUDGE =
  "Your last reply was empty: no text for the user and no tool call. Reply to the user now, in plain text.";

/**
 * What the user sees when even the nudged retry produced nothing. Better a stated
 * reason than a blank bubble that never explains itself.
 */
export function blankReply(language: Language | undefined, thinking: number, raw: string): string {
  const zh = language === "zh";
  if (raw) {
    const snippet = raw.replace(/\s+/g, " ").slice(0, 60);
    return zh
      ? `（模型没有给出回复，只输出了模板标记：“${snippet}”。请重新发送，或换一个模型。）`
      : `(no answer: the model's reply was only chat-template artefacts — "${snippet}". Send it again, or pick another model.)`;
  }
  const spent = thinking > 0 ? (zh ? `（思考了 ${thinking} 个字符）` : ` after ${thinking} characters of thinking`) : "";
  return zh
    ? `（模型没有给出回复${spent}。请重新发送，或换一个模型。）`
    : `(no answer: the model returned an empty reply${spent}. Send it again, or pick another model.)`;
}

/** An agent that drives the model and the Windows tools until a task is done. */
export class Agent {
  private readonly history: ChatMessage[];
  /** Context accounting for the most recent request. */
  private lastContext: ContextStats | null = null;

  constructor(
    private readonly config: Config,
    private readonly tools: ToolRegistry,
    private readonly events: AgentEvents = {},
    history?: ChatMessage[],
  ) {
    if (history && history.length > 0) {
      this.history = [...history];
      // The system prompt is rebuilt on every construction; keep it in slot 0.
      if (this.history[0]?.role === "system") {
        this.history[0] = { role: "system", content: this.systemMessage() };
      } else {
        this.history.unshift({ role: "system", content: this.systemMessage() });
      }
    } else {
      this.history = [{ role: "system", content: this.systemMessage() }];
    }
  }

  /**
   * The system message is rebuilt on every construction so that changing the
   * prompt, the language or the mode in the UI takes effect on the next turn.
   */
  private systemMessage(): string {
    const language = this.config.language ?? "en";
    const instruction = LANGUAGE_INSTRUCTIONS[language] ?? LANGUAGE_INSTRUCTIONS.en;
    const mode = this.config.agentMode;
    return [
      this.config.systemPrompt,
      instruction,
      guidanceFor(mode, language),
      this.tools.describe({ verbose: mode === "guided" }),
    ]
      .filter((part) => part && part.trim())
      .join("\n\n");
  }

  /** The full conversation including the system prompt. */
  getHistory(): ChatMessage[] {
    return this.history;
  }

  /** Context accounting for the last request (null before the first turn). */
  getContext(): ContextStats | null {
    return this.lastContext;
  }

  /**
   * How many tokens the conversation would use right now, regardless of whether
   * a request has happened yet. Used by the UI and `/context` while idle.
   */
  measureContext(): ContextStats {
    return planContext(this.history, {
      limit: this.config.contextLimit || null,
      toolCap: this.toolCap(),
      extraTokens: schemaTokens(this.tools.schemas()),
    }).stats;
  }

  /** Safety cap for one tool result, so a single output cannot eat the window. */
  private toolCap(): number {
    return toolCapFor(this.config.contextLimit);
  }

  /** Run one user turn to completion and return the final assistant text. */
  async run(userInput: string, signal?: AbortSignal): Promise<string> {
    this.history.push({ role: "user", content: userInput });

    // Characters of "thinking" this turn produced. When the model answers with
    // nothing, this number is the only clue about where the answer went.
    let thinking = 0;

    for (let step = 1; step <= this.config.maxSteps; step++) {
      signal?.throwIfAborted();
      this.events.onStep?.(step, this.config.maxSteps);

      // Only the newest information matters: keep the stored conversation intact
      // but send the model a trimmed copy when it would not fit its window.
      const plan = planContext(this.history, {
        limit: this.config.contextLimit || null,
        toolCap: this.toolCap(),
        extraTokens: schemaTokens(this.tools.schemas()),
      });
      this.lastContext = plan.stats;
      if (plan.stats.trimmed) this.events.onContext?.(plan.stats);

      const request = (messages: ChatMessage[]) =>
        chat(this.config, messages, this.tools.schemas(), {
          signal,
          stream: this.config.stream,
          onDelta: (text) => this.events.onAssistantDelta?.(text),
          onReasoning: (text) => {
            thinking += text.length;
            this.events.onReasoning?.(text);
          },
        });

      let { message, usage } = await request(plan.messages);
      this.events.onUsage?.(usage);

      // Nothing to show and nothing to run: give it one more chance with a nudge
      // before the turn can end on an empty reply (see EMPTY_REPLY_NUDGE).
      if (!message.tool_calls?.length && !String(message.content ?? "").trim()) {
        try {
          const retry = await request([...plan.messages, { role: "system", content: EMPTY_REPLY_NUDGE }]);
          this.events.onUsage?.(retry.usage);
          if (retry.message.tool_calls?.length || String(retry.message.content ?? "").trim()) {
            message = retry.message;
          }
        } catch {
          // An endpoint that dislikes a late system message (or a request that has
          // simply had enough): fall through to the empty-reply notice below.
        }
      }

      // Fallback: let small models express a tool call as text.
      if ((!message.tool_calls || message.tool_calls.length === 0) && message.content) {
        const recovered = parseTextToolCall(message.content);
        if (recovered) {
          message.tool_calls = [recovered.call];
          message.content = recovered.rest || null;
        }
      }

      const toolCalls = message.tool_calls ?? [];
      const rawContent = typeof message.content === "string" ? message.content : "";

      // Clean up template artefacts before the text is shown or stored.
      if (typeof message.content === "string") {
        message.content = sanitizeAssistantText(message.content) || null;
      }

      if (message.content && message.content.trim()) {
        this.events.onAssistantText?.(message.content);
      }

      this.history.push(message);

      if (toolCalls.length === 0) {
        let text = message.content;
        if (!text) {
          // Never end a turn on a blank bubble: say what happened instead. The
          // message object is already in the history, so the record matches what
          // the user was told.
          text = blankReply(this.config.language, thinking, rawContent.trim());
          message.content = text;
          this.events.onAssistantText?.(text);
        }
        return text;
      }

      const { go, extra } = splitToolCalls(toolCalls, this.config.agentMode);
      for (const call of go) {
        signal?.throwIfAborted();
        this.events.onToolCall?.(call.function.name, call.function.arguments);
        const result = await this.tools.execute(call.function.name, call.function.arguments);
        this.events.onToolResult?.(call.function.name, result);
        this.history.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result,
        });
      }

      // Guided mode: answer the calls that were deliberately not run, otherwise
      // the conversation would be missing a tool message for that call id.
      for (const call of extra) {
        this.history.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: SKIPPED_TOOL_CALL,
        });
      }
    }

    const fallback = `(stopped after ${this.config.maxSteps} steps without finishing the task)`;
    this.history.push({ role: "assistant", content: fallback });
    this.events.onAssistantText?.(fallback);
    return fallback;
  }

  /** Clear the conversation while keeping the system prompt. */
  reset(): void {
    this.history.splice(1);
  }
}
