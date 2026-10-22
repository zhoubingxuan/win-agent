import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Agent } from "./agent.js";
import {
  activeProfile,
  effectiveContextLimit,
  findProfile,
  getSettings,
  loadSettings,
  publicSettings,
  rememberContextLimits,
  rememberModels,
  saveSettings,
  settingsFile,
  settingsFileWarning,
  toConfig,
  updateSettings,
} from "./settings.js";
import { configureErrorHints, configurePowerShell, configurePowerShellDiagnostics, powerShellInfo } from "./util/ps.js";
import { auditLog, configureAudit, setAuditTurn } from "./audit.js";
import { deleteSkill, ensureSkillsFolder, findSkill, listSkills, loadSkill, saveSkill, skillsDir } from "./skills.js";
import { createWindowsTools, type Approval } from "./tools/index.js";
import { VERSION } from "./version.js";
import { capabilityReport, capabilities as endpointCapabilities, discoverLocalModels, listModelsAt, localEndpointsFor, probeContextLimits } from "./providers.js";
import { mcp, type McpServer } from "./mcp.js";
import { diagnose, formatDiagnosis } from "./diagnose.js";
import { planContext, schemaTokens, toolCapFor, type ContextStats } from "./context.js";
import { runCommand, type CommandHost } from "./commands.js";
import { clearTodos, seedTodos, todos as boardTodos, todoNudgeNotice } from "./todo.js";
import { addTerminalHistory, getTerminalCwd, runShellLine, setTerminalCwd } from "./terminal.js";
import {
  addCumulative,
  addUsage,
  archiveConversation,
  dataInfo,
  listConversations,
  loadConversation,
  loadCumulative,
  legacyMovedFiles,
  newConversation,
  readConversation,
  saveConversation,
  unarchiveConversation,
  dataDir,
  installDir,
  type ConversationRecord,
  type CumulativeUsage,
  type TurnFile,
  type TurnRecord,
  type UsageEntry,
  type UsageTotals,
} from "./store.js";
import type { ChatMessage, Usage } from "./llm.js";
import type { Profile } from "./settings.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

loadSettings();
let boundPort = getSettings().webPort;

const clients = new Set<http.ServerResponse>();
const pendingApprovals = new Map<string, (approved: boolean) => void>();

/** 记忆化: the conversation that is currently open, restored from disk. */
let conversation: ConversationRecord = getSettings().remember
  ? loadConversation()
  : newConversation();
let running = false;
/**
 * Messages sent while a turn is running. They wait here and start one after
 * another, so a user can hand over three jobs and walk away. In memory only: a
 * restart clears the queue (the conversation itself is still on disk).
 */
const queue: Array<{ id: string; message: string; addedAt: string }> = [];
const MAX_QUEUE = 20;
/** Cancels the LLM request(s) of the turn that is running (the Stop button). */
let taskAbort: AbortController | null = null;

/** The live message list handed to the agent. */
function history(): ChatMessage[] {
  return conversation.messages;
}

function persistHistory(record: ConversationRecord = conversation): void {
  if (getSettings().remember) saveConversation(record);
}

/** The last few turns with their file lists are kept per conversation. */
const MAX_TURN_RECORDS = 30;

/**
 * The files one turn changed, newest change first, one row per file. A turn that
 * touched the same file three times shows it once, pointing at the last change -
 * that is the one a rollback should start from.
 */
function turnFiles(turnId: string): TurnFile[] {
  const files: TurnFile[] = [];
  const seen = new Set<string>();
  for (const entry of auditLog().entriesForTurn(turnId).reverse()) {
    if (entry.action === "undo") continue;
    for (const target of entry.paths) {
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({
        path: target,
        seq: entry.seq,
        action: entry.action,
        tool: entry.tool,
        summary: entry.summary,
        time: entry.time,
      });
    }
  }
  return files;
}

/** A turn as the chat shows it: what is still undoable, what still has a version. */
function turnView(turn: TurnRecord): TurnRecord & {
  files: Array<TurnFile & { undoable: boolean; restorable: boolean }>;
} {
  const pending = new Set(auditLog().pending().map((entry) => entry.seq));
  const bySeq = new Map(auditLog().list(500).map((entry) => [entry.seq, entry]));
  return {
    ...turn,
    files: turn.files.map((file) => {
      const entry = bySeq.get(file.seq);
      return {
        ...file,
        undoable: pending.has(file.seq),
        restorable: Boolean(entry?.version && fs.existsSync(entry.version.copy)),
        atVersion: entryAtVersion(entry),
      };
    }),
  };
}

/** True when the file on disk right now is byte-for-byte the saved version. */
function entryAtVersion(entry: { version?: { path: string; copy: string } | null } | undefined): boolean {
  const version = entry?.version;
  if (!version) return false;
  try {
    const live = fs.statSync(version.path);
    const saved = fs.statSync(version.copy);
    if (!live.isFile() || live.size !== saved.size || live.size > 4 * 1024 * 1024) return false;
    return fs.readFileSync(version.path).equals(fs.readFileSync(version.copy));
  } catch {
    return false;
  }
}

/** Usage of the current conversation plus the all-time totals. */
function usageSnapshot(of: ConversationRecord = conversation): {
  conversation: UsageTotals & {
    id: string;
    startedAt: string;
    tokensPerSecond: number | null;
    cacheHitRate: number | null;
  };
  allTime: CumulativeUsage;
  calls: UsageEntry[];
} {
  const totals = of.usage;
  const seconds = totals.elapsedMs / 1000;
  return {
    conversation: {
      id: of.id,
      startedAt: of.startedAt,
      ...totals,
      tokensPerSecond: seconds > 0 ? totals.completionTokens / seconds : null,
      cacheHitRate:
        totals.cacheReported > 0 && totals.promptTokens > 0
          ? totals.cachedTokens / totals.promptTokens
          : null,
    },
    allTime: loadCumulative(),
    calls: of.calls,
  };
}

/** Starting or loading a conversation under a running turn would mix them up. */
const BUSY = "the agent is busy — wait for the current task to finish";

/**
 * How full the model's context window is right now. Safe to call while idle:
 * it measures the conversation without starting a turn.
 */
