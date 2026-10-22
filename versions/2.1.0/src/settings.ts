import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { dataDir, migrateLegacyData } from "./store.js";
import { bomLabel, parseJsonWithBom } from "./util/json.js";
import { decodeText } from "./util/text.js";
import type { McpServer } from "./mcp.js";

/** Languages supported by the UI and by the agent's replies. */
export type Language = "en" | "zh";

export const LANGUAGES: Language[] = ["en", "zh"];

/** Appended to the system prompt so the model answers in the chosen language. */
export const LANGUAGE_INSTRUCTIONS: Record<Language, string> = {
  en: "Always answer the user in English, even when the question is written in another language.",
  zh: "始终使用简体中文回答用户，即使对方使用其他语言提问。",
};

/** Accepts "en"/"zh" plus common aliases; anything unknown falls back to English. */
export function normalizeLanguage(value: unknown): Language {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["zh", "cn", "zh-cn", "zh-hans", "chinese", "中文", "简体中文", "汉语"].includes(raw)) {
    return "zh";
  }
  return "en";
}

/**
 * How much the agent holds the model's hand.
 *
 * - `normal` - the plain system prompt. Right for a capable model (GPT-4 class).
 * - `guided` - for small local models (7B class): an explicit operating
 *   procedure, a tool catalog that spells out the required arguments, and one
 *   tool call per step, so the model cannot lose track of what it is doing.
 */
export type AgentMode = "normal" | "guided";

export const AGENT_MODES: AgentMode[] = ["normal", "guided"];

/** Accepts "guided"/"supervised"/"严格" and "normal"/"plain"; unknown -> guided. */
export function normalizeAgentMode(value: unknown): AgentMode {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["guided", "guide", "supervised", "supervision", "strict", "监督", "高监督", "严格"].includes(raw)) {
    return "guided";
  }
  if (["normal", "plain", "standard", "off", "普通", "正常"].includes(raw)) return "normal";
  return "guided";
}

/**
 * How much of the agent's *process* the chat view shows.
 *
 * - `answer` - only your message and the model's answer. The quiet default: a long
 *   run of tool calls stays out of the way until the answer arrives.
 * - `thinking` - the above plus the model's reasoning, as a block you can fold open.
 * - `full` - everything the agent did: reasoning, every tool call with its arguments
 *   and result, step markers and per-call token usage.
 *
 * It changes *nothing* about what the agent does - only what is drawn. The full
 * process is always broadcast, so switching the level re-renders the same turn.
 */
export type Verbosity = "answer" | "thinking" | "full";

export const VERBOSITY_LEVELS: Verbosity[] = ["answer", "thinking", "full"];

/** Accepts aliases in both languages; anything unknown falls back to `answer`. */
export function normalizeVerbosity(value: unknown): Verbosity {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["thinking", "think", "thoughts", "reasoning", "medium", "思考", "中等", "过程"].includes(raw)) {
    return "thinking";
  }
  if (["full", "strong", "everything", "verbose", "all", "high", "强", "完全", "详细", "全部"].includes(raw)) {
    return "full";
  }
  return "answer";
}

/**
 * The extra operating procedure appended in `guided` mode. Small models follow a
 * numbered list of one-line rules far better than one long paragraph, and the
 * "one tool per step" rule is what stops them from inventing results.
 */
