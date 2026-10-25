// MCP client checks: stdio + Streamable HTTP, tool naming, approval, errors.
// Run with: npm run test:mcp
//
// Nothing here needs a real MCP server: scripts/fixtures/mock-mcp-server.mjs
// pretends to be one over stdio, and a throwaway HTTP server pretends to be
// one over Streamable HTTP.
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  McpManager,
  expandEnv,
  isUsable,
  parseMcpConfig,
  resolveCommand,
  safeName,
  testMcpServer,
  toolPolicyFor,
} from "../src/mcp.js";
import { normalizeMcpServers } from "../src/settings.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK = path.join(HERE, "fixtures", "mock-mcp-server.mjs");

/**
 * Free ports from the OS. A fixed port made this suite die at startup (EADDRINUSE)
 * whenever anything else on the machine happened to hold it - and a suite that dies
 * before its first check says nothing at all about the code.
 */
async function freePorts(n) {
  const ports = new Set();
  while (ports.size < n) {
    ports.add(
      await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          const { port } = probe.address();
          probe.close(() => resolve(port));
        });
      }),
    );
  }
  return [...ports];
}

let failures = 0;
let passed = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

/** A manager over a changing server list, so a test can edit it in place. */
function makeManager(servers, timeoutMs = 8000) {
  let list = servers;
  const manager = new McpManager(() => list, timeoutMs);
  return {
    manager,
    set(next) {
      list = next;
    },
    add(server) {
      list = [...list, server];
    },
    list: () => list,
  };
}

function stdioServer(over = {}) {
  return {
    id: "mock",
    name: "mock",
    transport: "stdio",
    command: process.execPath,
    args: [MOCK],
    env: {},
    url: "",
    enabled: true,
    autoApprove: false,
    tools: [],
    ...over,
  };
}

const always = async () => true;
const never = async () => false;

/**
 * A tool context for a direct `tool.run(...)` call. The registry normally injects
 * `record` and `backup` (see src/tools/registry.ts); the MCP wrapper records every
 * call in the audit log, so a hand-made context has to provide the same two.
 */
function ctxOf(approve, extra = {}) {
  return {
    dryRun: false,
    approve,
    record: (input) => {
      ctxOf.recorded.push(input);
      return null;
    },
    backup: async () => null,
    ...extra,
  };
}
ctxOf.recorded = [];

/* -------------------------------------------------------------------------- */

console.log("tool naming");
check("names are prefixed with the server", safeName("fs", "read_file") === "mcp__fs__read_file");
check(
  "names that are not identifier-safe are sanitized",
  safeName("mock", "weird.name/x") === "mcp__mock__weird_name_x",
  safeName("mock", "weird.name/x"),
);
check("names are capped at 64 characters", safeName("s".repeat(40), "t".repeat(40)).length === 64);
check("a server is unusable without a command", isUsable(stdioServer({ command: "" })) === false);
check(
  "an http server is unusable without a url",
  isUsable(stdioServer({ transport: "http", url: "" })) === false,
);

console.log("resolveCommand()");
check("finds an .exe on PATH", /node(\.exe)?$/i.test(resolveCommand("node")), resolveCommand("node"));
check("keeps an absolute path", resolveCommand(process.execPath) === process.execPath);
check("returns an unknown name unchanged", resolveCommand("definitely-not-a-real-command") === "definitely-not-a-real-command");

/* -------------------------------------------------------------------------- */

