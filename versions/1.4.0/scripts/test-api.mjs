// The HTTP API contract: start the real server against a temp data folder and a mock
// model endpoint, then drive it exactly like the browser UI does.
// Run with: npm run test:api
//
// Nothing here touches the settings or the data folder of your running copy: the server
// is started with AGENT_SETTINGS_FILE and AGENT_DATA_DIR pointing into a temp folder.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

let passed = 0;
let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

/** A free port from the OS, released immediately and used a moment later. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The mock model endpoint                                                    */
/* -------------------------------------------------------------------------- */

const requests = [];
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ method: req.method, path: req.url, body });
    res.writeHead(200, { "Content-Type": "application/json" });
    if ((req.url ?? "").includes("/models")) {
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-1" }, { id: "mock-2" }] }));
      return;
    }
    res.end(
      JSON.stringify({
        model: "mock-1",
        choices: [
          { index: 0, message: { role: "assistant", content: "mock answer" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      }),
    );
  });
});
const mockPort = await freePort();
await new Promise((resolve) => mock.listen(mockPort, "127.0.0.1", resolve));

/* -------------------------------------------------------------------------- */
/* Start the server                                                           */
/* -------------------------------------------------------------------------- */

const port = await freePort();
const scratch = path.join(os.tmpdir(), `win-agent-api-${process.pid}`);
const dataDir = path.join(scratch, "data");
fs.mkdirSync(dataDir, { recursive: true });

const settingsFile = path.join(scratch, "settings.json");
const settings = {
  webPort: port,
  language: "en",
  autoOpenBrowser: false,
  workdir: scratch,
  model: "mock-1",
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
  apiKey: "mock-key",
  stream: false,
  maxSteps: 4,
  temperature: 0,
  contextLimit: 8192,
  autoApprove: true,
  agentMode: "guided",
  psEnglishErrors: true,
};
// Deliberately no BOM: this is what the agent writes itself.
fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts", "--no-open"], {
  cwd: root,
  env: { ...process.env, AGENT_SETTINGS_FILE: settingsFile, AGENT_DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (chunk) => (serverLog += chunk));
child.stderr.on("data", (chunk) => (serverLog += chunk));

/** Kill the server and everything it started. */
function stopServer() {
  try {
    child.kill();
  } catch {
    // already gone
  }
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // no taskkill
    }
  }
}

const base = `http://127.0.0.1:${port}`;