export const GUIDED_INSTRUCTIONS: Record<Language, string> = {
  en: [
    "Operating procedure (follow it exactly):",
    "1. Call ONE tool per step, with a single JSON object of arguments. Never call two tools at once.",
    "2. Wait for the tool result and read it before deciding the next step. Never assume a call worked.",
    "3. Only use the tool names listed above. If none fits, say so in plain text - do not invent a tool.",
    "4. Use exactly the argument names documented above; do not add other keys.",
    "5. If a result starts with 'Error:' or 'Refused:', fix the arguments and call the SAME tool again. After two failures, explain the problem in plain text and stop.",
    "6. Write paths exactly as the user gave them (C:\\Users\\Name\\file.txt); never guess a path.",
    "7. Before a destructive step (delete, move, kill, stop a service, change the registry, shut down), say in one short sentence what you are about to do.",
    "8. If the request has two or more parts, call todo with action \"set\" first (one item per part), then mark each item \"done\" as you finish it.",
    "9. When the task is done, answer in plain text with a short summary of what you did, and do not call a tool.",
    "10. There is no shell in this mode: never write command lines, scripts or registry paths. Every step is one of the tool actions listed above.",
  ].join("\n"),
  zh: [
    "操作规范（请严格遵守）：",
    "1. 每一步只调用一个工具，参数是一个 JSON 对象；绝对不要一次调用多个工具。",
    "2. 必须等工具结果返回并阅读后，再决定下一步；不要假设某次调用成功了。",
    "3. 只使用上面列出的工具名。没有合适的工具时，用纯文本说明，不要自己臆造工具。",
    "4. 参数名必须与上面文档完全一致，不要添加多余字段。",
    "5. 如果结果以 'Error:' 或 'Refused:' 开头，修正参数后再次调用同一个工具；连续失败两次就用纯文本说明问题并停止。",
    "6. 路径必须与用户给的一致（例如 C:\\Users\\Name\\file.txt），不要自己猜测路径。",
    "7. 执行破坏性操作前（删除、移动、结束进程、停止服务、改注册表、关机），先用一句话说明你将要做什么。",
    "8. 如果任务有两件或更多事，先调用 todo（action 为 \"set\"，每件事一条），做完一件就把它标记为 \"done\"。",
    "9. 任务完成后，用纯文本简短总结你做了什么，此时不要再调用工具。",
    "10. 本模式没有命令行工具：不要自己编写任何命令、脚本或注册表路径，每一步都必须是上面列出的工具动作。",
  ].join("\n"),
};

/** Configuration object consumed by the LLM client and the agent. */
export interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxSteps: number;
  temperature: number;
  /** Refuse a third identical call that has already returned the same answer twice. */
  loopGuard: boolean;
  /**
   * Refuse to end a turn while the model's own checklist still has open items (up
   * to a couple of reminders). See src/todo.ts.
   */
  todoCheck: boolean;
  language: Language;
  systemPrompt: string;
  workdir: string;
  /** How much guidance the agent gives the model (see AgentMode). */
  agentMode: AgentMode;
  /** Stream the model's answer token by token instead of waiting for all of it. */
  stream: boolean;
  /** Context window used for budgeting (0 = unlimited / unknown). */
  contextLimit: number;
  /** How long to wait for one request before giving up. */
  requestTimeoutMs: number;
  /** How many times to retry a failed request (429 / 5xx / network). */
  maxRetries: number;
}

/** A user-defined command exposed to the agent as a tool (PowerShell script). */
export interface CustomTool {
  name: string;
  description: string;
  script: string;
}

/**
 * A switchable model endpoint. `local` profiles talk to a local server
 * (LM Studio, Ollama, llama.cpp), `api` profiles to a cloud OpenAI-compatible
 * service. Exactly one profile is active at a time.
 */
export interface Profile {
  id: string;
  name: string;
  kind: "local" | "api";
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Model ids remembered from the last /models lookup for this endpoint. */
  models: string[];
}

