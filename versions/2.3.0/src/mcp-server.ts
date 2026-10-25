/**
 * win-agent as an MCP **server**.
 *
 * Another agent (Claude Desktop, an IDE, another MCP client) can start win-agent
 * with `--mcp-server` and use the same Windows tools through the Model Context
 * Protocol over stdio. This is the other direction of `src/mcp.ts`, which consumes
 * other people's servers.
 *
 * Two rules make this safe to hand to another agent:
 *  - stdout carries protocol frames only; anything written for a human goes to
 *    stderr, or the client would read it as a malformed message;
 *  - there is nobody at this agent's UI to approve anything, so every action that
 *    would ask for approval is refused unless `mcpServeAutoApprove` is on.
 */
import fs from "node:fs";
import readline from "node:readline";
import { configureAudit } from "./audit.js";
import { capText } from "./context.js";
import { configureErrorHints, configurePowerShell, configurePowerShellDiagnostics } from "./util/ps.js";
import { ensureSkillsFolder, listSkills, loadSkill } from "./skills.js";
import { effectiveAgentMode, getSettings } from "./settings.js";
import { createWindowsTools, type Approval } from "./tools/index.js";
import { mcp } from "./mcp.js";
import { VERSION } from "./version.js";

/**
 * Revisions this server understands, newest first. A client that asks for one of
 * them gets that one back; anything else is answered with the newest, which is
 * what the specification asks a server to do.
 */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** A short brief shown by clients that support `instructions`. */
const INSTRUCTIONS =
  "win-agent drives this Windows machine. Read a file before overwriting it; use apply_patch for code; " +
  "run the project's tests when they exist. Destructive actions (delete, move, services, registry, " +
  "shutdown) may be refused when the server was started without mcpServeAutoApprove.";

/** No tool result is allowed to be megabytes: the client has a window too. */
const RESULT_LIMIT = 64_000;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: JsonRpcRequest["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: JsonRpcRequest["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/** Human-readable notes go to stderr: stdout is the protocol. */
function note(text: string): void {
  process.stderr.write(`win-agent mcp: ${text}\n`);
}

export async function runMcpServer(): Promise<void> {
  const settings = getSettings();

  // The same setup the web UI does before a turn, minus the UI.
  configurePowerShell(settings.powershell);
  configurePowerShellDiagnostics(settings.psEnglishErrors);
  configureErrorHints(settings.language);
  configureAudit(settings.auditLog);
  try {
    ensureSkillsFolder();
  } catch {
    /* a read-only data folder is not a reason to fail */
  }
  try {
    if (fs.existsSync(settings.workdir)) process.chdir(settings.workdir);
  } catch {
    /* keep the folder we were started in */
  }

  // Nobody can answer a prompt here: refuse, and say why, unless told otherwise.
  const approve: Approval = async (summary) => {
    if (settings.mcpServeAutoApprove) {
      note(`auto-approved: ${summary}`);
      return true;
    }
    note(`refused (needs approval, and mcpServeAutoApprove is off): ${summary}`);
    return false;
  };

  if (settings.mcpEnabled) await mcp.ensureFresh(settings.mcpRefreshSeconds * 1000);
  const tools = createWindowsTools(approve, {
    dryRun: settings.dryRun,
    enabledTools: settings.enabledTools,
    customTools: settings.customTools,
    webSearchUrl: settings.webSearchUrl,
    agentMode: effectiveAgentMode(settings),
  });

  note(`ready: ${tools.names().length} tools, dry-run ${settings.dryRun ? "on" : "off"}`);

  const handle = async (line: string): Promise<void> => {
    if (!line.trim()) return;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      fail(null, -32700, "invalid JSON");
      return;
    }
    const { id, method, params } = request;
    // A message without an id is a notification: never answered, even on error.
    const isNotification = id === undefined || id === null;

    try {
      switch (method) {
        case "initialize": {
          const asked =
            typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSIONS[0];
          const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
          const skills = listSkills().filter((skill) => !skill.problem);
          reply(id, {
            protocolVersion,
            capabilities: {
              tools: { listChanged: false },
              // Installed skills are exposed as prompts, so an IDE can insert one
              // into a conversation without win-agent running a turn.
              ...(skills.length > 0 ? { prompts: { listChanged: false } } : {}),
            },
            serverInfo: { name: "win-agent", version: VERSION },
            instructions: INSTRUCTIONS,
          });
          return;
        }
        case "notifications/initialized":
        case "notifications/cancelled":
        case "notifications/roots/list_changed":
          return;
        case "ping":
          reply(id, {});
          return;
        case "tools/list":
          reply(id, {
            tools: tools.schemas().map((schema) => ({
              name: schema.function.name,
              description: schema.function.description,
              inputSchema: schema.function.parameters,
            })),
          });
          return;
        case "prompts/list": {
          const skills = listSkills().filter((skill) => !skill.problem);
          reply(id, {
            prompts: skills.map((skill) => ({
              name: skill.name,
              description: skill.description || skill.name,
              // Skills are self-contained instructions, not parameterised prompts.
              arguments: [],
            })),
          });
          return;
        }
        case "prompts/get": {
          const name = typeof params?.name === "string" ? params.name : "";
          if (!name) {
            fail(id, -32602, "prompts/get needs a name");
            return;
          }
          const loaded = loadSkill(name);
          if (typeof loaded === "string") {
            fail(id, -32602, loaded.replace(/^Error:\s*/, ""));
            return;
          }
          const description =
            loaded.skill.description || loaded.skill.when || loaded.skill.name;
          reply(id, {
            description,
            messages: [
              {
                role: "user",
                content: { type: "text", text: loaded.body },
              },
            ],
          });
          return;
        }
        case "tools/call": {
          const name = typeof params?.name === "string" ? params.name : "";
          if (!name) {
            fail(id, -32602, "tools/call needs a name");
            return;
          }
          const args = (params?.arguments ?? {}) as Record<string, unknown>;
          // execute() takes the raw JSON string, exactly as the model would send it.
          const raw = await tools.execute(name, JSON.stringify(args ?? {}));
          const text = capText(raw, RESULT_LIMIT, "characters trimmed; call the tool with a narrower request if you need the middle");
          reply(id, {
            content: [{ type: "text", text }],
            ...(/^Error:/.test(text) ? { isError: true } : {}),
          });
          return;
        }
        default:
          if (!isNotification) fail(id, -32601, `unknown method "${method ?? ""}"`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isNotification) fail(id, -32603, message);
      else note(`notification ${method ?? ""} failed: ${message}`);
    }
  };

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  // One call at a time: tools touch the same machine, and the order matters.
  let chain: Promise<void> = Promise.resolve();
  rl.on("line", (line) => {
    chain = chain.then(() => handle(line)).catch((error) => note(String(error)));
  });
  await new Promise<void>((done) => rl.on("close", () => done()));
  await chain;
  mcp.close();
}
