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
  toConfig,
  updateSettings,
} from "./settings.js";
import { configurePowerShell } from "./util/ps.js";
import { createWindowsTools, type Approval } from "./tools/index.js";
import { VERSION } from "./version.js";
import { capabilityReport, capabilities as endpointCapabilities, probeContextLimits } from "./providers.js";
import { diagnose, formatDiagnosis } from "./diagnose.js";
import { planContext, schemaTokens, toolCapFor, type ContextStats } from "./context.js";
import { runCommand, type CommandHost } from "./commands.js";
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
  type ConversationRecord,
  type CumulativeUsage,
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
/** Cancels the LLM request(s) of the turn that is running (the Stop button). */
let taskAbort: AbortController | null = null;

/** The live message list handed to the agent. */
function history(): ChatMessage[] {
  return conversation.messages;
}

function persistHistory(record: ConversationRecord = conversation): void {
  if (getSettings().remember) saveConversation(record);
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
  if (!base) throw new Error("no base URL configured for this profile");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`the endpoint answered HTTP ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const list = (data.data ?? [])
      .map((entry) => String(entry?.id ?? ""))
      .filter((id) => id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    if (list.length === 0) throw new Error("the endpoint listed no models");
    return list;
  } catch (error) {
    const err = error as Error & { cause?: { code?: string } };
    if (err.name === "AbortError") throw new Error("the endpoint did not answer in time");
    const reason = err.cause?.code ?? err.message;
    throw new Error(`cannot reach ${base} (${reason})`);
  } finally {
    clearTimeout(timer);
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
  });
}

/* -------------------------------------------------------------------------- */
/* Agent run                                                                  */
/* -------------------------------------------------------------------------- */

async function runAgent(message: string): Promise<void> {
  if (running) {
    broadcast({ type: "error", message: "The agent is already working on a task." });
    return;
  }
  running = true;
  const controller = new AbortController();
  taskAbort = controller;
  broadcast({ type: "user", text: message });
  broadcast({ type: "status", running: true });

  const tools = buildTools();
  // This turn belongs to the conversation that is open right now; keep a direct
  // reference so nothing can be written into a different record mid-turn.
  const convo = conversation;
  // Reasoning models can think for a long while before any visible text; count
  // the "thinking" characters and tell the UI now and then.
  let reasoningChars = 0;
  let lastThinkingAt = 0;
  const agent = new Agent(
    toConfig(),
    tools,
    {
      onStep: (step, max) => broadcast({ type: "step", step, max }),
      onAssistantDelta: (text) => broadcast({ type: "delta", text }),
      onReasoning: (text) => {
        reasoningChars += text.length;
        const now = Date.now();
        if (now - lastThinkingAt >= 400) {
          lastThinkingAt = now;
          broadcast({ type: "thinking", chars: reasoningChars });
        }
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
    },
    history(),
  );

  try {
    await agent.run(message, controller.signal);
    // The assistant's text was already streamed as "assistant" events by the
    // agent, so "done" only signals that the turn is over (avoids duplicates).
    broadcast({ type: "done", totals: usageSnapshot(convo) });
  } catch (error) {
    const err = error as Error;
    const stopped = controller.signal.aborted || err.name === "AbortError";
    if (stopped) broadcast({ type: "stopped" });
    else broadcast({ type: "error", message: err.message });
  } finally {
    // Keep whatever the model managed to do, even when it failed or was stopped.
    convo.messages = agent.getHistory();
    persistHistory(convo);
    announceCapabilities();
    broadcast({ type: "context", ...contextSnapshot() });
    running = false;
    taskAbort = null;
    broadcast({ type: "status", running: false });
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

const WEB_DIR = (() => {
  const candidates = [
    path.join(__dirname, "web"),
    path.join(__dirname, "..", "src", "web"),
    path.join(process.cwd(), "src", "web"),
    path.join(process.cwd(), "web"),
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
        }).names();
        return json(res, 200, {
          version: VERSION,
          running,
          cwd: getTerminalCwd(),
          tools: tools.names(),
          allTools,
          catalog: tools.describe(),
          settings: publicSettings(),
          history: conversation.messages.filter((m) => m.role !== "system"),
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
        try {
          const models = await fetchModels(profile);
          rememberModels(profile.id, models);
          await discoverContext(profile);
          saveSettings();
          broadcast({ type: "settings", settings: publicSettings(), changed: ["profiles", "modelContext"] });
          return json(res, 200, {
            profile: profile.id,
            baseUrl: profile.baseUrl,
            models,
            context: getSettings().modelContext,
          });
        } catch (error) {
          // Fall back to the remembered list so the UI still has something.
          return json(res, 200, {
            profile: profile.id,
            baseUrl: profile.baseUrl,
            models: profile.models,
            context: getSettings().modelContext,
            error: (error as Error).message,
          });
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
        broadcast({ type: "settings", settings: publicSettings(), changed: result.changed });
        broadcast({ type: "context", ...contextSnapshot() });
        return json(res, 200, {
          settings: publicSettings(),
          changed: result.changed,
          notices,
          file: settingsFile(),
        });
      }

      case "POST /api/settings/reload": {
        loadSettings();
        const notices = applySettings();
        broadcast({ type: "settings", settings: publicSettings(), changed: ["*"] });
        return json(res, 200, { settings: publicSettings(), notices });
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

      case "POST /api/chat": {
        const body = await readJsonBody(req);
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) return json(res, 400, { error: "message is required" });
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
  for (const notice of bootNotices) console.log(`  ${notice}`);

  if (getSettings().autoOpenBrowser && !process.argv.includes("--no-open")) {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
});
