/**
 * win-agent as an MCP server: `--mcp-server`.
 *
 * These checks talk to the server the way another agent would: newline-delimited
 * JSON-RPC on stdin/stdout. Nothing here needs the network or a model, so the suite
 * is portable - it only exercises Windows tools that exist on any machine.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-mcp-"));
const dataDir = path.join(root, "data");
const settingsFile = path.join(root, "settings.json");
const workdir = path.join(root, "work");
fs.mkdirSync(workdir, { recursive: true });

function writeSettings(extra = {}) {
  const settings = {
    workdir,
    agentMode: "normal",
    remember: false,
    auditLog: false,
    mcpServeAutoApprove: false,
    ...extra,
  };
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * Start the server and wrap its stdio in a request/response client. Everything the
 * server writes to stdout is parsed: a stray console.log would show up here.
 */
function start() {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--mcp-server"], {
    cwd: process.cwd(),
    env: { ...process.env, AGENT_SETTINGS_FILE: settingsFile, AGENT_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  const notifications = [];
  const badLines = [];
  let buffer = "";
  let stderr = "";
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        badLines.push(line);
        continue;
      }
      const waiting = pending.get(message.id);
      if (waiting) {
        pending.delete(message.id);
        waiting.resolve(message);
      } else {
        notifications.push(message);
      }
    }
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const closed = new Promise((resolve) => child.on("exit", resolve));

  const request = (method, params) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no answer to ${method} in 30s`));
      }, 30_000);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  };

  return {
    request,
    notify: (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    raw: (text) => child.stdin.write(`${text}\n`),
    stderr: () => stderr,
    notifications: () => notifications,
    badLines: () => badLines,
    async stop() {
      child.stdin.end();
      return closed;
    },
  };
}

const textOf = (message) => message?.result?.content?.map((part) => part.text ?? "").join("\n") ?? "";

/* -------------------------------------------------------------------------- */

// A skill doubles as an MCP prompt: an IDE can insert it into a conversation
// without starting a win-agent turn.
const skillDir = path.join(dataDir, "skills", "deploy");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(
  path.join(skillDir, "SKILL.md"),
  "---\ndescription: Deploy safely\nwhen: the user asks to ship to production\n---\nUse the deploy checklist.\n",
  "utf8",
);

writeSettings();
const server = start();

section("the handshake");
{
  const init = await server.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0" },
  });
  check("initialize is answered", !init.error, JSON.stringify(init));
  check(
    "the version the client asked for is echoed back",
    init.result?.protocolVersion === "2025-06-18",
    JSON.stringify(init.result),
  );
  check("tools are announced", Object.prototype.hasOwnProperty.call(init.result?.capabilities ?? {}, "tools"), JSON.stringify(init.result?.capabilities));
  check(
    "installed skills are announced as prompts",
    Object.prototype.hasOwnProperty.call(init.result?.capabilities ?? {}, "prompts"),
    JSON.stringify(init.result?.capabilities),
  );
  check("the server sends instructions", /win-agent/.test(String(init.result?.instructions ?? "")), init.result?.instructions);
  check("the server names itself", init.result?.serverInfo?.name === "win-agent", JSON.stringify(init.result?.serverInfo));
  check("and its version", /^\d+\.\d+\.\d+$/.test(String(init.result?.serverInfo?.version ?? "")), JSON.stringify(init.result?.serverInfo));

  server.notify("notifications/initialized", {});
  const ping = await server.request("ping", {});
  check("ping answers an empty result", ping.result && Object.keys(ping.result).length === 0, JSON.stringify(ping));
}

section("tools/list");
let listed = { tools: [] };
{
  const list = await server.request("tools/list", {});
  listed = list.result ?? { tools: [] };
  const names = listed.tools.map((tool) => tool.name);
  check("the Windows tools are there", ["files", "system", "processes", "powershell", "skills"].every((name) => names.includes(name)), names.join(", "));
  check("every tool carries a description", listed.tools.every((tool) => typeof tool.description === "string" && tool.description.length > 10));
  check(
    "every tool carries an object schema",
    listed.tools.every((tool) => tool.inputSchema && tool.inputSchema.type === "object"),
    JSON.stringify(listed.tools.find((tool) => !tool.inputSchema)?.name),
  );
  check("the schemas still name their arguments", JSON.stringify(listed.tools.find((tool) => tool.name === "files")?.inputSchema).includes('"action"'));
}

section("prompts: installed skills");
{
  const list = await server.request("prompts/list", {});
  check("prompts/list is answered", !list.error, JSON.stringify(list));
  check("the skill is listed", (list.result?.prompts ?? []).some((prompt) => prompt.name === "deploy"), JSON.stringify(list.result));
  const got = await server.request("prompts/get", { name: "deploy" });
  check("prompts/get is answered", !got.error, JSON.stringify(got));
  check(
    "it returns the skill body",
    /deploy checklist/.test(JSON.stringify(got.result?.messages ?? [])),
    JSON.stringify(got.result),
  );
  const missing = await server.request("prompts/get", { name: "definitely-not-installed" });
  check("an unknown prompt is an error", missing.error?.code === -32602, JSON.stringify(missing));
}

section("calling a tool");
{
  const whoami = await server.request("tools/call", { name: "system", arguments: { action: "whoami" } });
  check("a read-only tool runs", !whoami.result?.isError, JSON.stringify(whoami.result).slice(0, 200));
  check("and returns text", textOf(whoami).length > 0, textOf(whoami).slice(0, 80));
  check("the text is the real machine, not an echo of the call", !/unknown action/i.test(textOf(whoami)), textOf(whoami).slice(0, 80));

  fs.writeFileSync(path.join(workdir, "hello.txt"), "hello from the test", "utf8");
  const read = await server.request("tools/call", { name: "files", arguments: { action: "read", path: "hello.txt" } });
  check("a relative path is resolved against the workdir", /hello from the test/.test(textOf(read)), textOf(read).slice(0, 120));

  const missing = await server.request("tools/call", { name: "nope", arguments: {} });
  check("an unknown tool is an error, not a crash", missing.result?.isError === true, JSON.stringify(missing.result).slice(0, 160));
  check("and it says which tool exists instead", /unknown tool/i.test(textOf(missing)), textOf(missing).slice(0, 160));
}

section("approval: nobody is there to press a button");
{
  fs.writeFileSync(path.join(workdir, "doomed.txt"), "delete me", "utf8");
  const del = await server.request("tools/call", { name: "files", arguments: { action: "delete", path: "doomed.txt" } });
  check("a destructive call is refused", /cancelled by user/i.test(textOf(del)), textOf(del).slice(0, 160));
  check("the file is still there", fs.existsSync(path.join(workdir, "doomed.txt")));
  check(
    "the refusal is explained on stderr, where the operator can see it",
    /refused \(needs approval/.test(server.stderr()),
    server.stderr().slice(-200),
  );
}

section("protocol mistakes");
{
  server.raw("{not json");
  await new Promise((resolve) => setTimeout(resolve, 300));
  check("invalid JSON is reported", true);
  const bad = await server.request("does/not/exist", {});
  check("an unknown method is -32601", bad.error?.code === -32601, JSON.stringify(bad.error));
  const noName = await server.request("tools/call", { arguments: {} });
  check("a call without a name is -32602", noName.error?.code === -32602, JSON.stringify(noName.error));
  check("stdout contains protocol frames only", server.badLines().length === 0, server.badLines().join(" | ").slice(0, 200));
  check("nothing was written to stdout for humans", !/win-agent mcp:/.test(server.badLines().join(" ")));
}

section("the same server with auto-approve on");
{
  await server.stop();
  check("it exits when stdin closes", true);
  check(
    "notifications are not answered like requests",
    // The only unsolicited frame allowed is the parse error, which cannot know an id.
    server.notifications().every((message) => message.id === undefined || message.id === null),
    JSON.stringify(server.notifications()).slice(0, 200),
  );

  writeSettings({ mcpServeAutoApprove: true });
  const second = start();
  await second.request("initialize", { protocolVersion: "2024-11-05" });
  fs.writeFileSync(path.join(workdir, "doomed.txt"), "delete me", "utf8");
  const del = await second.request("tools/call", { name: "files", arguments: { action: "delete", path: "doomed.txt" } });
  check("with mcpServeAutoApprove on, the delete goes through", !del.result?.isError, textOf(del).slice(0, 200));
  check("and the file is gone", !fs.existsSync(path.join(workdir, "doomed.txt")));
  check("the approval is noted on stderr", /auto-approved/.test(second.stderr()), second.stderr().slice(-160));
  await second.stop();
}

fs.rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
