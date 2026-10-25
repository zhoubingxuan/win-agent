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
/** The reasoning the "reasoning model" mock thinks out loud (see REASONING_TEST). */
const REASONING =
  "Let me look: I need the free space of C:, so the system tool with action disk is right. " +
  "Then I report the number and stop.";
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
    // A reasoning model: it thinks out loud before it answers. Used by the verbosity
    // checks at the end of this suite - the reasoning has to reach the client, be kept
    // in the conversation, and never travel back to the endpoint.
    if (JSON.stringify(body.messages ?? []).includes("REASONING_TEST")) {
      res.end(
        JSON.stringify({
          model: "mock-1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "C: has 41.2 GB free.",
                reasoning_content: REASONING,
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29, reasoning_tokens: 7 },
        }),
      );
      return;
    }
    // A model that answers with nothing at all (all of it went to "thinking"):
    // used by the empty-reply checks at the end of this suite.
    if (JSON.stringify(body.messages ?? []).includes("EMPTY_REPLY_TEST")) {
      res.end(
        JSON.stringify({
          model: "mock-1",
          choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52, reasoning_tokens: 40 },
        }),
      );
      return;
    }
    // A turn that really uses a tool: the chat has to list the file it changed, so
    // the mock asks for `files write` once and then answers.
    if (JSON.stringify(body.messages ?? []).includes("WRITE_FILE_TEST")) {
      const finished = (body.messages ?? []).some((entry) => entry.role === "tool");
      const toolCall = {
        id: "call-write-1",
        type: "function",
        function: {
          name: "files",
          arguments: JSON.stringify({ action: "write", path: "turn-demo.txt", content: "from a tool call\n" }),
        },
      };
      res.end(
        JSON.stringify(
          finished
            ? {
                model: "mock-1",
                choices: [{ index: 0, message: { role: "assistant", content: "wrote it" }, finish_reason: "stop" }],
                usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
              }
            : {
                model: "mock-1",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: null, tool_calls: [toolCall] },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
              },
        ),
      );
      return;
    }
    // A turn that keeps a checklist: two items, one ticked, a file written, then an
    // answer with one item still open. The loop reminds it (twice), and what the user
    // must still see afterwards is the list, open item included.
    if (JSON.stringify(body.messages ?? []).includes("TODO_TEST")) {
      const messages = body.messages ?? [];
      const toolMessages = messages.filter((entry) => entry.role === "tool");
      const hasTodo = toolMessages.some((entry) => entry.name === "todo");
      const hasDone = toolMessages.some(
        (entry) => entry.name === "todo" && String(entry.content ?? "").includes("1. [x]"),
      );
      const hasFile = toolMessages.some((entry) => entry.name === "files");
      const callTo = (name, args) => ({
        model: "mock-1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call-${name}-${toolMessages.length}`,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
      });
      let payload;
      if (!hasTodo) payload = callTo("todo", { action: "set", items: ["write a.txt", "write b.txt"] });
      else if (!hasDone) payload = callTo("todo", { action: "done", id: 1 });
      else if (!hasFile) payload = callTo("files", { action: "write", path: "todo-demo.txt", content: "checklist\n" });
      else
        payload = {
          model: "mock-1",
          choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 },
        };
      res.end(JSON.stringify(payload));
      return;
    }
    // A slow turn: the queue checks send a second message while this one is still
    // running, and need it to still be running when they do.
    if (JSON.stringify(body.messages ?? []).includes("SLOW_TURN")) {
      setTimeout(() => {
        res.end(
          JSON.stringify({
            model: "mock-1",
            choices: [
              { index: 0, message: { role: "assistant", content: "mock answer (slow)" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
        );
      }, 1_500);
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

/**
 * Open an SSE connection and keep every event that arrives. `until(type)` reads on
 * until an event of that type shows up, so a test can wait for a turn's `done` and
 * then look at the `thinking` / `tool_call` / ... events that came before it.
 *
 * The server registers the client and flushes ": connected" in the same breath, so
 * once `fetch` has resolved, a turn started afterwards cannot be missed.
 */
async function watchEvents(timeoutMs = 60_000) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  async function until(type) {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const cut = buffer.indexOf("\n\n");
        if (cut < 0) break;
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        events.push(event);
        if (event.type === type) return events;
      }
    }
    return events;
  }
  return { events, until, stop: () => controller.abort() };
}

/** Poll /api/state until the turn is over (the `done` event beats the bookkeeping). */
async function settle(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = (await api("/api/state")).data;
    if (!state.running && (state.history?.length ?? 0) >= 2) return state;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return state;
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

  section("capabilities");
  {
    // What the model is offered, from the other end: the panel in Settings draws
    // exactly this, and the MCP server hands the same tool set to another agent.
    const caps = await api("/api/capabilities");
    check("the report is served", caps.status === 200, JSON.stringify(caps.data).slice(0, 160));
    check(
      "it lists the tools the model can call",
      Array.isArray(caps.data.tools) && caps.data.tools.some((tool) => tool.name === "files"),
      JSON.stringify(caps.data.tools?.map((tool) => tool.name)),
    );
    check(
      "each tool carries its description",
      caps.data.tools.every((tool) => typeof tool.description === "string" && tool.description.length > 0),
    );
    check("it names the mode that produced the list", ["guided", "normal"].includes(caps.data.agentMode), caps.data.agentMode);
    check("held-back tools are reported with a reason", Array.isArray(caps.data.withheld) && caps.data.withheld.every((tool) => typeof tool.reason === "string"));
    check("skills are part of it", Array.isArray(caps.data.skills));
    check("so are the MCP servers", Array.isArray(caps.data.mcp) && caps.data.mcp.length === 0, JSON.stringify(caps.data.mcp));
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

    // One specific entry, as the rollback button next to a row sends it.
    const badSeq = await api("/api/undo", "POST", { seq: 0 });
    check("an impossible seq is refused", badSeq.status === 400, JSON.stringify(badSeq.data));
    const gone = await api("/api/undo", "POST", { seq: 99 });
    check(
      "an unknown seq says so instead of crashing",
      gone.status === 200 && gone.data.ok === false && /no longer be undone/.test(gone.data.message),
      JSON.stringify(gone.data),
    );

    check("the retention window is reported", audit.data.retentionDays === 7, String(audit.data.retentionDays));
    await api("/api/settings", "POST", { undoRetentionDays: 14 });
    const longer = await api("/api/audit");
    check("a longer retention reaches the log", longer.data.retentionDays === 14, String(longer.data.retentionDays));
    await api("/api/settings", "POST", { undoRetentionDays: 7 });

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
    const offSeq = await api("/api/undo", "POST", { seq: 1 });
    check("rolling back one entry is refused too", /switched off/.test(offSeq.data.message), JSON.stringify(offSeq.data));
    const offCmd = await api("/api/terminal", "POST", { input: "/audit" });
    check("the terminal says logging is off", /switched off/.test(offCmd.data.output), String(offCmd.data.output).slice(0, 200));
    await api("/api/settings", "POST", { auditLog: true });

    // Normal mode is the way back to the raw shell. With the sandbox on, the shell
    // is offered there too - the script itself is read before it runs (1.6.0).
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

  section("skills");
  {
    const empty = await api("/api/skills");
    check("the skills folder lives in the data folder", empty.data.dir === `${dataDir}\\skills` || empty.data.dir === `${dataDir}/skills`, empty.data.dir);
    check("and starts empty in a fresh data folder", empty.data.skills.length === 0, JSON.stringify(empty.data.skills));

    const saved = await api("/api/skills", "POST", {
      name: "Disk Cleanup",
      description: "Free space without deleting anything in use",
      when: "the user asks to clean up the disk",
      body: "# Steps\n1. report sizes, 2. ask, 3. delete",
    });
    check("a skill is created", saved.status === 200 && saved.data.skill.name === "Disk-Cleanup", JSON.stringify(saved.data));
    check("the list shows it at once", saved.data.skills.length === 1 && saved.data.skills[0].description.length > 0);

    const withBody = await api("/api/skills?name=disk-cleanup");
    check("the editor can read the body back", /# Steps/.test(withBody.data.body ?? ""), JSON.stringify(withBody.data));

    const missing = await api("/api/skills?name=nope");
    check("an unknown skill is a 404, not an empty page", missing.status === 404, JSON.stringify(missing.data));

    const invalid = await api("/api/skills", "POST", { name: "x", body: "   " });
    check("a skill without a body is refused", invalid.status === 400 && /body/.test(invalid.data.error ?? ""), JSON.stringify(invalid.data));

    const state = await api("/api/state");
    check("the model is offered the skills tool", state.data.tools.includes("skills"), JSON.stringify(state.data.tools));

    const missingDelete = await api("/api/skills/delete", "POST", { name: "nope" });
    check("deleting an unknown skill is a 404", missingDelete.status === 404);
    const removed = await api("/api/skills/delete", "POST", { name: "Disk-Cleanup" });
    check("deleting a skill works", removed.status === 200 && removed.data.skills.length === 0);
    check("and its folder is gone", !fs.existsSync(path.join(dataDir, "skills", "Disk-Cleanup")));
  }

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

    const modelProfiles = await api("/api/model-profiles");
    check(
      "GET /api/model-profiles reports an empty store",
      modelProfiles.status === 200 &&
        Array.isArray(modelProfiles.data.profiles) &&
        modelProfiles.data.active === null &&
        modelProfiles.data.version >= 1,
      JSON.stringify(modelProfiles.data).slice(0, 200),
    );
    const modelBad = await api("/api/model-profiles", "POST", { action: "nonsense" });
    check("an unknown model-profile action is refused", modelBad.status === 400, JSON.stringify(modelBad.data));
    const modelDelete = await api("/api/model-profiles", "POST", { action: "delete", key: "not-there" });
    check("forgetting an unknown result is a no-op", modelDelete.status === 200 && modelDelete.data.removed === false);

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

  /* ---------------------------------------------------------------------- */

  section("the queue");
  {
    // A message sent while a turn is running waits instead of being refused, and
    // starts by itself when the turn ends - send three jobs, walk away.
    const first = await api("/api/chat", "POST", { message: "SLOW_TURN please take your time" });
    check("the slow turn starts", first.status === 202 && first.data.queued !== true, JSON.stringify(first.data));

    const second = await api("/api/chat", "POST", { message: "and then this one" });
    check(
      "a message sent during a turn is queued, not refused",
      second.status === 202 && second.data.queued === true && second.data.position === 1,
      JSON.stringify(second.data),
    );

    const listed = await api("/api/queue");
    check(
      "the queue lists it with its text",
      listed.data.items.length === 1 && /and then this one/.test(listed.data.items[0].message),
      JSON.stringify(listed.data.items),
    );

    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "queue.json"), "utf8"));
    check(
      "the queue is written to the data folder, so a restart keeps it",
      JSON.stringify(onDisk).includes("and then this one"),
      JSON.stringify(onDisk).slice(0, 120),
    );

    const removed = await api("/api/queue", "POST", { action: "remove", id: listed.data.items[0].id });
    check("one queued message can be dropped", removed.status === 200 && removed.data.items.length === 0);
    const afterRemove = JSON.parse(fs.readFileSync(path.join(dataDir, "queue.json"), "utf8"));
    check("a dropped message leaves the file too", afterRemove.items.length === 0, JSON.stringify(afterRemove));
    const missing = await api("/api/queue", "POST", { action: "remove", id: "nope" });
    check("removing an unknown id is a 404", missing.status === 404);
    const nonsense = await api("/api/queue", "POST", { action: "nonsense" });
    check("an unknown action is a 400", nonsense.status === 400);

    const third = await api("/api/chat", "POST", { message: "the queued job" });
    check("it can be queued again", third.data.queued === true, JSON.stringify(third.data));

    let drained = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const now = await api("/api/queue");
      const state = await api("/api/state");
      if (now.data.items.length === 0 && state.data.running === false) {
        drained = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check("the queue drains by itself when the turn ends", drained);

    const state = (await api("/api/state")).data;
    check(
      "the queued message ran in the same conversation",
      JSON.stringify(state.history).includes("the queued job"),
      JSON.stringify(state.history).slice(0, 200),
    );

    const wiped = await api("/api/reset", "POST", {});
    check("the conversation can be reset again", wiped.status === 200);
  }

  /* ---------------------------------------------------------------------- */

  section("what a turn changed");
  {
    // One turn, one tool call: afterwards the chat must know which file it touched,
    // and both rollback verbs must work on that row through the API.
    const started = await api("/api/chat", "POST", { message: "WRITE_FILE_TEST please" });
    check("the turn starts", started.status === 202 && started.data.queued !== true, JSON.stringify(started.data));

    let state = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      state = (await api("/api/state")).data;
      if (state.running === false && (state.turns ?? []).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const turn = (state?.turns ?? []).at(-1);
    const file = turn?.files?.[0];
    check("the turn is kept with the file it changed", Boolean(turn && file), JSON.stringify(turn));
    check("the row names the file the tool wrote", file?.path?.endsWith("turn-demo.txt") === true, file?.path);
    check("the row can be undone", file?.undoable === true, JSON.stringify(file));
    check("the version the change produced is saved", file?.restorable === true, JSON.stringify(file));
    const written = fs.readFileSync(path.join(scratch, "turn-demo.txt"), "utf8");
    check("the tool really wrote it", written.includes("from a tool call"), written);

    const undo = await api("/api/undo", "POST", { seq: file.seq });
    check(
      "undo puts the file back (it did not exist before the change)",
      undo.data.ok === true && !fs.existsSync(path.join(scratch, "turn-demo.txt")),
      JSON.stringify(undo.data),
    );
    const afterUndo = (await api("/api/turns")).data.turns.at(-1).files[0];
    check("the row no longer offers that undo", afterUndo.undoable === false, JSON.stringify(afterUndo));

    const restore = await api("/api/versions/restore", "POST", { seq: file.seq });
    check(
      "restoring the version writes that content back",
      restore.status === 200 &&
        fs.readFileSync(path.join(scratch, "turn-demo.txt"), "utf8").includes("from a tool call"),
      JSON.stringify(restore.data),
    );
    const unknown = await api("/api/versions/restore", "POST", { seq: 99_999 });
    check("restoring an unknown change is refused", unknown.status === 400, JSON.stringify(unknown.data));
    const nonsense = await api("/api/versions/restore", "POST", { seq: 0 });
    check("a bad seq is a 400", nonsense.status === 400);

    const wiped = await api("/api/reset", "POST", {});
    check("the conversation can be reset again", wiped.status === 200);
  }

  /* ---------------------------------------------------------------------- */

  section("the checklist a turn leaves behind");
  {
    // More steps than the suite's default, because the turn is meant to be reminded
    // twice before it may end (see src/agent.ts).
    await api("/api/settings", "POST", { maxSteps: 8, todoCheck: true });
    const started = await api("/api/chat", "POST", { message: "TODO_TEST please" });
    check("the turn starts", started.status === 202 && started.data.queued !== true, JSON.stringify(started.data));

    let state = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      state = (await api("/api/state")).data;
      const turn = (state.turns ?? []).at(-1);
      if (state.running === false && (turn?.todos ?? []).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const turn = (state?.turns ?? []).at(-1);
    check("the turn is kept even though the list is the point", Boolean(turn), JSON.stringify(turn));
    check("its card carries the checklist", (turn?.todos ?? []).length === 2, JSON.stringify(turn?.todos));
    check("the ticked item is done", turn?.todos?.[0]?.status === "done", JSON.stringify(turn?.todos));
    check("the forgotten item is still open", turn?.todos?.[1]?.status === "todo", JSON.stringify(turn?.todos));
    check(
      "the file it wrote is on the same card",
      (turn?.files ?? []).some((file) => file.path.endsWith("todo-demo.txt")),
      JSON.stringify(turn?.files),
    );
    check(
      "the open list is the conversation's current list",
      (state?.todos ?? []).length === 2 && state.todos[1].status === "todo",
      JSON.stringify(state?.todos),
    );
    check(
      "the checklist lives in history.json, not only in memory",
      (() => {
        try {
          const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "history.json"), "utf8"));
          return Array.isArray(saved.todos) && saved.todos.length === 2;
        } catch {
          return false;
        }
      })(),
    );
    check(
      "and in the saved turn",
      (() => {
        try {
          const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "history.json"), "utf8"));
          return (saved.turns ?? []).some((entry) => (entry.todos ?? []).length === 2);
        } catch {
          return false;
        }
      })(),
    );

    const turns = await api("/api/turns");
    check(
      "GET /api/turns returns it too",
      (turns.data.turns ?? []).at(-1)?.todos?.[1]?.text === "write b.txt",
      JSON.stringify((turns.data.turns ?? []).at(-1)?.todos),
    );

    const wiped = await api("/api/reset", "POST", {});
    const clean = (await api("/api/state")).data;
    check(
      "a new conversation starts with an empty checklist",
      wiped.status === 200 && (clean.todos ?? []).length === 0,
      JSON.stringify(clean.todos),
    );
    await api("/api/settings", "POST", { maxSteps: 4 });
  }

  /* ---------------------------------------------------------------------- */

  section("a model that answers with nothing");
  {
    // The whole point: a small reasoning model can return no text at all. The turn
    // has to ask once more, and if that fails too it must still say so out loud
    // instead of leaving an empty bubble behind.
    requests.length = 0;
    const sent = await api("/api/chat", "POST", { message: "EMPTY_REPLY_TEST what is the date" });
    check("the message is accepted", sent.status === 202, JSON.stringify(sent.data));

    const deadline = Date.now() + 30_000;
    let final = null;
    while (Date.now() < deadline) {
      final = (await api("/api/state")).data;
      if (!final.running && final.history.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const calls = requests.filter((r) => r.path.includes("/chat/completions"));
    check("the empty reply was asked for again, with a nudge", calls.length === 2, JSON.stringify(calls.map((c) => c.path)));
    check(
      "the nudge says what was wrong",
      JSON.stringify(calls.at(-1)?.body?.messages ?? []).includes("Your last reply was empty"),
      JSON.stringify(calls.at(-1)?.body?.messages ?? []).slice(-200),
    );

    const last = final?.history?.at(-1);
    check("the turn ended instead of hanging", final?.running === false, JSON.stringify(final?.history?.length));
    check(
      "and the user is told what happened, not given a blank bubble",
      last?.role === "assistant" && /no answer: the model returned an empty reply/.test(last.content),
      JSON.stringify(last),
    );
    check(
      "the same text is what a reload shows",
      (await api("/api/state")).data.history.at(-1).content === last.content,
    );
  }
  /* ---------------------------------------------------------------------- */

  section("the output-detail setting");
  {
    const initial = (await api("/api/state")).data;
    check(
      "the quiet level is the default",
      initial.settings.verbosity === "answer",
      String(initial.settings.verbosity),
    );

    const aliased = await api("/api/settings", "POST", { verbosity: "verbose" });
    check(
      "a level alias is accepted",
      aliased.status === 200 && aliased.data?.settings?.verbosity === "full",
      JSON.stringify(aliased.data),
    );
    const bilingual = await api("/api/settings", "POST", { verbosity: "思考" });
    check(
      "the levels understand both languages",
      bilingual.data?.settings?.verbosity === "thinking",
      JSON.stringify(bilingual.data?.settings),
    );
    check(
      "the change is reported like any other setting",
      bilingual.data?.changed?.includes("verbosity"),
      JSON.stringify(bilingual.data?.changed),
    );
    check(
      "and the state carries it",
      (await api("/api/state")).data.settings.verbosity === "thinking",
    );
  }

  /* ---------------------------------------------------------------------- */

  section("a reasoning model that thinks out loud");
  {
    await api("/api/reset", "POST", {});
    requests.length = 0;

    // The reasoning has to reach the client as it arrives - it is what the
    // `thinking` level of the chat log is made of.
    const watch = await watchEvents();
    try {
      const sent = await api("/api/chat", "POST", { message: "REASONING_TEST How much space is left on C:?" });
      check("the turn is accepted", sent.status === 202, JSON.stringify(sent.data));
      const seen = await watch.until("done");
      const thinking = seen.filter((e) => e.type === "thinking");
      check(
        "the reasoning text reaches the client",
        thinking.length > 0 && thinking.map((e) => e.text ?? "").join("") === REASONING,
        JSON.stringify(thinking),
      );
      check(
        "... with the character count the summary line shows",
        thinking.at(-1)?.chars === REASONING.length,
        `${thinking.at(-1)?.chars} vs ${REASONING.length}`,
      );
    } finally {
      watch.stop();
    }

    const after = await settle();
    const last = after?.history?.at(-1);
    check("the reasoning is kept with the message", last?.reasoning === REASONING, JSON.stringify(last));
    check("the answer itself is untouched", last?.content === "C: has 41.2 GB free.", JSON.stringify(last?.content));
    check(
      "so a reload can show it at the thinking level",
      (await api("/api/state")).data.history.at(-1).reasoning === REASONING,
    );
    check(
      "and it is written to the data folder",
      fs.readFileSync(path.join(dataDir, "history.json"), "utf8").includes("action disk is right"),
    );

    // A second turn puts that first answer - reasoning and all - into the request.
    requests.length = 0;
    await api("/api/chat", "POST", { message: "and D:?" });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const answered = requests.some((r) => r.path.includes("/chat/completions"));
      if (answered && !(await api("/api/state")).data.running) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const calls = requests.filter((r) => r.path.includes("/chat/completions"));
    const sentMessages = calls.at(-1)?.body?.messages ?? [];
    check(
      "the reasoning is never sent back to the endpoint",
      sentMessages.length > 0 && !JSON.stringify(sentMessages).includes("action disk is right"),
      JSON.stringify(sentMessages).slice(-300),
    );
    check(
      "no message carries a reasoning field",
      sentMessages.length > 0 && sentMessages.every((m) => !("reasoning" in m)),
      JSON.stringify(sentMessages.map((m) => Object.keys(m))),
    );
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
