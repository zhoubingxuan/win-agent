/**
 * Real-server compatibility pass for the MCP client.
 *
 * This is deliberately not part of `test:all`: it needs npm's network/cache and
 * launches third-party servers. Run it by hand after touching src/mcp.ts:
 *
 *   npm run test:mcp:real
 *
 * It covers the three transports that matter on Windows:
 *   - stdio through `npx` (resolved to npx.cmd by the client)
 *   - stdio with tools, resources and prompts (server-everything)
 *   - Streamable HTTP against a public server (DeepWiki)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-mcp-real-"));
const source = (name) => pathToFileURL(path.join(root, "src", name)).href;
process.env.AGENT_DATA_DIR = temp;
process.env.AGENT_SETTINGS_FILE = path.join(temp, "settings.json");

const { loadSettings, updateSettings } = await import(source("settings.ts"));
const { mcp, testMcpServer } = await import(source("mcp.ts"));

let passed = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  ok   ${label}`);
}

const base = {
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  enabled: true,
  autoApprove: false,
  tools: [],
};

try {
  loadSettings();
  updateSettings({ workdir: root, sandbox: true, mcpEnabled: true, mcpServers: [] });

  console.log("stdio: filesystem (npx)");
  const filesystem = await testMcpServer(
    {
      ...base,
      id: "fs",
      name: "fs",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", root],
    },
    120_000,
  );
  ok(filesystem.ok, "the server starts through npx");
  ok(filesystem.protocolVersion === "2025-06-18", "it negotiates the current protocol");
  ok(filesystem.tools.includes("read_text_file"), "read_file is advertised");
  ok(filesystem.tools.includes("write_file"), "write_file is advertised");
  ok(!filesystem.error, "there is no connection error");

  console.log("stdio: everything (tools, resources, prompts)");
  updateSettings({
    mcpServers: [
      {
        ...base,
        id: "everything",
        name: "everything",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    ],
  });
  await mcp.refresh(true);
  const snap = mcp.status();
  const everything = snap.find((server) => server.id === "everything");
  ok(everything?.connected, "the manager connects");
  ok(everything.tools.includes("echo"), "the echo tool is exposed");
  ok(everything.resources.length > 0, "resources are listed");
  ok(everything.prompts.length > 0, "prompts are listed");

  const echo = mcp.names().find((name) => name.endsWith("__echo"));
  ok(echo, "the tool gets a usable prefixed name");
  const echoResult = await mcp.call(echo, { message: "real-mcp" });
  ok(echoResult.text.includes("real-mcp") && !echoResult.isError, "the tool really runs");

  const catalogue = await mcp.contextTool().run(
    { action: "list" },
    { dryRun: false, guided: false, approve: async () => true },
  );
  ok(catalogue.includes("everything"), "one context tool names the server");
  ok(catalogue.includes("resource"), "the catalogue mentions resources");

  const resource = everything.resources[0];
  const body = await mcp.readResource(resource);
  ok(typeof body === "string" && body.length > 0, "a resource can be read");

  const prompt = everything.prompts[0];
  const rendered = await mcp.getPrompt(prompt, {});
  ok(typeof rendered === "string" && rendered.length > 0, "a prompt can be rendered");

  console.log("http: DeepWiki (public Streamable HTTP)");
  const remote = await testMcpServer(
    {
      ...base,
      id: "deepwiki",
      name: "deepwiki",
      transport: "http",
      command: "",
      url: "https://mcp.deepwiki.com/mcp",
    },
    45_000,
  );
  ok(remote.ok, "the remote server answers");
  ok(remote.protocolVersion === "2025-06-18", "the remote protocol is negotiated");
  ok(remote.tools.length > 0, "the remote tools are listed");
  ok(!remote.error, "there is no remote error");

  console.log(`\nall ${passed} real MCP checks passed`);
} finally {
  mcp.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