/** Everything that can be configured, at runtime, from the web UI or the terminal. */
export interface Settings {
  // Model / API (mirror of the active profile - kept in sync automatically)
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Switchable endpoints ("local" server vs. cloud API). */
  profiles: Profile[];
  activeProfile: string;
  maxSteps: number;
  temperature: number;
  language: Language;
  systemPrompt: string;
  // Environment
  workdir: string;
  powershell: string;
  /** Force PowerShell error messages to English (a small model reads them better). */
  psEnglishErrors: boolean;
  webPort: number;
  autoOpenBrowser: boolean;
  // Behaviour
  dryRun: boolean;
  autoApprove: boolean;
  /**
   * Stop a model that keeps issuing the same call and getting the same answer
   * (on by default). The third identical call in a row is answered with a note
   * instead of being run again. See src/agent.ts.
   */
  loopGuard: boolean;
  /**
   * Refuse to end a turn while the model's own checklist still has open items (on
   * by default, at most two reminders). It changes nothing on the machine; it only
   * makes "I finished" mean something. See src/todo.ts.
   */
  todoCheck: boolean;
  /**
   * Confine every file path the tools are handed to the working directory (on by
   * default). While it is on, the raw shell and custom commands are withheld too.
   * See src/sandbox.ts.
   */
  sandbox: boolean;
  /** normal = plain prompt, guided = step-by-step supervision for small models. */
  agentMode: AgentMode;
  /** How much of the process the chat view shows (see Verbosity). */
  verbosity: Verbosity;
  /** Write every change to data/audit.jsonl and keep a stack of undoable ones. */
  auditLog: boolean;
  /**
   * How many days the copies that make an undo possible are kept (at least 1,
   * 7 by default). Past the window the entry stops being undoable, it is not
   * half-restored. See src/audit.ts.
   */
  undoRetentionDays: number;
  /** Persist the conversation to disk so it survives restarts (记忆化). */
  remember: boolean;
  /** Stream replies token by token (lower perceived latency on local models). */
  stream: boolean;
  /** Context window to budget against; 0 = use the discovered value when known. */
  contextLimit: number;
  /** Context lengths discovered from the endpoint, keyed by model id. */
  modelContext: Record<string, number>;
  /** How long one LLM request may take before it is abandoned (ms). */
  requestTimeoutMs: number;
  /** Retries for 429 / 5xx / network errors. */
  maxRetries: number;
  // Web tool
  /** Search page used by the web tool; {q} is replaced by the query. */
  webSearchUrl: string;
  // Tools
  enabledTools: string[] | null; // null = all tools
  customTools: CustomTool[];
  // MCP (Model Context Protocol)
  /** Master switch: when off, no MCP server is started and no MCP tool is offered. */
  mcpEnabled: boolean;
  /**
   * MCP *server* mode (`--mcp-server`): another MCP client runs win-agent's tools.
   * There is no human at this agent's UI, so anything that would ask for approval is
   * refused unless this is on.
   */
  mcpServeAutoApprove: boolean;
  /** Servers whose tools the model may call (see src/mcp.ts). */
  mcpServers: McpServer[];
  /** Merge every local endpoint's loadable models into one list in the pickers. */
  syncLocalModels: boolean;
  /** Recently used working directories, newest first (the chat picker). */
  recentWorkdirs: string[];
}

export const DEFAULT_SYSTEM_PROMPT = [
  "You are a Windows automation agent running locally on the user's PC.",
  "You help the user by calling the provided tools - never by guessing raw commands.",
  "Rules:",
  "1. Pick the most specific tool for the job and pass a single JSON object of arguments.",
  "2. Send one or a few tool calls at a time, then look at the results before continuing.",
  "3. If a tool returns 'Error:' or a failure message, read it and adjust your arguments.",
  "4. Some actions need approval and may be cancelled; respect that and suggest an alternative.",
  "5. When the task is done, reply in plain text with a short summary. Do not call tools then.",
  "6. If the request has more than one part, write the parts down with the todo tool and tick each one off. Do not finish while an item is still open.",
  "Keep answers concise. Prefer doing over explaining.",
].join("\n");

/** Endpoints offered out of the box. `local` is the one used by default. */
export const DEFAULT_PROFILES: Profile[] = [
  {
    id: "local",
    name: "本地 API (LM Studio / Ollama)",
    kind: "local",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "local",
    model: "glm-4.7-flash",
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "ollama",
    model: "qwen2.5:7b",
    models: [],
  },
  {
    id: "cloud",
    name: "云端 API (OpenAI 兼容)",
    kind: "api",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    models: [],
  },
];

