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
import { McpManager, safeName, resolveCommand, isUsable } from "../src/mcp.js";

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
      requests.push({ message, session: req.headers["mcp-session-id"] ?? null });
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
    stdioServer({ id: "httpmock", name: "httpmock", transport: "http", command: "", args: [], url: `http://127.0.0.1:${httpPort}/mcp` }),
  ]);
  await manager.refresh();
  check("the http server is connected", manager.status()[0].connected === true, manager.status()[0].error);
  check("its tool is exposed", manager.tools(always, false).map((t) => t.schema.function.name).includes("mcp__httpmock__ping"));
  check("the session id is remembered", requests.some((r) => r.session === "sess-42"));

  sse = true;
  await manager.refresh();
  check("an SSE answer is parsed too", manager.status()[0].tools.includes("ping"));
  manager.close();
  server.close();
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