function contextSnapshot(): ContextStats & {
  source: "settings" | "model" | "unknown";
  messages: number;
} {
  const { limit, source } = effectiveContextLimit();
  const stats = planContext(conversation.messages, {
    limit: limit || null,
    toolCap: toolCapFor(limit),
    extraTokens: schemaTokens(buildTools().schemas()),
  }).stats;
  return {
    ...stats,
    source,
    messages: conversation.messages.filter((m) => m.role !== "system").length,
  };
}

/** One-line description of a trim, for the UI log. */
function contextNotice(stats: ContextStats): string {
  const parts: string[] = [];
  if (stats.droppedMessages > 0) parts.push(`${stats.droppedMessages} older exchange(s) dropped`);
  if (stats.truncatedToolResults > 0) parts.push(`${stats.truncatedToolResults} tool result(s) shortened`);
  return `context trimmed to fit ${stats.limit} tokens: ${parts.join(", ")} — the stored conversation is unchanged`;
}

/** Compatibility notes already shown to the user, so we only announce them once. */
const announcedCapabilities = new Set<string>();

/** Tell the UI when the endpoint turned out not to support something. */
function announceCapabilities(): void {
  for (const row of capabilityReport()) {
    for (const note of row.notes) {
      const id = `${row.endpoint}|${note}`;
      if (announcedCapabilities.has(id)) continue;
      announcedCapabilities.add(id);
      broadcast({ type: "notice", text: `${row.endpoint} · ${note}` });
    }
  }
}

/** Archive what is open and start a fresh conversation. Returns the record. */
function startNewConversation(): ConversationRecord {
  const archived = archiveConversation(conversation);
  conversation = newConversation();
  clearTodos();
  persistHistory();
  if (archived) broadcast({ type: "archived", id: conversation.id, file: archived });
  return conversation;
}

interface UiEvent {
  type: string;
  [key: string]: unknown;
}

function broadcast(event: UiEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
}

/** Ask an OpenAI-compatible endpoint which models it serves. */
async function fetchModels(profile: Profile): Promise<string[]> {
  const base = profile.baseUrl.replace(/\/+$/, "");
  try {
    return await listModelsAt(profile, 10_000);
  } catch (error) {
    const err = error as Error & { cause?: { code?: string } };
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      throw new Error("the endpoint did not answer in time");
    }
    if (/^the endpoint (answered|listed)/.test(err.message)) throw err;
    const reason = err.cause?.code ?? err.message;
    throw new Error(`cannot reach ${base} (${reason})`);
  }
}

/** Ask the endpoint how big each model's context window is, and remember it. */
async function discoverContext(profile: Profile): Promise<void> {
  const probe = await probeContextLimits(profile);
  if (Object.keys(probe.models).length > 0) {
    rememberContextLimits(probe.models);
    saveSettings();
  }
}

/** Apply side effects of the current settings. Returns human-readable notices. */
function applySettings(): string[] {
  const s = getSettings();
  const notices: string[] = [];
  configurePowerShell(s.powershell);
  configurePowerShellDiagnostics(s.psEnglishErrors);
  // The hint after a failed command follows the interface language; the PowerShell
  // text itself stays English (psEnglishErrors).
  configureErrorHints(s.language);
  // The audit log is a setting like any other: switching it off mid-run stops both
  // the log file and the undo stack.
  configureAudit(s.auditLog);
  if (auditLog().error()) notices.push(`warning: ${auditLog().error()}`);

  // A settings file that had a BOM or does not parse is worth saying out loud:
  // otherwise it just looks like the settings were ignored.
  const settingsWarning = settingsFileWarning();
  if (settingsWarning) notices.push(`warning: ${settingsWarning}`);

  try {
    if (!fs.existsSync(s.workdir)) {
      notices.push(`warning: workdir does not exist: ${s.workdir}`);
    } else if (!fs.statSync(s.workdir).isDirectory()) {
      notices.push(`warning: workdir is not a folder: ${s.workdir}`);
    } else {
      process.chdir(s.workdir);
    }
  } catch (error) {
    notices.push(`warning: cannot use workdir ${s.workdir}: ${(error as Error).message}`);
  }
  return notices;
}

const bootNotices = [
  ...applySettings(),
  ...legacyMovedFiles().map((name) => `moved .win-agent/${name} into ${dataDir()}`),
];

// The terminal keeps its own working directory (so `cd` feels persistent across
// lines); start it in the configured workdir instead of wherever the server was
// launched from. After this it only moves when the workdir setting changes.
try {
  if (getTerminalCwd() !== path.resolve(getSettings().workdir)) {
    setTerminalCwd(getSettings().workdir);
  }
} catch {
  // applySettings() has already reported the problem with the workdir.
}

/* -------------------------------------------------------------------------- */
/* MCP                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Connect to the enabled MCP servers and refresh the tool cache. Never throws:
 * a server that is down must not stop the agent from starting.
 */
async function refreshMcp(announce = false): Promise<{ tools: number; errors: string[] }> {
  const s = getSettings();
  if (!s.mcpEnabled || s.mcpServers.length === 0) {
    mcp.close();
    return { tools: 0, errors: [] };
  }
  try {
    await mcp.refresh();
  } catch (error) {
    return { tools: 0, errors: [(error as Error).message] };
  }

  const live = mcp.status();
  // Remember what each server offered, so the settings panel still names its
  // tools when the server is not running.
  const next = s.mcpServers.map((server) => {
    const found = live.find((x) => x.id === server.id);
    return found ? { ...server, tools: found.tools } : server;
  });
  if (JSON.stringify(next) !== JSON.stringify(s.mcpServers)) {
    updateSettings({ mcpServers: next });
    saveSettings();
  }

  const errors = live.filter((x) => x.error).map((x) => `${x.name}: ${x.error}`);
  const totalTools = live.reduce((sum, x) => sum + x.tools.length, 0);
  if (announce) {
    broadcast({ type: "settings", settings: publicSettings(), changed: ["mcpServers"] });
    const connected = live.filter((x) => x.connected).length;
    broadcast({
      type: "notice",
      text: `MCP: ${totalTools} tool(s) from ${connected} server(s)`,
    });
    for (const error of errors) broadcast({ type: "notice", text: `warning: MCP ${error}` });
  }
  return { tools: totalTools, errors };
}