export const DEFAULTS: Settings = {
  model: DEFAULT_PROFILES[0].model,
  baseUrl: DEFAULT_PROFILES[0].baseUrl,
  apiKey: DEFAULT_PROFILES[0].apiKey,
  profiles: DEFAULT_PROFILES,
  activeProfile: "local",
  maxSteps: 0,
  temperature: 0,
  // A model that repeats itself is the most common way a small model burns a turn.
  loopGuard: true,
  // A model that says "done" with half the list still open is the second most common.
  todoCheck: true,
  language: "zh",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  workdir: process.cwd(),
  powershell: "powershell.exe",
  psEnglishErrors: true,
  webPort: 8787,
  autoOpenBrowser: true,
  dryRun: false,
  autoApprove: false,
  // Safety first: paths stay inside the working directory unless the user turns
  // the sandbox off. A sandbox that is off by default does nothing for anybody.
  sandbox: true,
  // The project exists to drive Windows with *small* local models, so the
  // supervised mode is the default. One switch flips it to the plain prompt.
  agentMode: "guided",
  // A small model chatters: dozens of tool calls before it answers. The quiet view
  // is the default, and two steps up turn the machine room back on.
  verbosity: "answer",
  auditLog: true,
  // A week of copies, so "undo" still works tomorrow - and the day after.
  undoRetentionDays: 7,
  remember: true,
  stream: true,
  contextLimit: 0,
  modelContext: {},
  requestTimeoutMs: 180_000,
  maxRetries: 2,
  webSearchUrl: "https://www.bing.com/search?q={q}",
  enabledTools: null,
  customTools: [],
  mcpEnabled: false,
  mcpServeAutoApprove: false,
  mcpServers: [],
  syncLocalModels: true,
  recentWorkdirs: [],
};

const STRING_KEYS: Array<keyof Settings> = [
  "model",
  "baseUrl",
  "apiKey",
  "activeProfile",
  "systemPrompt",
  "workdir",
  "powershell",
  "webSearchUrl",
];
const NUMBER_KEYS: Array<keyof Settings> = [
  "maxSteps",
  "temperature",
  "webPort",
  "contextLimit",
  "requestTimeoutMs",
  "maxRetries",
  "undoRetentionDays",
];
const BOOLEAN_KEYS: Array<keyof Settings> = [
  "dryRun",
  "autoApprove",
  "loopGuard",
  "todoCheck",
  "sandbox",
  "autoOpenBrowser",
  "remember",
  "stream",
  "psEnglishErrors",
  "mcpEnabled",
  "mcpServeAutoApprove",
  "syncLocalModels",
  "auditLog",
];
const NUMERIC_RANGE: Record<string, [number, number]> = {
  // 0 = no step limit: the loop guard stops a dead end, the user stops a long run.
  maxSteps: [0, 1000],
  temperature: [0, 2],
  webPort: [1, 65535],
  contextLimit: [0, 2_000_000],
  requestTimeoutMs: [5_000, 3_600_000],
  maxRetries: [0, 10],
  undoRetentionDays: [1, 365],
};

const CUSTOM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Fixed on first use so a later `chdir` (workdir) cannot move the file. */
let pinnedSettingsFile: string | null = null;

export function settingsFile(): string {
  if (pinnedSettingsFile) return pinnedSettingsFile;
  const override = process.env.AGENT_SETTINGS_FILE;
  pinnedSettingsFile = override
    ? path.resolve(override)
    : path.join(dataDir(), "settings.json");
  return pinnedSettingsFile;
}

let current: Settings = { ...DEFAULTS };

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|on|1)$/i.test(value)) return true;
    if (/^(false|no|off|0)$/i.test(value)) return false;
  }
  if (typeof value === "number") return value !== 0;
  throw new Error(`expected a boolean, got ${JSON.stringify(value)}`);
}