console.log("stdio: connect, list tools, call them");
{
  const { manager } = makeManager([stdioServer()]);
  await manager.refresh();
  const status = manager.status()[0];
  check("the server reports itself as connected", status.connected === true, status.error);
  check("it tells us what it called itself", status.serverInfo === "mock-mcp 1.0.0", status.serverInfo);

  const tools = manager.tools(always, false);
  const names = tools.map((tool) => tool.schema.function.name);
  check("every advertised tool is exposed", tools.length === 5, names.join(", "));
  check("names are prefixed", names.every((name) => name.startsWith("mcp__mock__")), names.join(", "));
  check("the awkward name was sanitized", names.includes("mcp__mock__weird_name_x"), names.join(", "));
  const echo = tools.find((tool) => tool.schema.function.name === "mcp__mock__echo");
  check("the input schema is passed through", echo.schema.function.parameters.required?.[0] === "text");

  const run = async (name, args, approve = always) => {
    const tool = manager.tools(approve, false).find((t) => t.schema.function.name === name);
    return tool.run(args, ctxOf(approve));
  };

  check("a tool call comes back as text", (await run("mcp__mock__echo", { text: "hi" })) === "echo: hi");
  const recorded = ctxOf.recorded.at(-1);
  check(
    "the call is recorded for the audit log",
    recorded?.action === "echo" && /called MCP tool mock\/echo with \{"text":"hi"\}/.test(recorded.summary),
    JSON.stringify(recorded),
  );
  check("a cleanly sanitized name still works", (await run("mcp__mock__weird_name_x", {})) === "weird ok");
  check("isError is reported as an error", (await run("mcp__mock__fail", {})).startsWith("Error: the mock tool failed"));
  const structured = await run("mcp__mock__structured", {});
  check("structured content is included", /"ok": true/.test(structured) && /see structured content/.test(structured));
  check("the client answered the server's request with an error", (await run("mcp__mock__sampling", {})) === "unsupported replies: 1");

  let unknown = "";
  try {
    await manager.call("mcp__mock__nope", {});
  } catch (error) {
    unknown = error.message;
  }
  check("an unknown tool name is reported", /unknown MCP tool/.test(unknown), unknown);

  console.log("approval");
  check("a denied call is cancelled", (await run("mcp__mock__echo", { text: "x" }, never)).startsWith("Cancelled:"));
  let asked = "";
  const approve = async (summary) => {
    asked = summary;
    return true;
  };
  await run("mcp__mock__echo", { text: "y" }, approve);
  check("the prompt names the server and tool", asked === "call MCP tool mock/echo", asked);

  const trusted = manager.tools(never, false).find((t) => t.schema.function.name === "mcp__mock__echo");
  check("dry run reports instead of calling", (await trusted.run({ text: "z" }, ctxOf(always, { dryRun: true }))).startsWith("DRY RUN:"));

  manager.close();
}

console.log("stdio: resources, prompts and mcp_context");
{
  const { manager } = makeManager([stdioServer()]);
  await manager.refresh();
  const status = manager.status()[0];
  check("resources are listed", status.resources.includes("mock://doc"), status.resources.join(", "));
  check("prompts are listed", status.prompts.includes("greet"), status.prompts.join(", "));
  check(
    "the capabilities say what the server supports",
    status.capabilities.tools && status.capabilities.resources && status.capabilities.prompts,
  );
  check("a resource can be read", (await manager.readResource("mock://doc")) === "resource body");
  check("a prompt can be rendered", (await manager.getPrompt("greet", { name: "Ada" })).includes("hello Ada"));

  const context = manager.contextTool();
  check("one context tool replaces a tool per document", context !== null);
  const list = await context.run({ action: "list" }, ctxOf(always));
  check("the catalogue names the resource", list.includes("mock://doc"), list);
  check("the catalogue names the prompt", list.includes("greet"), list);
  check("the context tool can read", (await context.run({ action: "read", uri: "mock://doc" }, ctxOf(always))) === "resource body");
  check(
    "the context tool can render a prompt",
    (await context.run({ action: "prompt", name: "greet", arguments: { name: "Bob" } }, ctxOf(always))).includes(
      "hello Bob",
    ),
  );
  manager.close();
}

console.log("stdio: tool policies and environment expansion");
{
  const { manager } = makeManager([
    stdioServer({ toolPolicies: { echo: "deny", fail: "allow", structured: "ask" } }),
  ]);
  await manager.refresh();
  const names = manager.tools(always, false).map((tool) => tool.schema.function.name);
  check("a denied tool is not offered", !names.includes("mcp__mock__echo"), names.join(", "));
  check("an allowed tool is offered", names.includes("mcp__mock__fail"));
  check("an ask tool is offered", names.includes("mcp__mock__structured"));
  check("the policy is readable", toolPolicyFor(stdioServer({ toolPolicies: { echo: "deny" } }), "echo") === "deny");
  check("autoApprove is the fallback", toolPolicyFor(stdioServer({ autoApprove: true }), "echo") === "allow");
  const fail = manager.tools(never, false).find((tool) => tool.schema.function.name === "mcp__mock__fail");
  check("allow skips the prompt", (await fail.run({}, ctxOf(never))).startsWith("Error: the mock tool failed"));
  manager.close();
}