/** What the UI needs to draw the MCP panel: config + live state. */
function mcpSnapshot(): {
  enabled: boolean;
  ageMs: number;
  totalTools: number;
  servers: Array<McpServer & { connected: boolean; serverInfo: string; liveTools: string[]; error: string }>;
} {
  const s = getSettings();
  const live = new Map(mcp.status().map((x) => [x.id, x]));
  const servers = s.mcpServers.map((server) => {
    const found = live.get(server.id);
    return {
      ...server,
      connected: found?.connected ?? false,
      serverInfo: found?.serverInfo ?? "",
      liveTools: found?.tools ?? [],
      error: found?.error ?? "",
    };
  });
  return {
    enabled: s.mcpEnabled,
    ageMs: mcp.age(),
    totalTools: servers.reduce((sum, x) => sum + x.liveTools.length, 0),
    servers,
  };
}

if (getSettings().mcpEnabled) {
  // Connect at boot; a missing MCP server is a warning, not a failure. This runs
  // in the background, so a slow server never delays the banner or the browser.
  void refreshMcp(false).then(({ errors }) => {
    const snapshot = mcpSnapshot();
    console.log(
      `  mcp        : on - ${snapshot.servers.length} server(s), ${snapshot.totalTools} tool(s)`,
    );
    for (const error of errors) console.log(`  warning: MCP ${error}`);
  });
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                  */
/* -------------------------------------------------------------------------- */

function makeApproval(): Approval {
  return async (summary: string): Promise<boolean> => {
    const s = getSettings();
    if (s.dryRun) return true;
    if (s.autoApprove) {
      broadcast({ type: "approval", id: "auto", summary, auto: true, approved: true });
      return true;
    }
    const id = randomUUID();
    broadcast({ type: "approval", id, summary, auto: false });
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pendingApprovals.delete(id);
        resolve(false);
      }, 180_000);
      pendingApprovals.set(id, (approved) => {
        clearTimeout(timer);
        pendingApprovals.delete(id);
        resolve(approved);
      });
    });
  };
}

function buildTools() {
  const s = getSettings();
  return createWindowsTools(makeApproval(), {
    dryRun: s.dryRun,
    enabledTools: s.enabledTools,
    customTools: s.customTools,
    webSearchUrl: s.webSearchUrl,
    agentMode: s.agentMode,
  });
}

/* -------------------------------------------------------------------------- */
/* Agent run                                                                  */
/* -------------------------------------------------------------------------- */

/** Where waiting messages survive a restart. */
function queueFile(): string {
  return path.join(dataDir(), "queue.json");
}

/**
 * Write the queue to disk. It is a convenience, never the source of truth for a
 * turn: a read-only data folder must not fail a request because of it.
 */
function saveQueue(): void {
  try {
    fs.writeFileSync(queueFile(), JSON.stringify({ items: queue }, null, 2), "utf8");
  } catch {
    /* the queue still works in memory */
  }
}

/** Read back the messages that were waiting when the server stopped. */
function loadQueue(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(queueFile(), "utf8")) as { items?: unknown };
    if (!Array.isArray(raw.items)) return;
    for (const item of raw.items) {
      const record = item as { id?: unknown; message?: unknown; addedAt?: unknown };
      if (typeof record?.message !== "string" || !record.message.trim()) continue;
      if (queue.length >= MAX_QUEUE) break;
      queue.push({
        id: typeof record.id === "string" ? record.id : randomUUID(),
        message: record.message,
        addedAt: typeof record.addedAt === "string" ? record.addedAt : new Date().toISOString(),
      });
    }
  } catch {
    /* first run: there is no queue file yet */
  }
}

/** Put a message in the queue; null when the queue is full. */
function enqueue(message: string): { id: string; message: string; addedAt: string } | null {
  if (queue.length >= MAX_QUEUE) return null;
  const item = { id: randomUUID(), message, addedAt: new Date().toISOString() };
  queue.push(item);
  saveQueue();
  broadcast({ type: "queue", items: queue });
  return item;
}

/** Start the next queued message, if nothing is running. */
function drainQueue(): void {
  if (running || queue.length === 0) return;
  const next = queue.shift();
  if (!next) return;
  saveQueue();
  broadcast({ type: "queue", items: queue });
  void runAgent(next.message);
}