function asNumber(key: string, value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) throw new Error(`${key} must be a number`);
  const range = NUMERIC_RANGE[key];
  if (range && (num < range[0] || num > range[1])) {
    throw new Error(`${key} must be between ${range[0]} and ${range[1]}`);
  }
  return num;
}

function asCustomTools(value: unknown): CustomTool[] {
  if (!Array.isArray(value)) throw new Error("customTools must be an array");
  return value.map((entry) => {
    const item = entry as Record<string, unknown>;
    const name = String(item.name ?? "");
    if (!CUSTOM_NAME.test(name)) {
      throw new Error(`custom tool name "${name}" must be letters, digits or underscore`);
    }
    return {
      name,
      description: String(item.description ?? `Run custom command ${name}`),
      script: String(item.script ?? ""),
    };
  });
}

/** Model id -> context length, as discovered from the endpoint. */
function asModelContext(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("modelContext must be an object of model -> tokens");
  }
  const out: Record<string, number> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const tokens = Number(raw);
    if (name && Number.isFinite(tokens) && tokens > 0) out[String(name)] = Math.round(tokens);
  }
  return out;
}

function asProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) throw new Error("profiles must be an array");
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`profile id "${id}" must be letters, digits, "-" or "_"`);
    }
    return {
      id,
      name: String(item.name ?? id),
      kind: item.kind === "api" ? "api" : "local",
      baseUrl: String(item.baseUrl ?? "").replace(/\/+$/, ""),
      apiKey: String(item.apiKey ?? ""),
      model: String(item.model ?? ""),
      models: Array.isArray(item.models) ? item.models.map((m) => String(m)) : [],
    } as Profile;
  });
}

/** Validate the MCP server list (see src/mcp.ts). */
function asMcpServers(value: unknown): McpServer[] {
  if (!Array.isArray(value)) throw new Error("mcpServers must be an array");
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
      throw new Error(`MCP server id "${id}" must be letters, digits, "-" or "_" (max 32)`);
    }
    const env: Record<string, string> = {};
    for (const [name, raw] of Object.entries((item.env ?? {}) as Record<string, unknown>)) {
      if (name) env[String(name)] = String(raw);
    }
    const transport = item.transport === "http" ? "http" : "stdio";
    return {
      id,
      name: String(item.name ?? id),
      transport,
      command: String(item.command ?? ""),
      args: Array.isArray(item.args) ? item.args.map((a) => String(a)) : [],
      env,
      url: String(item.url ?? ""),
      enabled: item.enabled !== false,
      autoApprove: item.autoApprove === true,
      tools: Array.isArray(item.tools) ? item.tools.map((t) => String(t)) : [],
    } as McpServer;
  });
}

/** Recently used working directories: strings, newest first, at most 10. */
function asRecentWorkdirs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("recentWorkdirs must be an array");
  return value
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, 10);
}

/** Coerce and validate a single setting value. */
export function coerceSetting(key: string, value: unknown): unknown {
  if (!(key in DEFAULTS)) throw new Error(`unknown setting "${key}"`);
  const typed = key as keyof Settings;
  if (STRING_KEYS.includes(typed)) return String(value);
  if (NUMBER_KEYS.includes(typed)) return asNumber(key, value);
  if (BOOLEAN_KEYS.includes(typed)) return asBoolean(value);
  if (typed === "language") return normalizeLanguage(value);
  if (typed === "agentMode") return normalizeAgentMode(value);
  if (typed === "verbosity") return normalizeVerbosity(value);
  if (typed === "modelContext") return asModelContext(value);
  if (typed === "profiles") return asProfiles(value);
  if (typed === "enabledTools") {
    if (value === null || value === "all" || value === "") return null;
    if (!Array.isArray(value)) throw new Error("enabledTools must be an array or null");
    return value.map((v) => String(v));
  }
  if (typed === "customTools") return asCustomTools(value);
  if (typed === "mcpServers") return asMcpServers(value);
  if (typed === "recentWorkdirs") return asRecentWorkdirs(value);
  throw new Error(`unsupported setting "${key}"`);
}

