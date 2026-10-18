// A tiny Model Context Protocol server that speaks newline-delimited JSON-RPC
// over stdin/stdout. It is only used by scripts/test-mcp.mjs, so that the MCP
// client can be tested without installing a real server.
//
// Behaviour is chosen with MOCK_MCP_MODE:
//   normal (default)  initialize, tools/list and tools/call
//   paged             tools/list answers in two pages, with a cursor
//   noisy             one non-JSON line on stdout before the protocol starts
//   silent            answers initialize, then never answers tools/list
//   crash             exits immediately (a server that cannot start)
import { createInterface } from "node:readline";

const MODE = process.env.MOCK_MCP_MODE ?? "normal";
const SAMPLING_ID = 999;

if (MODE === "crash") {
  process.stderr.write("mock MCP server refuses to start\n");
  process.exit(3);
}

const TOOLS = [
  {
    name: "echo",
    description: "Echo the text back",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  { name: "weird.name/x", description: "A name that is not identifier-safe", inputSchema: { type: "object", properties: {} } },
  { name: "fail", description: "Always fails", inputSchema: { type: "object", properties: {} } },
  { name: "structured", description: "Returns structured content", inputSchema: { type: "object", properties: {} } },
  { name: "sampling", description: "Reports how many client errors we saw", inputSchema: { type: "object", properties: {} } },
];

let unsupportedReplies = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function text(id, value) {
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: value }] } });
}

// A real server may print a banner; the client must skip anything not JSON.
if (MODE === "noisy") process.stdout.write("mock mcp server ready\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not ours
  }

  // A response to the sampling request we send below.
  if (message.method === undefined) {
    if (message.error) unsupportedReplies += 1;
    return;
  }
  if (message.id === undefined) {
    if (message.method === "notifications/initialized") {
      // Ask the client for something it does not implement: it must answer with
      // an error so this server is not left waiting forever.
      send({ jsonrpc: "2.0", id: SAMPLING_ID, method: "sampling/createMessage", params: {} });
    }
    return;
  }

  const id = message.id;
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-mcp", version: "1.0.0" },
        },
      });
      return;

    case "tools/list":
      if (MODE === "silent") return;
      if (MODE === "paged" && !message.params?.cursor) {
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS.slice(0, 2), nextCursor: "page2" } });
        return;
      }
      if (MODE === "paged" && message.params?.cursor === "page2") {
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS.slice(2) } });
        return;
      }
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;

    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (name === "echo") return text(id, `echo: ${args.text}`);
      if (name === "weird.name/x") return text(id, "weird ok");
      if (name === "fail") {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "the mock tool failed" }], isError: true } });
        return;
      }
      if (name === "structured") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "see structured content" }],
            structuredContent: { ok: true, count: 3 },
          },
        });
        return;
      }
      if (name === "sampling") return text(id, `unsupported replies: ${unsupportedReplies}`);
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${name}` } });
      return;
    }

    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${message.method}` } });
  }
});
