import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, Usage } from "./llm.js";

/**
 * 数据文件夹 / data folder.
 *
 * Everything the agent persists lives under one visible folder in the project:
 *
 *   data/
 *     README.md              what this folder is
 *     settings.json          your configuration (contains API keys!)
 *     history.json           the conversation that is open right now
 *     usage.json             token totals summed over every conversation
 *     conversations/
 *       <id>.json            one archived conversation per file
 *
 * Override the location with AGENT_DATA_DIR.
 */

/** Token totals, additive across calls. */
export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  /** How many of those calls reported a cache counter at all. */
  cacheReported: number;
  reasoningTokens: number;
  elapsedMs: number;
}

/** One LLM call, stored next to the conversation it belongs to. */
export interface UsageEntry extends Usage {
  at: string;
}

/** A conversation = the messages plus what they cost. */
export interface ConversationRecord {
  id: string;
  startedAt: string;
  updatedAt: string;
  usage: UsageTotals;
  /** Calls in order; entry N belongs to assistant message N. */
  calls: UsageEntry[];
  messages: ChatMessage[];
}

export function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    cacheReported: 0,
    reasoningTokens: 0,
    elapsedMs: 0,
  };
}

export function addUsage(totals: UsageTotals, usage: Usage): UsageTotals {
  return {
    calls: totals.calls + 1,
    promptTokens: totals.promptTokens + usage.promptTokens,
    completionTokens: totals.completionTokens + usage.completionTokens,
    totalTokens: totals.totalTokens + usage.totalTokens,
    cachedTokens: totals.cachedTokens + usage.cachedTokens,
    cacheReported: totals.cacheReported + (usage.cacheReported ? 1 : 0),
    reasoningTokens: totals.reasoningTokens + usage.reasoningTokens,
    elapsedMs: totals.elapsedMs + usage.elapsedMs,
  };
}

/* ------------------------------------------------------------------ paths */

/**
 * The data folder is fixed the first time it is needed, so that changing
 * `workdir` (which calls `process.chdir`) can never move it out from under the
 * files that are already there.
 */
let pinnedDataDir: string | null = null;

export function dataDir(): string {
  if (pinnedDataDir) return pinnedDataDir;
  const override = process.env.AGENT_DATA_DIR;
  pinnedDataDir = override ? path.resolve(override) : path.join(process.cwd(), "data");
  return pinnedDataDir;
}

export function conversationsDir(): string {
  return path.join(dataDir(), "conversations");
}

export function historyFile(): string {
  return path.join(dataDir(), "history.json");
}

export function usageFile(): string {
  return path.join(dataDir(), "usage.json");
}

function ensureDirs(): void {
  fs.mkdirSync(conversationsDir(), { recursive: true });
}

const DATA_README = `# win-agent data

Everything the agent remembers lives in this folder. Safe to delete - it will be
recreated (your conversation history and totals are lost, settings go back to
the defaults).

| File | What it is |
| --- | --- |
| \`settings.json\` | your configuration. **Contains API keys - do not commit it.** |
| \`history.json\` | the conversation that is currently open |
| \`usage.json\` | token totals summed over every conversation |
| \`conversations/\` | one archived conversation per file, written when you start a new one |

You can move this folder elsewhere with \`AGENT_DATA_DIR\`, e.g.
\`AGENT_DATA_DIR=D:\\\\win-agent-data\`.
`;

function writeDataReadme(): void {
  const file = path.join(dataDir(), "README.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, DATA_README, "utf8");
}

/* --------------------------------------------------------------- migration */

/**
 * Older versions kept everything in `.win-agent/`. Move those files into the
 * data folder the first time we run, so nothing is lost.
 */
export function migrateLegacyData(): string[] {
  const moved: string[] = [];
  const legacy = path.join(process.cwd(), ".win-agent");
  ensureDirs();
  for (const name of ["settings.json", "history.json"]) {
    const from = path.join(legacy, name);
    const to = path.join(dataDir(), name);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      try {
        fs.copyFileSync(from, to);
        moved.push(name);
      } catch {
        // leave it alone; the defaults still work
      }
    }
  }
  writeDataReadme();
  legacyMoved = moved;
  return moved;
}

let legacyMoved: string[] = [];

/** Files copied out of the old `.win-agent/` folder on this run. */
export function legacyMovedFiles(): string[] {
  return legacyMoved;
}

export function ensureDataFolder(): void {
  ensureDirs();
  writeDataReadme();
}

/* ------------------------------------------------------------ conversation */

export function newConversationId(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "_" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("-");
}

export function newConversation(id = newConversationId()): ConversationRecord {
  const now = new Date().toISOString();
  return { id, startedAt: now, updatedAt: now, usage: emptyTotals(), calls: [], messages: [] };
}