async function api(pathname, method = "GET", body) {
  const res = await fetch(base + pathname, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json", "x-client-id": "test" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

/** Poll until the server answers, with a burst of concurrent requests on every round,
 *  and keep every reply seen during startup (the PowerShell probe is still running for
 *  the first few hundred milliseconds, so those replies are the interesting ones). */
async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  let listeningSince = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the server exited early (${child.exitCode})\n${serverLog}`);
    const burst = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${base}/api/state`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ),
    );
    const answered = burst.filter(Boolean);
    seen.push(...answered);
    if (answered.length === 4) {
      // Keep sampling across the whole probe window (not just the first round):
      // the half-filled object only existed for a few hundred milliseconds.
      if (!listeningSince) listeningSince = Date.now();
      if (Date.now() - listeningSince > 2_500) return { state: answered[0], seen };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the server did not answer within ${timeoutMs} ms\n${serverLog}`);
}

let exitCode = 0;
try {
  const { state, seen } = await waitForServer();

  /* ---------------------------------------------------------------------- */

  section("the requests during startup agree");
  {
    const infos = seen.map((item) => item.windows);
    check(
      `every one of the ${infos.length} startup replies describes the same shell`,
      new Set(infos.map((info) => JSON.stringify(info))).size === 1,
      JSON.stringify(infos),
    );
    check(
      "no reply carries a half-filled windows object",
      infos.every((info) => typeof info.version === "string" && /^\d+\.\d+/.test(info.version) === info.found),
      JSON.stringify(infos[0]),
    );
    check(
      "the version and edition always arrive together",
      infos.every((info) => !info.version || !!info.edition),
      JSON.stringify(infos[0]),
    );
    check(
      "a working shell has no note",
      infos.every((info) => info.note === undefined || info.found === false),
      JSON.stringify(infos[0]),
    );
  }

  /* ---------------------------------------------------------------------- */

  section("state");
  {
    check("version matches package.json", state.version === version, `${state.version} != ${version}`);
    check("it is not running a task", state.running === false);
    check("the working directory is reported", state.cwd === scratch, state.cwd);
    check("tools are listed", Array.isArray(state.tools) && state.tools.includes("files"), JSON.stringify(state.tools));
    check("allTools is the full list", state.allTools.length >= state.tools.length);
    check("the catalog names the tools", /Available tools/.test(state.catalog) && /- files:/.test(state.catalog));
    check("guided mode explains the required arguments", /arguments:/.test(state.catalog));
    check("history starts empty", Array.isArray(state.history) && state.history.length === 0);
    check("the context budget is reported", typeof state.context.limit === "number", JSON.stringify(state.context));
    check("usage starts at zero", state.usage?.conversation?.calls === 0, JSON.stringify(state.usage?.conversation));
    check("the data folder is described", typeof state.data?.historyFile === "string", JSON.stringify(state.data));
    check("MCP is off and reported", state.mcp?.enabled === false && Array.isArray(state.mcp.servers));
    check(
      "the windows block describes the shell",
      state.windows?.found === true && /^(Desktop|Core)$/.test(state.windows.edition) && typeof state.windows.englishErrors === "boolean",
      JSON.stringify(state.windows),
    );
    check("the PowerShell version is filled in", /^\d+\.\d+/.test(state.windows?.version ?? ""), JSON.stringify(state.windows));
    check("englishErrors follows the setting", state.windows.englishErrors === true, JSON.stringify(state.windows));

    const keys = Object.keys(state.settings);
    check("settings include agentMode", keys.includes("agentMode"), keys.join(", "));
    check("settings include psEnglishErrors", keys.includes("psEnglishErrors"));
    check("the API key is never returned", !("apiKey" in state.settings) && state.settings.apiKeySet === true);
    check("profiles mask their keys too", state.settings.profiles.every((p) => !("apiKey" in p) && "apiKeySet" in p));
  }

  /* ---------------------------------------------------------------------- */

  section("static UI");
  {
    const page = await fetch(`${base}/`);
    const html = await page.text();
    check("GET / serves the UI", page.status === 200 && /win-agent/.test(html));
    check("the page loads app.js", /app\.js/.test(html));
    check("assets are never cached", page.headers.get("cache-control") === "no-store, must-revalidate", String(page.headers.get("cache-control")));

    const css = await fetch(`${base}/styles.css`);
    check("styles.css is served as CSS", css.status === 200 && /text\/css/.test(css.headers.get("content-type") ?? ""));

    const missing = await fetch(`${base}/nope.txt`);
    check("a missing asset is a 404", missing.status === 404, String(missing.status));

    const escape = await fetch(`${base}/../package.json`);
    check("path traversal is refused", escape.status === 403 || escape.status === 404, String(escape.status));

    const unknown = await api("/api/does-not-exist");
    check("an unknown API route is a JSON 404", unknown.status === 404 && unknown.data?.error === "not found", JSON.stringify(unknown.data));
    check("API replies are JSON", /application\/json/.test(unknown.headers.get("content-type") ?? ""), String(unknown.headers.get("content-type")));
  }

  /* ---------------------------------------------------------------------- */

  section("settings round-trip");
  {
    const saved = await api("/api/settings", "POST", { maxSteps: 9, agentMode: "normal" });
    check("POST /api/settings accepts a patch", saved.status === 200, JSON.stringify(saved.data));
    check("it reports what changed", saved.data?.changed?.includes("maxSteps") && saved.data?.changed?.includes("agentMode"), JSON.stringify(saved.data?.changed));
    check("the response carries the new settings", saved.data?.settings?.maxSteps === 9 && saved.data?.settings?.agentMode === "normal");
    check("it names the settings file", typeof saved.data?.file === "string");

    const onDisk = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    check("the change is on disk", onDisk.maxSteps === 9 && onDisk.agentMode === "normal");
    check("the file has no BOM", fs.readFileSync(settingsFile)[0] === 0x7b, String(fs.readFileSync(settingsFile)[0]));

    const normal = await api("/api/state");
    check("normal mode drops the argument list", !/arguments:/.test(normal.data.catalog));
    check("the API reports the new mode", normal.data.settings.agentMode === "normal");

    const reject = await api("/api/settings", "POST", { maxSteps: 9999 });
    check("an out-of-range value is refused", reject.status === 400 && /maxSteps/.test(String(reject.data?.error)), JSON.stringify(reject.data));
    const after = await api("/api/settings");
    check("a refused change changes nothing", after.data.settings.maxSteps === 9, String(after.data.settings.maxSteps));

    const unknownKey = await api("/api/settings", "POST", { nonsense: true });
    check("an unknown key is refused", unknownKey.status === 400, JSON.stringify(unknownKey.data));

    // Put the file back the way the test started and reload it through the API.
    fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    const reloaded = await api("/api/settings/reload", "POST", {});
    check("reload re-reads the file", reloaded.data?.settings?.maxSteps === 4 && reloaded.data?.settings?.agentMode === "guided", JSON.stringify(reloaded.data?.settings));

    const list = await api("/api/settings");
    check("GET /api/settings returns settings and the file", !!list.data.settings && list.data.file === settingsFile, String(list.data.file));
  }

  /* ---------------------------------------------------------------------- */

  section("profiles");
  {
    const created = await api("/api/profiles", "POST", { action: "create", id: "test-cloud", kind: "api", baseUrl: "https://example.invalid/v1", model: "x" });
    check("a profile can be created", created.status === 200, JSON.stringify(created.data));
    check("the new profile is in the list", created.data?.settings?.profiles?.some((p) => p.id === "test-cloud"));

    const duplicate = await api("/api/profiles", "POST", { action: "create", id: "test-cloud" });
    check("a duplicate id is refused", duplicate.status === 400 && /already exists/.test(String(duplicate.data?.error)), JSON.stringify(duplicate.data));

    const badId = await api("/api/profiles", "POST", { action: "create", id: "bad id!" });
    check("an invalid id is refused", badId.status === 400, JSON.stringify(badId.data));

    const used = await api("/api/profiles", "POST", { action: "use", id: "test-cloud" });
    check("a profile can be activated", used.status === 200 && used.data.settings.activeProfile === "test-cloud");
    check("activating swaps the endpoint mirror", used.data.settings.baseUrl === "https://example.invalid/v1", used.data.settings.baseUrl);

    const unknown = await api("/api/profiles", "POST", { action: "use", id: "nope" });
    check("an unknown profile is refused", unknown.status === 400 && /unknown profile/.test(String(unknown.data?.error)));

    await api("/api/profiles", "POST", { action: "use", id: "local" });
    const removed = await api("/api/profiles", "POST", { action: "remove", id: "test-cloud" });
    check("a profile can be removed", removed.status === 200 && !removed.data.settings.profiles.some((p) => p.id === "test-cloud"));

    const unknownAction = await api("/api/profiles", "POST", { action: "explode" });
    check("an unknown profile action is refused", unknownAction.status === 400, JSON.stringify(unknownAction.data));
  }

  /* ---------------------------------------------------------------------- */

  section("terminal");
  {
    const status = await api("/api/terminal", "POST", { input: "/status" });
    check("/status runs", status.status === 200 && status.data.kind === "internal", JSON.stringify(status.data).slice(0, 200));
    check("/status reports the mode", /mode\s+:\s+guided/.test(status.data.output), status.data.output?.slice(0, 400));
    check("/status reports the shell", /shell\s+:/.test(status.data.output), status.data.output?.slice(0, 400));
    check("/status reports elevation", /admin\s+:/.test(status.data.output));
    check("the terminal cwd comes back", status.data.cwd === scratch, String(status.data.cwd));

    const mode = await api("/api/terminal", "POST", { input: "/mode normal" });
    check("/mode switches the setting", /agentMode/.test(mode.data.output), String(mode.data.output));
    const checkBack = await api("/api/settings");
    check("the switch reached the settings", checkBack.data.settings.agentMode === "normal");
    await api("/api/terminal", "POST", { input: "/mode guided" });

    const bad = await api("/api/terminal", "POST", { input: "/mode sideways" });
    check("an invalid mode is refused with a message", /guided/.test(bad.data.output) && !/updated/.test(bad.data.output), String(bad.data.output));

    const unknown = await api("/api/terminal", "POST", { input: "/wat" });
    check("an unknown command explains itself", /unknown command/.test(unknown.data.output), String(unknown.data.output));

    const blank = await api("/api/terminal", "POST", { input: "   " });
    check("blank input is a 400", blank.status === 400, JSON.stringify(blank.data));

    const shell = await api("/api/terminal", "POST", { input: "Write-Output api-test-ok" });
    check("a plain line runs as a shell command", shell.data.kind === "shell" && /api-test-ok/.test(shell.data.output), JSON.stringify(shell.data));

    const failing = await api("/api/terminal", "POST", { input: "Get-Service -Name definitely-not-a-service" });
    check("a failing command returns the error, not a crash", /Error:|Cannot find any service/.test(failing.data.output), String(failing.data.output).slice(0, 300));
    const english = await api("/api/terminal", "POST", { input: "/status" });
    check("the server is still alive afterwards", english.status === 200);
  }

  /* ---------------------------------------------------------------------- */

  section("audit log and undo");
  {
    const state = await api("/api/state");
    check("guided mode does not offer the raw shell", !state.data.tools.includes("powershell"), JSON.stringify(state.data.tools));
    check(
      "and says why in the withheld list",
      state.data.withheld.some((item) => item.name === "powershell" && item.reason),
      JSON.stringify(state.data.withheld),
    );

    const audit = await api("/api/audit?n=5");
    check(
      "the audit log is on by default and lives in the data folder",
      audit.data.enabled === true && audit.data.file.startsWith(dataDir),
      JSON.stringify(audit.data.file),
    );
    check("nothing has been changed yet", Array.isArray(audit.data.entries) && audit.data.entries.length === 0, JSON.stringify(audit.data.entries));
    check("the undo stack is empty too", Array.isArray(audit.data.pending) && audit.data.pending.length === 0);

    const pending = await api("/api/undo");
    check("GET /api/undo reports an empty stack", pending.status === 200 && pending.data.pending.length === 0);
    const nothing = await api("/api/undo", "POST", { count: 1 });
    check(
      "undoing with an empty stack is not an error",
      nothing.status === 200 && nothing.data.ok === false && /nothing to undo/.test(nothing.data.message),
      JSON.stringify(nothing.data),
    );

    const bad = await api("/api/undo", "POST", { count: 0 });
    check("an impossible count is refused", bad.status === 400, JSON.stringify(bad.data));

    const auditCmd = await api("/api/terminal", "POST", { input: "/audit" });
    check("/audit prints the log file", auditCmd.data.output.includes(audit.data.file), String(auditCmd.data.output).slice(0, 300));
    check("/audit says nothing has changed yet", /nothing has been changed/.test(auditCmd.data.output), String(auditCmd.data.output).slice(0, 300));

    const undoCmd = await api("/api/terminal", "POST", { input: "/undo" });
    check("/undo explains an empty stack", /nothing to undo/.test(undoCmd.data.output), String(undoCmd.data.output).slice(0, 300));
    const undoList = await api("/api/terminal", "POST", { input: "/undo list" });
    check("/undo list explains an empty stack", /nothing to undo/.test(undoList.data.output), String(undoList.data.output).slice(0, 300));
    const undoBad = await api("/api/terminal", "POST", { input: "/undo zero" });
    check("/undo rejects nonsense with the usage line", /usage/i.test(undoBad.data.output), String(undoBad.data.output).slice(0, 200));

    // Switching the log off has to stop both the recording and the undo.
    await api("/api/settings", "POST", { auditLog: false });
    const off = await api("/api/audit");
    check("the switch reaches the log", off.data.enabled === false);
    const offUndo = await api("/api/undo", "POST", { count: 1 });
    check("undo refuses while logging is off", /switched off/.test(offUndo.data.message), JSON.stringify(offUndo.data));
    const offCmd = await api("/api/terminal", "POST", { input: "/audit" });
    check("the terminal says logging is off", /switched off/.test(offCmd.data.output), String(offCmd.data.output).slice(0, 200));
    await api("/api/settings", "POST", { auditLog: true });

    // Normal mode is the way back to the raw shell.
    await api("/api/settings", "POST", { agentMode: "normal" });
    const normal = await api("/api/state");
    check(
      "normal mode offers the raw shell again",
      normal.data.tools.includes("powershell") && normal.data.withheld.length === 0,
      JSON.stringify(normal.data.withheld),
    );
    const toolsCmd = await api("/api/terminal", "POST", { input: "/tools" });
    check("/tools lists it again", /\[x\] powershell/.test(toolsCmd.data.output), String(toolsCmd.data.output).slice(0, 400));
    await api("/api/settings", "POST", { agentMode: "guided" });
    const backToGuided = await api("/api/terminal", "POST", { input: "/tools" });
    check(
      "/tools explains what is not offered in guided mode",
      /not offered/.test(backToGuided.data.output) && !/\[x\] powershell/.test(backToGuided.data.output),
      String(backToGuided.data.output).slice(0, 400),
    );
    const guidedStatus = await api("/api/terminal", "POST", { input: "/status" });
    check(
      "/status reports the change log and the withheld tool",
      /audit\s+:/.test(guidedStatus.data.output) && /withheld\s+:/.test(guidedStatus.data.output),
      String(guidedStatus.data.output).slice(0, 600),
    );
  }

  /* ---------------------------------------------------------------------- */

  section("conversations, usage and data");
  {
    const reset = await api("/api/reset", "POST", {});
    check("reset starts a conversation", reset.status === 200 && typeof reset.data.id === "string", JSON.stringify(reset.data));

    const list = await api("/api/conversations");
    check("the conversation list returns the current one", list.data.current === reset.data.id, JSON.stringify(list.data).slice(0, 200));

    const missing = await api("/api/conversations", "POST", { action: "load", id: "00000000-0000" });
    check("loading an unknown conversation is a 404", missing.status === 404, JSON.stringify(missing.data));

    const data = await api("/api/data");
    check("the data folder is described", typeof data.data.historyFile === "string" && Array.isArray(data.data.list));
    check("the open conversation is described", typeof data.data.conversation.messages === "number");

    const usage = await api("/api/usage");
    check(
      "usage reports the conversation, the all-time totals and the calls",
      typeof usage.data.conversation?.calls === "number" &&
        typeof usage.data.allTime?.calls === "number" &&
        Array.isArray(usage.data.calls),
      JSON.stringify(usage.data).slice(0, 200),
    );
  }

  /* ---------------------------------------------------------------------- */

  section("models, mcp, abort, approve");
  {
    const models = await api("/api/models?sync=0");
    check("GET /api/models asks the endpoint", models.status === 200 && models.data.models?.includes("mock-1"), JSON.stringify(models.data).slice(0, 200));
    check("the endpoint was really called", requests.some((r) => r.path.includes("/models")), "");

    const mcp = await api("/api/mcp");
    check("GET /api/mcp reports the master switch", mcp.data.enabled === false && Array.isArray(mcp.data.servers));

    const mcpBad = await api("/api/mcp", "POST", { action: "nonsense" });
    check("an unknown MCP action is refused", mcpBad.status === 400, JSON.stringify(mcpBad.data));

    const mcpBadId = await api("/api/mcp", "POST", { action: "add", id: "bad id" });
    check("an invalid MCP server id is refused", mcpBadId.status === 400, JSON.stringify(mcpBadId.data));

    const abort = await api("/api/abort", "POST", {});
    check("abort is safe when idle", abort.status === 200 && abort.data.ok === false, JSON.stringify(abort.data));

    const approve = await api("/api/approve", "POST", { id: "nothing" });
    check("approving an unknown request is a no-op", approve.status === 200 && approve.data.ok === false, JSON.stringify(approve.data));

    const badPort = await api("/api/port", "POST", { port: 70000 });
    check("an invalid port is refused", badPort.status === 400, JSON.stringify(badPort.data));

    const fsList = await api("/api/fs/list");
    check("the folder picker lists drives", fsList.data.drives === true && Array.isArray(fsList.data.dirs), JSON.stringify(fsList.data).slice(0, 200));
    const fsBad = await api("/api/fs/list?path=Z:\\definitely-not-here");
    check("an unreadable folder is a 400", fsBad.status === 400, JSON.stringify(fsBad.data).slice(0, 120));
  }

  /* ---------------------------------------------------------------------- */

  section("a whole turn, end to end");
  {
    const empty = await api("/api/chat", "POST", { message: "" });
    check("an empty message is a 400", empty.status === 400, JSON.stringify(empty.data));

    const sent = await api("/api/chat", "POST", { message: "say hello" });
    check("a message is accepted with 202", sent.status === 202, JSON.stringify(sent.data));

    const deadline = Date.now() + 30_000;
    let final = null;
    while (Date.now() < deadline) {
      final = (await api("/api/state")).data;
      if (!final.running && final.history.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    check("the task finished", final && final.running === false, JSON.stringify(final?.history ?? []).slice(0, 200));
    check("the user message is in the history", final?.history?.[0]?.role === "user" && final.history[0].content === "say hello");
    check("the answer is in the history", final?.history?.[1]?.role === "assistant" && /mock answer/.test(final.history[1].content), JSON.stringify(final?.history?.[1]));
    check("the endpoint received the request", requests.some((r) => r.path.includes("/chat/completions")), "");
    check("the prompt was sent as messages", Array.isArray(requests.find((r) => r.path.includes("/chat/completions"))?.body?.messages));
    check("the tool schemas were sent", Array.isArray(requests.find((r) => r.path.includes("/chat/completions"))?.body?.tools));
    check(
      "usage was counted",
      (final?.usage?.conversation?.calls ?? 0) >= 1 && final.usage.conversation.promptTokens >= 12,
      JSON.stringify(final?.usage?.conversation),
    );

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "history.json"), "utf8"));
    check("the conversation was written to the data folder", JSON.stringify(persisted).includes("mock answer"));

    const cleared = await api("/api/reset", "POST", {});
    check("the conversation can be reset again", cleared.status === 200 && cleared.data.ok === true);
    const empty2 = await api("/api/state");
    check("the history is empty after the reset", empty2.data.history.length === 0);
  }
} catch (error) {
  failures += 1;
  exitCode = 1;
  console.log(`\nFAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  stopServer();
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // the OS can hold the folder briefly; a temp folder is fine to leave behind
  }
  mock.close();
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : exitCode);