console.log("environment expansion");
{
  process.env.WIN_AGENT_MCP_TOKEN = "token-42";
  check("${NAME} is expanded", expandEnv("Bearer ${WIN_AGENT_MCP_TOKEN}") === "Bearer token-42");
  check("${env:NAME} is expanded", expandEnv("${env:WIN_AGENT_MCP_TOKEN}") === "token-42");
  check("%NAME% is expanded", expandEnv("%WIN_AGENT_MCP_TOKEN%") === "token-42");
  check("an unknown name becomes empty", expandEnv("x${WIN_AGENT_MCP_MISSING}y") === "xy");
  delete process.env.WIN_AGENT_MCP_TOKEN;
}

console.log("testMcpServer() reads a server without touching the manager");
{
  const result = await testMcpServer(stdioServer());
  check("the test passes", result.ok === true, result.error);
  check("it names the protocol", result.protocolVersion === "2025-06-18", result.protocolVersion);
  check("it reports tools", result.tools.includes("echo"), result.tools.join(", "));
  check("it reports resources", result.resources.includes("mock://doc"), result.resources.join(", "));
  check("it reports prompts", result.prompts.includes("greet"), result.prompts.join(", "));
}

console.log("config import: Claude Desktop / Cursor / VS Code");
{
  const existing = [stdioServer({ id: "keep", name: "Keep me" })];
  const imported = parseMcpConfig(
    {
      mcpServers: {
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\"], env: { A: "1" } },
        remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
        legacy: { url: "https://example.com/sse" },
        keep: { command: "node", args: ["server.mjs"] },
      },
    },
    existing,
  );
  check("new servers are added", imported.added === 3, JSON.stringify(imported));
  check("an existing id is updated, not duplicated", imported.updated === 1, JSON.stringify(imported));
  check("the existing server survives once", imported.servers.filter((s) => s.id === "keep").length === 1);
  const fs = imported.servers.find((s) => s.id === "fs");
  check("a command becomes stdio", fs.transport === "stdio" && fs.command === "npx");
  check("arguments are kept", fs.args[1] === "@modelcontextprotocol/server-filesystem");
  check("env is kept", fs.env.A === "1");
  check("a URL defaults to HTTP", imported.servers.find((s) => s.id === "remote").transport === "http");
  check("a URL ending in /sse is SSE", imported.servers.find((s) => s.id === "legacy").transport === "sse");
  check("headers are kept", imported.servers.find((s) => s.id === "remote").headers.Authorization === "Bearer x");

  const again = parseMcpConfig(
    { mcpServers: { fs: { command: "npx", args: ["-y", "other"] } } },
    imported.servers,
  );
  check("re-importing updates in place", again.updated === 1 && again.servers.length === imported.servers.length);
  check("the new argument took effect", again.servers.find((s) => s.id === "fs").args[1] === "other");
  check("the display name of another server is untouched", again.servers.find((s) => s.id === "keep").name === "Keep me");

  const partial = parseMcpConfig({ mcpServers: { fs: { env: { B: "2" } } } }, again.servers);
  const kept = partial.servers.find((s) => s.id === "fs");
  check("a partial import keeps the command", kept.command === "npx", kept.command);
  check("a partial import keeps the arguments", kept.args[1] === "other", kept.args.join(", "));
  check("a partial import keeps unrelated env", kept.env.A === "1", JSON.stringify(kept.env));
  check("a partial import adds the new env", kept.env.B === "2", JSON.stringify(kept.env));
}

console.log("settings validation for the new MCP fields");
{
  const [server] = normalizeMcpServers([
    {
      id: "x",
      transport: "sse",
      url: "https://example.com/sse",
      args: "-y one two",
      headers: { Authorization: "Bearer t" },
      toolPolicies: { echo: "deny" },
      timeoutMs: 500,
      cwd: "D:\\workspace",
    },
  ]);
  check("SSE is accepted", server.transport === "sse");
  check("a command line string becomes arguments", server.args.length === 3);
  check("headers survive", server.headers.Authorization === "Bearer t");
  check("tool policies survive", server.toolPolicies.echo === "deny");
  check("a short timeout is clamped", server.timeoutMs === 1_000);
  check("cwd survives", server.cwd === "D:\\workspace");

  let duplicate = "";
  try {
    normalizeMcpServers([
      { id: "same", command: "node" },
      { id: "same", command: "node" },
    ]);
  } catch (error) {
    duplicate = error.message;
  }
  check("duplicate ids are rejected", /used twice/.test(duplicate), duplicate);

  let badPolicy = "";
  try {
    normalizeMcpServers([{ id: "p", command: "node", toolPolicies: { echo: "maybe" } }]);
  } catch (error) {
    badPolicy = error.message;
  }
  check("an unknown tool policy is rejected", /must be allow, ask or deny/.test(badPolicy), badPolicy);
}