async function runAgent(message: string): Promise<void> {
  if (running) {
    broadcast({ type: "error", message: "The agent is already working on a task." });
    return;
  }
  running = true;
  const controller = new AbortController();
  taskAbort = controller;
  // Everything the tools change while this run is going belongs to this turn, so
  // the answer can list the files it touched.
  const turnId = randomUUID();
  broadcast({ type: "user", text: message });
  broadcast({ type: "status", running: true });

  // Pick up MCP servers added since the last turn (cached, so this is cheap).
  await mcp.ensureFresh();
  const tools = buildTools();
  // This turn belongs to the conversation that is open right now; keep a direct
  // reference so nothing can be written into a different record mid-turn.
  const convo = conversation;
  // The checklist is conversation state, not turn state: "continue" must pick up the
  // same list, and an untouched list survives a restart with the conversation.
  seedTodos(convo.todos ?? []);
  // Reasoning models can think for a long while before any visible text. The chat
  // view can show that text (verbosity `thinking` and up), so it is forwarded as it
  // arrives - in small batches, so a token-per-event model does not flood the page.
  let reasoningChars = 0;
  let reasoningBuffer = "";
  const flushThinking = (): void => {
    if (!reasoningBuffer) return;
    broadcast({ type: "thinking", text: reasoningBuffer, chars: reasoningChars });
    reasoningBuffer = "";
  };
  // A model that thinks in one long burst would otherwise show nothing until it
  // answers, so the buffer is also drained on a timer.
  const thinkingTimer = setInterval(flushThinking, 200);
  const agent = new Agent(
    toConfig(),
    tools,
    {
      onStep: (step, max) => broadcast({ type: "step", step, max }),
      onAssistantDelta: (text) => broadcast({ type: "delta", text }),
      onReasoning: (text) => {
        reasoningChars += text.length;
        reasoningBuffer += text;
      },
      onAssistantText: (text) => broadcast({ type: "assistant", text }),
      onToolCall: (name, args) => broadcast({ type: "tool_call", name, args }),
      onToolResult: (name, result) => broadcast({ type: "tool_result", name, result }),
      onContext: (stats) => {
        broadcast({ type: "context", ...stats });
        broadcast({ type: "notice", text: contextNotice(stats) });
      },
      onUsage: (usage) => {
        convo.usage = addUsage(convo.usage, usage);
        convo.calls.push({ ...usage, at: new Date().toISOString() });
        addCumulative(usage);
        broadcast({ type: "usage", usage, totals: usageSnapshot(convo) });
      },
      onTodos: (items) => {
        convo.todos = items;
        broadcast({ type: "todo", todos: items });
      },
      onTodoNudge: (open, attempt) => {
        broadcast({ type: "notice", text: todoNudgeNotice(getSettings().language, open, attempt) });
      },
    },
    history(),
  );

  try {
    setAuditTurn(turnId);
    await agent.run(message, controller.signal);
    // The assistant's text was already streamed as "assistant" events by the
    // agent, so "done" only signals that the turn is over (avoids duplicates).
    // Whatever the model thought on the last step goes out first.
    flushThinking();
    broadcast({ type: "done", totals: usageSnapshot(convo) });
  } catch (error) {
    const err = error as Error;
    const stopped = controller.signal.aborted || err.name === "AbortError";
    flushThinking();
    if (stopped) broadcast({ type: "stopped" });
    else broadcast({ type: "error", message: err.message });
  } finally {
    clearInterval(thinkingTimer);
    setAuditTurn(null);
    // Keep whatever the model managed to do, even when it failed or was stopped.
    convo.messages = agent.getHistory();
    // The files this turn changed, for the card under the answer. Cheap enough to
    // rebuild from the log every time, and honest after a stop or an error.
    const files = turnFiles(turnId);
    // A turn may have written a checklist and touched no file at all; the card is
    // still worth saving, because it is what the turn promised.
    const checklist = boardTodos();
    if (files.length > 0 || checklist.length > 0) {
      const turn: TurnRecord = {
        id: turnId,
        time: new Date().toISOString(),
        at: convo.messages.filter((m) => m.role !== "system").length,
        files,
        todos: checklist,
      };
      convo.turns = [...(convo.turns ?? []), turn].slice(-MAX_TURN_RECORDS);
      broadcast({ type: "turn", turn: turnView(turn) });
    }
    persistHistory(convo);
    announceCapabilities();
    broadcast({ type: "context", ...contextSnapshot() });
    running = false;
    taskAbort = null;
    broadcast({ type: "status", running: false });
    // Something may be waiting: start it now that the machine is free.
    drainQueue();
  }
}