/* -------------------------------------------------------------------------- */
/* Load / update / save                                                       */
/* -------------------------------------------------------------------------- */

function readFileSettings(): Record<string, unknown> {
  const file = settingsFile();
  settingsWarning = null;
  if (!fs.existsSync(file)) return {};
  try {
    // Notepad's "Unicode" save option (and Windows PowerShell's own defaults)
    // produce UTF-16, which would otherwise look like a corrupt settings file.
    const decoded = decodeText(fs.readFileSync(file));
    const { value, bom } = parseJsonWithBom<Record<string, unknown>>(decoded.text);
    const mark = decoded.bom ?? bom;
    if (mark) settingsWarning = `${file} starts with a ${bomLabel(mark)}; it was read anyway, but saving from the UI rewrites it cleanly.`;
    return value;
  } catch (error) {
    // Never silently: a settings file that cannot be parsed looks exactly like
    // "my settings don't work", so say so where the user will see it.
    settingsWarning = `${file} is not valid JSON (${(error as Error).message}) - the defaults are being used. Fix it or delete it.`;
    return {};
  }
}

let settingsWarning: string | null = null;

/** Set when data/settings.json had a byte-order mark or could not be parsed. */
export function settingsFileWarning(): string | null {
  return settingsWarning;
}

function fromEnv(): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const env = process.env;
  if (env.AGENT_MODEL) patch.model = env.AGENT_MODEL;
  if (env.OPENAI_BASE_URL ?? env.AGENT_BASE_URL) patch.baseUrl = env.OPENAI_BASE_URL ?? env.AGENT_BASE_URL;
  if (env.OPENAI_API_KEY ?? env.AGENT_API_KEY) patch.apiKey = env.OPENAI_API_KEY ?? env.AGENT_API_KEY;
  if (env.AGENT_MAX_STEPS) patch.maxSteps = env.AGENT_MAX_STEPS;
  if (env.AGENT_LOOP_GUARD) patch.loopGuard = env.AGENT_LOOP_GUARD;
  if (env.AGENT_TODO_CHECK) patch.todoCheck = env.AGENT_TODO_CHECK;
  if (env.AGENT_LANGUAGE) patch.language = env.AGENT_LANGUAGE;
  if (env.AGENT_SYSTEM_PROMPT) patch.systemPrompt = env.AGENT_SYSTEM_PROMPT;
  if (env.AGENT_WORKDIR) patch.workdir = env.AGENT_WORKDIR;
  if (env.AGENT_POWERSHELL) patch.powershell = env.AGENT_POWERSHELL;
  if (env.AGENT_PS_ENGLISH_ERRORS) patch.psEnglishErrors = env.AGENT_PS_ENGLISH_ERRORS;
  if (env.AGENT_MODE) patch.agentMode = env.AGENT_MODE;
  if (env.AGENT_SANDBOX) patch.sandbox = env.AGENT_SANDBOX;
  if (env.AGENT_VERBOSITY) patch.verbosity = env.AGENT_VERBOSITY;
  if (env.AGENT_AUDIT_LOG) patch.auditLog = env.AGENT_AUDIT_LOG;
  if (env.AGENT_UNDO_RETENTION_DAYS) patch.undoRetentionDays = env.AGENT_UNDO_RETENTION_DAYS;
  if (env.AGENT_WEB_PORT) patch.webPort = env.AGENT_WEB_PORT;
  if (env.AGENT_STREAM) patch.stream = env.AGENT_STREAM;
  if (env.AGENT_CONTEXT_LIMIT) patch.contextLimit = env.AGENT_CONTEXT_LIMIT;
  if (env.AGENT_REQUEST_TIMEOUT_MS) patch.requestTimeoutMs = env.AGENT_REQUEST_TIMEOUT_MS;
  if (env.AGENT_MAX_RETRIES) patch.maxRetries = env.AGENT_MAX_RETRIES;
  if (env.AGENT_MCP_SERVE_AUTO_APPROVE) patch.mcpServeAutoApprove = env.AGENT_MCP_SERVE_AUTO_APPROVE;
  if (env.AGENT_WEB_SEARCH_URL) patch.webSearchUrl = env.AGENT_WEB_SEARCH_URL;
  return patch;
}