console.log("stdio: autoApprove skips the prompt");
{
  const { manager } = makeManager([stdioServer({ autoApprove: true })]);
  await manager.refresh();
  const tool = manager.tools(never, false).find((t) => t.schema.function.name === "mcp__mock__echo");
  check("the tool runs without approval", (await tool.run({ text: "yes" }, ctxOf(never))) === "echo: yes");
  manager.close();
}

console.log("stdio: a server that logs to stdout first");
{
  const { manager } = makeManager([stdioServer({ env: { MOCK_MCP_MODE: "noisy" } })]);
  await manager.refresh();
  check("the banner line is ignored", manager.status()[0].tools.length === 5, JSON.stringify(manager.status()));
  manager.close();
}

console.log("stdio: paginated tool lists are followed");
{
  const { manager } = makeManager([stdioServer({ env: { MOCK_MCP_MODE: "paged" } })]);
  await manager.refresh();
  const tools = manager.tools(always, false).map((t) => t.schema.function.name);
  check("tools from the second page are included", tools.length === 5, tools.join(", "));
  manager.close();
}

console.log("stdio: a server that never answers tools/list");
{
  const { manager } = makeManager([stdioServer({ env: { MOCK_MCP_MODE: "silent" } })], 600);
  await manager.refresh();
  const status = manager.status()[0];
  check("it is reported as not connected", status.connected === false);
  check("the reason is a timeout", /no answer to tools\/list/.test(status.error), status.error);
  check("no tools are offered", manager.tools(always, false).length === 0);
  manager.close();
}

console.log("stdio: a server that cannot start");
{
  const { manager } = makeManager([stdioServer({ env: { MOCK_MCP_MODE: "crash" } })], 3000);
  const started = Date.now();
  await manager.refresh();
  const status = manager.status()[0];
  check("refresh does not throw", Array.isArray(manager.status()));
  check("the failure is reported", status.connected === false && status.error.length > 0, status.error);
  check("the server's own complaint is shown", /refuses to start/.test(status.error), status.error);
  check("it does not wait for the timeout", Date.now() - started < 2000, `${Date.now() - started}ms`);
  manager.close();
}

console.log("stdio: a command that does not exist");
{
  const { manager } = makeManager([stdioServer({ command: "definitely-not-a-real-command" })], 15_000);
  const started = Date.now();
  await manager.refresh();
  const status = manager.status()[0];
  check("the failure is reported", status.connected === false);
  check("the reason is the spawn error", /could not start|ENOENT/i.test(status.error), status.error);
  check("it fails fast, it does not wait for the 15s timeout", Date.now() - started < 3000, `${Date.now() - started}ms`);
  manager.close();
}

console.log("a disabled server is never started");
{
  const { manager } = makeManager([stdioServer({ enabled: false })]);
  await manager.refresh();
  check("it is not connected", manager.status()[0].connected === false);
  check("it offers no tools", manager.tools(always, false).length === 0);
  manager.close();
}

console.log("ensureFresh() only refreshes when the cache is old");
{
  const { manager } = makeManager([stdioServer()]);
  await manager.refresh();
  const age = manager.age();
  await manager.ensureFresh(60_000);
  check("a fresh cache is reused", manager.age() === age);
  await manager.ensureFresh(0);
  check("an expired cache is refreshed", manager.age() < age || manager.age() >= 0);
  check("the age is a number of milliseconds", typeof manager.age() === "number" && manager.age() >= 0);
  manager.close();
}

console.log("connections are dropped when a server is switched off or removed");
{
  const state = makeManager([stdioServer()]);
  await state.manager.refresh();
  state.set([stdioServer({ enabled: false })]);
  await state.manager.refresh();
  check("the connection is gone", state.manager.status()[0].connected === false);
  state.set([]);
  await state.manager.refresh();
  check("no servers means no tools", state.manager.tools(always, false).length === 0);
  state.manager.close();
}

/* -------------------------------------------------------------------------- */