/** Stop the running turn: cancel the request and deny any pending approval. */
function stopAgent(): boolean {
  if (!running || !taskAbort) return false;
  for (const [id, resolve] of pendingApprovals) {
    resolve(false);
    pendingApprovals.delete(id);
  }
  taskAbort.abort();
  broadcast({ type: "stopping" });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Terminal host (used by /commands)                                          */
/* -------------------------------------------------------------------------- */

const host: CommandHost = {
  resetHistory: () => {
    if (running) throw new Error(BUSY);
    startNewConversation();
  },
  toolNames: () => buildTools().names(),
  withheld: () => buildTools().withheld(),
  audit: (limit = 15) => ({
    enabled: auditLog().isEnabled(),
    file: auditLog().file(),
    problem: auditLog().error(),
    entries: auditLog().list(limit),
    pending: auditLog().pending(),
  }),
  undo: async (count: number) => {
    // Undoing in the middle of a turn would race the agent: it may be about to
    // write the very file being restored. Stop the turn first.
    if (running) throw new Error(BUSY);
    return auditLog().undo(count);
  },
  applySettings,
  cwd: getTerminalCwd,
  setCwd: setTerminalCwd,
  listModels: async (id?: string) => {
    const profile = (id ? findProfile(id) : undefined) ?? activeProfile();
    try {
      const models = await fetchModels(profile);
      rememberModels(profile.id, models);
      // A local server also knows how big each model's context window is.
      await discoverContext(profile);
      saveSettings();
      broadcast({ type: "settings", settings: publicSettings(), changed: ["profiles", "modelContext"] });
      return { profile: profile.id, baseUrl: profile.baseUrl, models };
    } catch (error) {
      return {
        profile: profile.id,
        baseUrl: profile.baseUrl,
        models: profile.models,
        error: (error as Error).message,
      };
    }
  },
  context: () => {
    const snapshot = contextSnapshot();
    return { stats: snapshot, source: snapshot.source, messages: snapshot.messages };
  },
  capabilities: () =>
    capabilityReport().flatMap((row) => row.notes.map((note) => `${row.endpoint} · ${note}`)),
  diagnose: async () => {
    const report = await diagnose(toConfig());
    if (Object.keys(report.context).length > 0) {
      rememberContextLimits(report.context);
      saveSettings();
      broadcast({ type: "settings", settings: publicSettings(), changed: ["modelContext"] });
    }
    announceCapabilities();
    return formatDiagnosis(report);
  },
  memoryInfo: () => ({
    file: dataInfo().historyFile,
    entries: conversation.messages.filter((m) => m.role !== "system").length,
    bytes: (() => {
      try {
        return fs.statSync(dataInfo().historyFile).size;
      } catch {
        return 0;
      }
    })(),
  }),
  usage: () => usageSnapshot(),
  conversations: () => listConversations(),
  dataInfo: () => dataInfo(),
  abort: () => stopAgent(),
  restart: async (port: number) => {
    updateSettings({ webPort: port });
    saveSettings();
    const url = `http://127.0.0.1:${port}`;
    broadcast({ type: "server_restart", port, url });
    setTimeout(() => void rebind(port), 250);
    return `moving the web UI to ${url} …`;
  },
};

async function runTerminalLine(
  input: string,
  clientId: string,
): Promise<{ output: string; kind: "internal" | "shell" }> {
  addTerminalHistory(input);
  let output: string;
  let kind: "internal" | "shell";

  if (input.trim().startsWith("/")) {
    kind = "internal";
    try {
      output = await runCommand(input, host);
    } catch (error) {
      output = `Error: ${(error as Error).message}`;
    }
  } else {
    kind = "shell";
    try {
      output = (await runShellLine(input)).output;
    } catch (error) {
      output = `Error: ${(error as Error).message}`;
    }
  }

  broadcast({ type: "terminal", input, output, kind, cwd: getTerminalCwd(), clientId });
  return { output, kind };
}

/* -------------------------------------------------------------------------- */
/* Static assets                                                              */
/* -------------------------------------------------------------------------- */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * The UI files belong to *this* installation, never to the folder the agent
 * happens to start in: two version folders must not serve each other's UI.
 */
const WEB_DIR = (() => {
  const candidates = [
    path.join(__dirname, "web"),
    path.join(__dirname, "..", "src", "web"),
    path.join(installDir(), "src", "web"),
    path.join(installDir(), "web"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? candidates[0];
})();

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
      // The UI is edited live while the server runs; never let the browser keep
      // a stale app.js/styles.css (that silently hides fixes).
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(data);
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    switch (route) {
      case "GET /api/state": {
        const s = getSettings();
        const tools = buildTools();
        const allTools = createWindowsTools(async () => true, {
          dryRun: s.dryRun,
          enabledTools: null,
          customTools: s.customTools,
          webSearchUrl: s.webSearchUrl,
          agentMode: s.agentMode,
        }).names();
        return json(res, 200, {
          version: VERSION,
          running,
          cwd: getTerminalCwd(),
          tools: tools.names(),
          allTools,
          withheld: tools.withheld(),
          catalog: tools.describe({ verbose: s.agentMode === "guided" }),
          settings: publicSettings(),
          history: conversation.messages.filter((m) => m.role !== "system"),
          turns: (conversation.turns ?? []).map(turnView),
          todos: conversation.todos ?? [],
          context: contextSnapshot(),
          capabilities: capabilityReport(),
          memory: {
            file: dataInfo().historyFile,
            entries: conversation.messages.filter((m) => m.role !== "system").length,
            bytes: (() => {
              try {
                return fs.statSync(dataInfo().historyFile).size;
              } catch {
                return 0;
              }
            })(),
          },
          conversation: {
            id: conversation.id,
            startedAt: conversation.startedAt,
            updatedAt: conversation.updatedAt,
          },
          usage: usageSnapshot(),
          data: dataInfo(),
          mcp: mcpSnapshot(),
          windows: await powerShellInfo(),
          notices: bootNotices,
        });
      }

      case "GET /api/usage":
        return json(res, 200, usageSnapshot());

      case "GET /api/data": {
        const info = dataInfo();
        return json(res, 200, {
          ...info,
          conversation: {
            id: conversation.id,
            startedAt: conversation.startedAt,
            messages: conversation.messages.length,
          },
          usage: usageSnapshot(),
          list: listConversations(),
        });
      }

      case "GET /api/conversations":
        return json(res, 200, { conversations: listConversations(), current: conversation.id });

      case "POST /api/conversations": {
        if (running) return json(res, 409, { error: BUSY });
        const body = await readJsonBody(req);
        const action = typeof body.action === "string" ? body.action : "";
        if (action === "new") {
          const record = startNewConversation();
          return json(res, 200, { ok: true, id: record.id, data: dataInfo() });
        }
        const id = typeof body.id === "string" ? body.id : "";
        const found = readConversation(id);
        if (!found) return json(res, 404, { error: `no archived conversation "${id}"` });
        if (action === "load") {
          // Keep the open one if it has content, restore the archived one.
          archiveConversation(conversation);
          conversation = found;
          unarchiveConversation(found.id);
          seedTodos(found.todos ?? []);
          persistHistory();
          // Every tab re-draws from /api/state, so the log matches this record.
          broadcast({ type: "reload_history" });
          broadcast({ type: "usage", usage: null, totals: usageSnapshot() });
          return json(res, 200, { ok: true, conversation: found });
        }
        return json(res, 200, { conversation: found });
      }

      case "GET /api/models": {
        const wanted = url.searchParams.get("profile") ?? getSettings().activeProfile;
        const s = getSettings();
        const profile = s.profiles.find((p) => p.id === wanted) ?? activeProfile();
        // "Sync local models": also ask the other local endpoints (LM Studio,
        // Ollama) so one picker shows everything that can be loaded.
        const sync = s.syncLocalModels && url.searchParams.get("sync") !== "0";
        try {
          const models = await fetchModels(profile);
          rememberModels(profile.id, models);
          let endpoints = null;
          let merged = null;
          if (sync) {
            const discovery = await discoverLocalModels(localEndpointsFor(s.profiles));
            for (const report of discovery.endpoints) {
              if (report.ok && report.id !== profile.id) rememberModels(report.id, report.models);
            }
            if (Object.keys(discovery.context).length > 0) rememberContextLimits(discovery.context);
            endpoints = discovery.endpoints;
            merged = discovery.models;
          }
          await discoverContext(profile);
          saveSettings();
          broadcast({ type: "settings", settings: publicSettings(), changed: ["profiles", "modelContext"] });
          return json(res, 200, {
            profile: profile.id,
            baseUrl: profile.baseUrl,
            models,
            sync,
            endpoints,
            merged,
            context: getSettings().modelContext,
          });
        } catch (error) {
          // Fall back to the remembered list so the UI still has something.
          return json(res, 200, {
            profile: profile.id,
            baseUrl: profile.baseUrl,
            models: profile.models,
            sync,
            endpoints: null,
            merged: null,
            context: getSettings().modelContext,
            error: (error as Error).message,
          });
        }
      }

      case "GET /api/mcp":
        return json(res, 200, mcpSnapshot());

      case "POST /api/mcp": {
        const body = await readJsonBody(req);
        const action = typeof body.action === "string" ? body.action : "";
        const s = getSettings();
        const build = (raw: unknown, id: string): McpServer => {
          const item = (raw ?? {}) as Record<string, unknown>;
          return {
            id,
            name: String(item.name ?? id),
            transport: item.transport === "http" ? "http" : "stdio",
            command: String(item.command ?? ""),
            args: Array.isArray(item.args)
              ? item.args.map((a) => String(a))
              : String(item.args ?? "").trim()
                ? String(item.args).split(/\s+/)
                : [],
            env: (item.env ?? {}) as Record<string, string>,
            url: String(item.url ?? ""),
            enabled: item.enabled !== false,
            autoApprove: item.autoApprove === true,
            tools: [],
          };
        };

        if (action === "refresh") {
          const result = await refreshMcp(true);
          return json(res, 200, { ok: true, ...result, mcp: mcpSnapshot() });
        }

        if (action === "add" || action === "update") {
          const id = String(body.id ?? "").trim();
          if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
            return json(res, 400, { error: "server id must be letters, digits, - or _ (max 32)" });
          }
          const existing = s.mcpServers.find((x) => x.id === id);
          const next = build(body.server ?? existing ?? {}, id);
          const list = existing
            ? s.mcpServers.map((x) => (x.id === id ? { ...next, tools: x.tools } : x))
            : [...s.mcpServers, next];
          try {
            updateSettings({ mcpServers: list });
          } catch (error) {
            return json(res, 400, { error: (error as Error).message });
          }
          saveSettings();
          mcp.drop(id);
          const result = await refreshMcp(false);
          return json(res, 200, { ok: true, ...result, mcp: mcpSnapshot() });
        }

        if (action === "remove") {
          const id = String(body.id ?? "");
          updateSettings({ mcpServers: s.mcpServers.filter((x) => x.id !== id) });
          saveSettings();
          mcp.drop(id);
          await refreshMcp(false);
          return json(res, 200, { ok: true, mcp: mcpSnapshot() });
        }

        if (action === "toggle") {
          const id = String(body.id ?? "");
          const list = s.mcpServers.map((x) => (x.id === id ? { ...x, enabled: body.enabled !== false } : x));
          if (!list.some((x) => x.id === id)) return json(res, 404, { error: `no MCP server "${id}"` });
          updateSettings({ mcpServers: list });
          saveSettings();
          mcp.drop(id);
          await refreshMcp(false);
          return json(res, 200, { ok: true, mcp: mcpSnapshot() });
        }

        return json(res, 400, { error: `unknown action "${action}"` });
      }

      case "GET /api/fs/list": {
        // Folder browser for the chat working-directory picker. Local-only server.
        const target = (url.searchParams.get("path") ?? "").trim();
        if (!target) {
          const drives: Array<{ name: string; path: string }> = [];
          for (let code = 65; code <= 90; code++) {
            const letter = `${String.fromCharCode(code)}:\\`;
            try {
              if (fs.existsSync(letter)) drives.push({ name: letter, path: letter });
            } catch {
              // no such drive
            }
          }
          return json(res, 200, { path: "", parent: null, dirs: drives, drives: true });
        }
        const abs = path.resolve(target);
        try {
          const entries = fs.readdirSync(abs, { withFileTypes: true });
          const dirs = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({ name: entry.name, path: path.join(abs, entry.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const up = path.dirname(abs);
          return json(res, 200, { path: abs, parent: up === abs ? null : up, dirs, drives: false });
        } catch (error) {
          return json(res, 400, { error: `cannot read ${abs} (${(error as Error).message})` });
        }
      }

      case "POST /api/diagnose": {
        if (running) return json(res, 409, { error: BUSY });
        const report = await diagnose(toConfig());
        if (Object.keys(report.context).length > 0) {
          rememberContextLimits(report.context);
          saveSettings();
          broadcast({ type: "settings", settings: publicSettings(), changed: ["modelContext"] });
        }
        announceCapabilities();
        broadcast({ type: "context", ...contextSnapshot() });
        return json(res, 200, { ...report, text: formatDiagnosis(report) });
      }

      case "POST /api/profiles": {
        const body = await readJsonBody(req);
        const action = typeof body.action === "string" ? body.action : "";
        const id = typeof body.id === "string" ? body.id.trim() : "";
        const s = getSettings();
        const profiles: Profile[] = s.profiles.map((p) => ({ ...p, models: [...p.models] }));
        const target = profiles.find((p) => p.id === id);

        if (action === "use") {
          try {
            updateSettings({ activeProfile: id });
          } catch (error) {
            return json(res, 400, { error: (error as Error).message });
          }
        } else if (action === "save" || action === "create") {
          if (action === "create" && target) {
            return json(res, 400, { error: `profile "${id}" already exists` });
          }
          const next: Profile = {
            id,
            name: String(body.name ?? target?.name ?? id),
            kind: body.kind === "api" ? "api" : body.kind === "local" ? "local" : target?.kind ?? "local",
            baseUrl: String(body.baseUrl ?? target?.baseUrl ?? "").replace(/\/+$/, ""),
            apiKey: String(body.apiKey ?? target?.apiKey ?? ""),
            model: String(body.model ?? target?.model ?? ""),
            models: target?.models ?? [],
          };
          if (!/^[a-zA-Z0-9_-]+$/.test(next.id)) {
            return json(res, 400, { error: `profile id "${next.id}" must be letters, digits, "-" or "_"` });
          }
          if (target) Object.assign(target, next);
          else profiles.push(next);
          try {
            updateSettings({ profiles });
          } catch (error) {
            return json(res, 400, { error: (error as Error).message });
          }
        } else if (action === "remove") {
          if (profiles.length <= 1) {
            return json(res, 400, { error: "the last profile cannot be removed" });
          }
          updateSettings({ profiles: profiles.filter((p) => p.id !== id) });
          if (getSettings().activeProfile === id) {
            updateSettings({ activeProfile: getSettings().profiles[0].id });
          }
        } else {
          return json(res, 400, { error: `unknown action "${action}"` });
        }

        saveSettings();
        applySettings();
        broadcast({ type: "settings", settings: publicSettings(), changed: ["profiles"] });
        return json(res, 200, { settings: publicSettings() });
      }

      case "GET /api/settings":
        return json(res, 200, { settings: publicSettings(), file: settingsFile() });

      case "POST /api/settings": {
        const body = await readJsonBody(req);
        const before = getSettings().workdir;
        let result;
        try {
          result = updateSettings(body);
        } catch (error) {
          return json(res, 400, { error: (error as Error).message });
        }
        saveSettings();
        const notices = applySettings();
        if (getSettings().workdir !== before) setTerminalCwd(getSettings().workdir);
        // Changing the MCP switch or the server list takes effect at once.
        if (result.changed.includes("mcpEnabled") || result.changed.includes("mcpServers")) {
          const outcome = await refreshMcp(true);
          notices.push(
            outcome.errors.length > 0
              ? `warning: MCP ${outcome.errors.join("; ")}`
              : `MCP: ${outcome.tools} tool(s) available`,
          );
        }
        broadcast({ type: "settings", settings: publicSettings(), changed: result.changed });
        broadcast({ type: "context", ...contextSnapshot() });
        return json(res, 200, {
          settings: publicSettings(),
          changed: result.changed,
          notices,
          mcp: mcpSnapshot(),
          file: settingsFile(),
        });
      }

      case "POST /api/settings/reload": {
        loadSettings();
        const notices = applySettings();
        await refreshMcp(false);
        broadcast({ type: "settings", settings: publicSettings(), changed: ["*"] });
        return json(res, 200, { settings: publicSettings(), notices, mcp: mcpSnapshot() });
      }

      case "GET /api/events": {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
        req.on("close", () => {
          clearInterval(keepAlive);
          clients.delete(res);
        });
        return;
      }

      case "GET /api/audit": {
        const wanted = Number(url.searchParams.get("n") ?? 20);
        const limit = Number.isFinite(wanted) ? Math.min(Math.max(Math.trunc(wanted), 0), 500) : 20;
        return json(res, 200, {
          enabled: auditLog().isEnabled(),
          file: auditLog().file(),
          undoDir: auditLog().backupDir(),
          versionsDir: auditLog().versionDir(),
          retentionDays: auditLog().retentionDays(),
          problem: auditLog().error(),
          entries: auditLog().list(limit),
          pending: auditLog().pending(),
        });
      }

      case "GET /api/undo":
        return json(res, 200, { pending: auditLog().pending(), enabled: auditLog().isEnabled() });

      case "GET /api/turns":
        return json(res, 200, { turns: (conversation.turns ?? []).map(turnView) });

      case "POST /api/versions/restore": {
        // "Put this file back to the version that change produced" - the other half
        // of the per-file menu in the chat. It is recorded and undoable itself.
        const body = await readJsonBody(req);
        const seq = Number(body.seq);
        if (!Number.isInteger(seq) || seq < 1) {
          return json(res, 400, { error: "seq must be a positive integer" });
        }
        if (running) return json(res, 409, { error: BUSY });
        const result = await auditLog().restoreVersion(seq);
        if (result.ok) broadcast({ type: "audit", undone: 0, ok: true, restored: result.path });
        return json(res, result.ok ? 200 : 400, result);
      }

      case "POST /api/undo": {
        const body = await readJsonBody(req);
        // Two ways in: the newest change ({ count }), or one picked from the list
        // ({ seq }) - which is what the rollback button next to a row sends.
        const hasSeq = body.seq !== undefined;
        const seq = Number(body.seq);
        const wanted = Number(body.count ?? 1);
        if (hasSeq && (!Number.isInteger(seq) || seq < 1)) {
          return json(res, 400, { error: "seq must be a positive integer" });
        }
        if (!hasSeq && (!Number.isInteger(wanted) || wanted < 1 || wanted > 50)) {
          return json(res, 400, { error: "count must be an integer between 1 and 50" });
        }
        if (running) return json(res, 409, { error: BUSY });
        const result = hasSeq ? await auditLog().undoEntry(seq) : await auditLog().undo(wanted);
        broadcast({ type: "audit", undone: result.undone.length, ok: result.ok });
        return json(res, 200, {
          ...result,
          entries: auditLog().list(10),
          pending: auditLog().pending(),
        });
      }

      case "GET /api/capabilities": {
        // What this agent can actually do right now: the tools the model is offered,
        // the ones deliberately withheld (with the reason), the procedures it can
        // load, and the MCP servers behind it. Nothing here starts a turn.
        const s = getSettings();
        const tools = buildTools();
        return json(res, 200, {
          version: VERSION,
          agentMode: s.agentMode,
          dryRun: s.dryRun,
          contextLimit: effectiveContextLimit().limit,
          tools: tools.schemas().map((schema) => ({
            name: schema.function.name,
            description: schema.function.description,
          })),
          withheld: tools.withheld(),
          skills: listSkills().map((skill) => ({
            name: skill.name,
            description: skill.description,
            when: skill.when,
          })),
          mcp: mcp.status().map((server) => ({
            id: server.id,
            name: server.name,
            connected: server.connected,
            tools: server.tools.length,
            error: server.error,
          })),
        });
      }

      case "GET /api/skills": {
        ensureSkillsFolder();
        // ?name=… returns the body too, which is what the editor needs.
        const wanted = url.searchParams.get("name");
        if (wanted) {
          const skill = findSkill(wanted);
          if (!skill) return json(res, 404, { error: `no skill "${wanted}"` });
          const loaded = loadSkill(skill.name);
          return json(res, 200, {
            dir: skillsDir(),
            skill,
            body: typeof loaded === "string" ? "" : loaded.body,
          });
        }
        return json(res, 200, { dir: skillsDir(), skills: listSkills() });
      }

      case "POST /api/skills": {
        const body = await readJsonBody(req);
        try {
          const skill = saveSkill({
            name: typeof body.name === "string" ? body.name : "",
            description: typeof body.description === "string" ? body.description : "",
            when: typeof body.when === "string" ? body.when : "",
            body: typeof body.body === "string" ? body.body : "",
          });
          return json(res, 200, { ok: true, skill, skills: listSkills() });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message });
        }
      }

      case "POST /api/skills/delete": {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name : "";
        if (!deleteSkill(name)) return json(res, 404, { error: `no skill "${name}"` });
        return json(res, 200, { ok: true, skills: listSkills() });
      }

      case "GET /api/queue":
        return json(res, 200, { items: queue, running, limit: MAX_QUEUE });

      case "POST /api/queue": {
        const body = await readJsonBody(req);
        const action = typeof body.action === "string" ? body.action : "";
        if (action === "clear") {
          queue.length = 0;
          saveQueue();
          broadcast({ type: "queue", items: queue });
          return json(res, 200, { ok: true, items: queue });
        }
        if (action === "remove") {
          const id = typeof body.id === "string" ? body.id : "";
          const index = queue.findIndex((item) => item.id === id);
          if (index < 0) return json(res, 404, { error: `no queued message with id ${id}` });
          queue.splice(index, 1);
          saveQueue();
          broadcast({ type: "queue", items: queue });
          return json(res, 200, { ok: true, items: queue });
        }
        return json(res, 400, { error: 'action must be "remove" or "clear"' });
      }

      case "POST /api/chat": {
        const body = await readJsonBody(req);
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) return json(res, 400, { error: "message is required" });
        // While a turn is running, a new message is queued instead of refused: the
        // user can line up the next jobs and leave. It starts when the turn ends.
        if (running) {
          const item = enqueue(message);
          if (!item) return json(res, 429, { error: `the queue is full (${MAX_QUEUE} waiting)` });
          return json(res, 202, { ok: true, queued: true, position: queue.length, id: item.id });
        }
        void runAgent(message);
        return json(res, 202, { ok: true });
      }

      case "POST /api/abort": {
        return json(res, 200, { ok: stopAgent() });
      }

      case "POST /api/terminal": {
        const body = await readJsonBody(req);
        const input = typeof body.input === "string" ? body.input : "";
        if (!input.trim()) return json(res, 400, { error: "input is required" });
        const clientId = String(req.headers["x-client-id"] ?? "");
        const result = await runTerminalLine(input, clientId);
        return json(res, 200, { ...result, cwd: getTerminalCwd() });
      }

      case "POST /api/approve": {
        const body = await readJsonBody(req);
        const id = typeof body.id === "string" ? body.id : "";
        const approved = body.approved === true;
        const resolve = pendingApprovals.get(id);
        if (resolve) resolve(approved);
        broadcast({ type: "approval_result", id, approved });
        return json(res, 200, { ok: Boolean(resolve) });
      }

      case "POST /api/reset": {
        if (running) return json(res, 409, { error: BUSY });
        const record = startNewConversation();
        broadcast({ type: "reset" });
        return json(res, 200, { ok: true, id: record.id, data: dataInfo() });
      }

      case "POST /api/port": {
        const body = await readJsonBody(req);
        const port = Number(body.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return json(res, 400, { error: "invalid port" });
        }
        const message = await host.restart(port);
        return json(res, 200, { ok: true, url: `http://127.0.0.1:${port}`, message });
      }

      default: {
        if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
          return serveStatic(res, url.pathname);
        }
        return json(res, 404, { error: "not found" });
      }
    }
  } catch (error) {
    return json(res, 500, { error: (error as Error).message });
  }
});