function parseRecord(raw: string): ConversationRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationRecord>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      id: String(parsed.id ?? "unknown"),
      startedAt: String(parsed.startedAt ?? ""),
      updatedAt: String(parsed.updatedAt ?? ""),
      usage: { ...emptyTotals(), ...(parsed.usage ?? {}) },
      calls: Array.isArray(parsed.calls) ? (parsed.calls as UsageEntry[]) : [],
      messages: Array.isArray(parsed.messages) ? (parsed.messages as ChatMessage[]) : [],
    };
  } catch {
    return null;
  }
}

/** The conversation that is currently open (survives restarts). */
export function loadConversation(): ConversationRecord {
  try {
    const found = parseRecord(fs.readFileSync(historyFile(), "utf8"));
    if (found) return found;
  } catch {
    // first run
  }
  return newConversation();
}

export function saveConversation(record: ConversationRecord): void {
  try {
    ensureDirs();
    record.updatedAt = new Date().toISOString();
    fs.writeFileSync(historyFile(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch {
    // never break a turn because of a failed write
  }
}

/** Move the open conversation into conversations/<id>.json. */
export function archiveConversation(record: ConversationRecord): string | null {
  if (record.messages.length === 0 && record.usage.calls === 0) return null;
  try {
    ensureDirs();
    const file = path.join(conversationsDir(), `${record.id}.json`);
    record.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    bumpConversationCount();
    return file;
  } catch {
    return null;
  }
}

/** One more conversation now lives in data/conversations. */
function bumpConversationCount(delta = 1): void {
  try {
    const totals = loadCumulative();
    const next: CumulativeUsage = {
      ...totals,
      conversations: Math.max(0, totals.conversations + delta),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(usageFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }
}

/** Bring an archived conversation back: it is open again, so it is not archived. */
export function unarchiveConversation(id: string): boolean {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return false;
  try {
    const file = path.join(conversationsDir(), `${safe}.json`);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file, { force: true });
    bumpConversationCount(-1);
    return true;
  } catch {
    return false;
  }
}

export interface ConversationSummary {
  id: string;
  startedAt: string;
  updatedAt: string;
  messages: number;
  usage: UsageTotals;
  bytes: number;
}

export function listConversations(): ConversationSummary[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(conversationsDir()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const rows: ConversationSummary[] = [];
  for (const name of files) {
    const file = path.join(conversationsDir(), name);
    try {
      const record = parseRecord(fs.readFileSync(file, "utf8"));
      if (!record) continue;
      rows.push({
        id: record.id,
        startedAt: record.startedAt,
        updatedAt: record.updatedAt,
        messages: record.messages.length,
        usage: record.usage,
        bytes: fs.statSync(file).size,
      });
    } catch {
      // skip unreadable files
    }
  }
  return rows.sort((a, b) => b.id.localeCompare(a.id));
}

export function readConversation(id: string): ConversationRecord | null {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  try {
    return parseRecord(fs.readFileSync(path.join(conversationsDir(), `${safe}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function deleteConversation(id: string): boolean {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  try {
    fs.rmSync(path.join(conversationsDir(), `${safe}.json`), { force: true });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ total usage */

export interface CumulativeUsage extends UsageTotals {
  conversations: number;
  updatedAt: string;
}

export function loadCumulative(): CumulativeUsage {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageFile(), "utf8")) as Partial<CumulativeUsage>;
    return {
      ...emptyTotals(),
      conversations: Number(parsed.conversations ?? 0),
      updatedAt: String(parsed.updatedAt ?? ""),
      ...parsed,
    } as CumulativeUsage;
  } catch {
    return { ...emptyTotals(), conversations: 0, updatedAt: "" };
  }
}

export function addCumulative(usage: Usage): CumulativeUsage {
  const totals = loadCumulative();
  const next: CumulativeUsage = {
    ...addUsage(totals, usage),
    conversations: totals.conversations,
    updatedAt: new Date().toISOString(),
  };
  try {
    ensureDirs();
    fs.writeFileSync(usageFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }
  return next;
}

export function countArchived(): number {
  try {
    return fs.readdirSync(conversationsDir()).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export interface DataInfo {
  dir: string;
  settingsFile: string;
  historyFile: string;
  usageFile: string;
  conversationsDir: string;
  archived: number;
}

export function dataInfo(): DataInfo {
  return {
    dir: dataDir(),
    settingsFile: path.join(dataDir(), "settings.json"),
    historyFile: historyFile(),
    usageFile: usageFile(),
    conversationsDir: conversationsDir(),
    archived: countArchived(),
  };
}