function mergeInto(patch: Record<string, unknown>): void {
  const bag = current as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) {
      if (key === "enabledTools") bag[key] = null;
      continue;
    }
    try {
      bag[key] = coerceSetting(key, value);
    } catch {
      // ignore invalid values coming from env/file, keep defaults
    }
  }
}

export function loadSettings(): Settings {
  current = { ...DEFAULTS, profiles: DEFAULT_PROFILES.map((p) => ({ ...p, models: [...p.models] })) };
  // Pull any pre-data-folder files across before reading them.
  migrateLegacyData();
  const file = readFileSettings();
  const env = fromEnv();
  const hasProfiles = Array.isArray(file.profiles) || Array.isArray(env.profiles);
  mergeInto(file);
  mergeInto(env);
  if (!hasProfiles) {
    // Config written before profiles existed (or hand-edited flat fields):
    // adopt the flat endpoint as the active profile so nothing is lost.
    const active = activeProfile();
    active.baseUrl = current.baseUrl;
    active.apiKey = current.apiKey;
    active.model = current.model;
  }
  syncMirror();
  return current;
}

/** The currently selected endpoint (never returns undefined). */
export function activeProfile(settings: Settings = current): Profile {
  const found = settings.profiles.find((p) => p.id === settings.activeProfile);
  if (found) return found;
  return {
    id: settings.activeProfile || "default",
    name: settings.activeProfile || "default",
    kind: "local",
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    models: [],
  };
}

/** Keep the flat model/baseUrl/apiKey fields pointing at the active profile. */
function syncMirror(): void {
  const profile = activeProfile();
  current.baseUrl = profile.baseUrl;
  current.apiKey = profile.apiKey;
  current.model = profile.model;
}

export function getSettings(): Settings {
  return current;
}

export interface ContextLimit {
  /** Token budget to use; 0 means "we do not know, do not budget". */
  limit: number;
  /** Why that number: "settings", "model list" or "unknown". */
  source: "settings" | "model" | "unknown";
}

/**
 * The context budget for the active model: the explicit `contextLimit` first,
 * then whatever the endpoint told us about that model.
 */
export function effectiveContextLimit(settings: Settings = current): ContextLimit {
  if (settings.contextLimit > 0) return { limit: settings.contextLimit, source: "settings" };
  const discovered = settings.modelContext?.[settings.model];
  if (discovered && discovered > 0) return { limit: discovered, source: "model" };
  return { limit: 0, source: "unknown" };
}

/** Remember the context lengths an endpoint reported. */
export function rememberContextLimits(models: Record<string, number>): number {
  const merged = { ...current.modelContext, ...models };
  const before = Object.keys(current.modelContext).length;
  current.modelContext = merged;
  return Object.keys(merged).length - before;
}

/** Look up a profile by id. */
export function findProfile(id: string): Profile | undefined {
  return current.profiles.find((p) => p.id === id);
}

export function profileIds(): string[] {
  return current.profiles.map((p) => p.id);
}

/** Add a profile, or overwrite the fields of an existing one. */
export function upsertProfile(next: Profile): void {
  const list = current.profiles.map((p) => ({ ...p, models: [...p.models] }));
  const index = list.findIndex((p) => p.id === next.id);
  if (index >= 0) list[index] = { ...list[index], ...next };
  else list.push(next);
  updateSettings({ profiles: list });
}