/** Move the listening socket to a new port, rolling back if it fails. */
function rebind(port: number): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      const onError = (error: Error): void => {
        server.removeListener("listening", onListening);
        server.listen(boundPort, "127.0.0.1");
        broadcast({ type: "notice", text: `port ${port} unavailable: ${error.message}` });
        resolve();
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        boundPort = port;
        broadcast({ type: "notice", text: `now listening on http://127.0.0.1:${port}` });
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  });
}

server.listen(boundPort, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${boundPort}`;
  console.log(`win-agent ${VERSION} web UI running`);
  console.log(`  url        : ${url}`);
  console.log(`  model      : ${getSettings().model}`);
  console.log(`  endpoint   : ${getSettings().baseUrl}`);
  console.log(
    `  context    : ${(() => {
      const { limit, source } = effectiveContextLimit();
      return limit > 0 ? `${limit} tokens (${source})` : "unknown (set contextLimit)";
    })()}`,
  );
  console.log(`  settings   : ${settingsFile()}`);
  // Copies older than the retention window go now, not at the next write: the log
  // is what makes an old change undoable, so the window has to be honoured even on
  // a server that is only read from.
  void auditLog().sweep();
  // Make `data/skills/` visible on first run, with a README that explains the format.
  try {
    ensureSkillsFolder();
    const count = listSkills().length;
    if (count > 0) console.log(`  skills     : ${count} installed (${skillsDir()})`);
  } catch {
    /* a read-only data folder is not a reason to fail */
  }
  if (getSettings().mcpEnabled) console.log("  mcp        : connecting to the configured servers…");
  // Messages that were waiting when the server stopped are waiting again, and the
  // first one starts now: a restart does not lose the jobs that were lined up.
  try {
    loadQueue();
    if (queue.length > 0) {
      console.log(`  queue      : ${queue.length} waiting (${queueFile()})`);
      drainQueue();
    }
  } catch {
    /* a read-only data folder is not a reason to fail */
  }
  for (const notice of bootNotices) console.log(`  ${notice}`);

  // Which PowerShell is being driven, and whether it is elevated, is the first
  // thing to check when a tool fails - so say it at boot (and in the web UI).
  void powerShellInfo().then((info) => {
    const version = info.version ? ` ${info.version}` : "";
    const where = info.exe === getSettings().powershell ? "" : ` (resolved from ${getSettings().powershell})`;
    console.log(`  powershell : ${info.exe}${version}${where}`);
    if (info.note) console.log(`  warning    : ${info.note}`);
    if (!info.found) console.log("  warning: no PowerShell binary found - set the \"PowerShell binary\" setting");
    else if (info.elevated === false) console.log("  elevated   : no - service/firewall/machine-wide changes will be refused");
    else if (info.elevated === true) console.log("  elevated   : yes (administrator)");
  });

  if (getSettings().autoOpenBrowser && !process.argv.includes("--no-open")) {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
});

// Leave no MCP child processes behind when the server goes away.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    mcp.close();
    process.exit(0);
  });
}