console.log("http: Streamable HTTP transport (JSON and SSE answers)");
{
  // A port of our own: a fixed one somebody else holds would fail this suite for the
  // wrong reason (that is exactly how a red CI run told us nothing at all).
  const [httpPort] = await freePorts(1);
  let sse = false;
  let sawSession = false;
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const message = JSON.parse(raw);
      requests.push({ message, session: req.headers["mcp-session-id"] ?? null, headers: req.headers });
      if (message.method === "initialize") {
        res.setHeader("Mcp-Session-Id", "sess-42");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { protocolVersion: "2025-06-18", serverInfo: { name: "http-mock", version: "0.1" }, capabilities: {} },
          }),
        );
        return;
      }
      if (message.method === undefined) {
        res.writeHead(202).end();
        return;
      }
      if (message.method === "tools/list" && sse) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { tools: [{ name: "ping", description: "pong", inputSchema: { type: "object", properties: {} } }] },
          })}\n\n`,
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "ping", description: "pong", inputSchema: { type: "object", properties: {} } }] },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(httpPort, "127.0.0.1", resolve));

  const { manager } = makeManager([
    stdioServer({
      id: "httpmock",
      name: "httpmock",
      transport: "http",
      command: "",
      args: [],
      url: `http://127.0.0.1:${httpPort}/mcp`,
      headers: { Authorization: "Bearer token", "X-Mock": "1" },
    }),
  ]);
  await manager.refresh();
  check("the http server is connected", manager.status()[0].connected === true, manager.status()[0].error);
  check("its tool is exposed", manager.tools(always, false).map((t) => t.schema.function.name).includes("mcp__httpmock__ping"));
  check("the session id is remembered", requests.some((r) => r.session === "sess-42"));
  check("custom headers are sent", requests.every((r) => r.headers.authorization === "Bearer token"));
  check("extra headers are sent", requests.every((r) => r.headers["x-mock"] === "1"));
  check(
    "the protocol version is sent",
    requests.every((r) => r.headers["mcp-protocol-version"] === "2025-06-18"),
    requests[0]?.headers["mcp-protocol-version"],
  );

  sse = true;
  await manager.refresh();
  check("an SSE answer is parsed too", manager.status()[0].tools.includes("ping"));
  manager.close();
  server.close();
}

console.log("sse: the older HTTP+SSE transport");
{
  const [ssePort] = await freePorts(1);
  const clients = new Set();
  const sseServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/sse")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("event: endpoint\ndata: /messages?session=abc\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "POST" && req.url.startsWith("/messages")) {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const message = JSON.parse(raw);
        res.writeHead(202).end();
        if (message.id === undefined) return;
        let result = {};
        if (message.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "sse-mock", version: "1" },
          };
        } else if (message.method === "tools/list") {
          result = { tools: [{ name: "ping", description: "pong", inputSchema: { type: "object", properties: {} } }] };
        } else if (message.method === "tools/call") {
          result = { content: [{ type: "text", text: "sse pong" }] };
        }
        const payload = { jsonrpc: "2.0", id: message.id, result };
        for (const client of clients) {
          client.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => sseServer.listen(ssePort, "127.0.0.1", resolve));
  const { manager } = makeManager([
    stdioServer({
      id: "legacy",
      name: "legacy",
      transport: "sse",
      command: "",
      args: [],
      url: `http://127.0.0.1:${ssePort}/sse`,
    }),
  ]);
  await manager.refresh();
  const status = manager.status()[0];
  check("the SSE server is connected", status.connected === true, status.error);
  const tool = manager.tools(always, false).find((t) => t.schema.function.name === "mcp__legacy__ping");
  check("its tool is exposed", !!tool);
  check("the tool can be called over SSE", (await tool.run({}, ctxOf(always))) === "sse pong");
  manager.close();
  for (const client of clients) client.end();
  sseServer.close();
}

console.log("http: an unreachable endpoint is reported");
{
  // A free port, left closed: nothing is listening on it, which is the point.
  const [deadPort] = await freePorts(1);
  const { manager } = makeManager(
    [stdioServer({ id: "dead", name: "dead", transport: "http", command: "", args: [], url: `http://127.0.0.1:${deadPort}/mcp` })],
    2000,
  );
  await manager.refresh();
  check("it is reported as not connected", manager.status()[0].connected === false);
  check("with a reason", manager.status()[0].error.length > 0, manager.status()[0].error);
  manager.close();
}

console.log(
  failures === 0 ? `\nall ${passed} MCP checks passed` : `\n${failures} check(s) FAILED (${passed} passed)`,
);
process.exit(failures === 0 ? 0 : 1);