/** Delete a profile. Switching away from the active one happens automatically. */
export function removeProfile(id: string): void {
  if (current.profiles.length <= 1) throw new Error("the last profile cannot be removed");
  updateSettings({ profiles: current.profiles.filter((p) => p.id !== id) });
  if (current.activeProfile === id) updateSettings({ activeProfile: current.profiles[0].id });
}

/** Replace (or add) a profile's remembered model list. */
export function rememberModels(id: string, models: string[]): void {
  const profile = current.profiles.find((p) => p.id === id);
  if (profile) profile.models = models;
}

export interface UpdateResult {
  settings: Settings;
  changed: string[];
}

export function updateSettings(patch: Record<string, unknown>): UpdateResult {
  const changed: string[] = [];
  const bag = current as unknown as Record<string, unknown>;
  const workdirBefore = current.workdir;

  // Switching profile swaps the whole endpoint in first.
  if (typeof patch.activeProfile === "string" && patch.activeProfile !== current.activeProfile) {
    const target = current.profiles.find((p) => p.id === patch.activeProfile);
    if (!target) throw new Error(`unknown profile "${patch.activeProfile}"`);
    current.activeProfile = target.id;
    syncMirror();
    changed.push("activeProfile", "model", "baseUrl");
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === "activeProfile" || value === undefined) continue;
    const next = coerceSetting(key, value);
    if (JSON.stringify(current[key as keyof Settings]) !== JSON.stringify(next)) changed.push(key);
    bag[key] = next;
  }

  // A changed profile list may have edited the active endpoint: re-derive the
  // flat mirror first, then let explicit endpoint edits win.
  if ("profiles" in patch) syncMirror();

  const profile = current.profiles.find((p) => p.id === current.activeProfile);
  if (profile) {
    if ("baseUrl" in patch) profile.baseUrl = current.baseUrl;
    if ("apiKey" in patch) profile.apiKey = current.apiKey;
    if ("model" in patch) profile.model = current.model;
  }
  for (const key of ["baseUrl", "apiKey", "model"]) {
    if (changed.includes(key) && !changed.includes("activeProfile")) changed.push("activeProfile");
  }

  // Keep the working-directory history the chat picker offers: the folder we
  // just moved to, and the one we came from, so switching back is one click.
  if (changed.includes("workdir")) {
    const recent = [current.workdir, workdirBefore, ...current.recentWorkdirs].filter(Boolean);
    current.recentWorkdirs = [...new Set(recent)].slice(0, 10);
  }

  return { settings: current, changed: changed.filter((v, i, a) => a.indexOf(v) === i) };
}

export function saveSettings(): void {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

/** Settings without the secrets, plus flags telling the UI whether keys are set. */
export function publicSettings(): Omit<Settings, "apiKey" | "profiles"> & {
  apiKeySet: boolean;
  profiles: Array<Omit<Profile, "apiKey"> & { apiKeySet: boolean }>;
} {
  const { apiKey, profiles, ...rest } = current;
  return {
    ...rest,
    apiKeySet: apiKey.length > 0,
    profiles: profiles.map(({ apiKey: key, ...profile }) => ({
      ...profile,
      apiKeySet: key.length > 0,
    })),
  };
}

export function toConfig(settings: Settings = current): Config {
  const context = effectiveContextLimit(settings);
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    maxSteps: settings.maxSteps,
    temperature: settings.temperature,
    loopGuard: settings.loopGuard !== false,
    todoCheck: settings.todoCheck !== false,
    language: settings.language,
    systemPrompt: settings.systemPrompt,
    workdir: settings.workdir,
    agentMode: settings.agentMode,
    stream: settings.stream,
    contextLimit: context.limit,
    requestTimeoutMs: settings.requestTimeoutMs,
    maxRetries: settings.maxRetries,
  };
}
