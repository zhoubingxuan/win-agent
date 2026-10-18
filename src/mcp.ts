/**
 * Model Context Protocol (MCP) client.
 *
 * MCP is how a local model reaches tools that win-agent does not ship itself:
 * a filesystem server, a git server, a database server, someone's internal API.
 * The agent speaks JSON-RPC 2.0 to each configured server, asks it for its tool
 * list, and turns every tool it offers into a normal win-agent tool — so the
 * model cannot tell the difference between `files` and `mcp__fs__read_file`.
 *
 * Two transports are implemented, both from the specification:
 *
 * - **stdio** — the agent starts the server as a child process and speaks
 *   newline-delimited JSON-RPC over its stdin/stdout. This is what `npx -y
 *   @modelcontextprotocol/server-filesystem` and friends speak.
 * - **http** — "Streamable HTTP": one POST per request, the answer comes back
 *   either as JSON or as an `text/event-stream` body. Works with remote servers
 *   and with local ones that expose a URL (`mcp-proxy`, `mcpo`, ...).
 *
 * Everything is opt-in: the master switch is `mcpEnabled`, each server has its
 * own switch, and an MCP tool asks for approval unless its server says
 * otherwise (`autoApprove`), because MCP tools can do anything the server can.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { VERSION } from "./version.js";
import { getSettings } from "./settings.js";
import { resolveCommand } from "./util/exec.js";
import type { Approval, Tool } from "./tools/registry.js";

/** One configured MCP server. */
export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  /** stdio: the program to run (resolved on PATH when it has no extension). */
  command: string;
  args: string[];
  /** Extra environment variables for the child process. */
  env: Record<string, string>;
  /** http: the full endpoint URL. */
  url: string;
  enabled: boolean;
  /** Skip the approval prompt for this server's tools. */
  autoApprove: boolean;
  /** Tool names this server offered the last time it answered. */
  tools: string[];
}

/** An MCP tool as the server describes it. */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpStatus {
  id: string;
  name: string;
  enabled: boolean;
  connected: boolean;
  /** What the server called itself during the handshake, e.g. "mock-mcp 1.0.0". */
  serverInfo: string;
  tools: string[];
  error: string;
}

/* -------------------------------------------------------------------------- */
/* JSON-RPC over stdio                                                        */
/* -------------------------------------------------------------------------- */

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** How MCP tools are named in the tool list: `mcp__<server>__<tool>`. */
const TOOL_PREFIX = "mcp__";

/** OpenAI-compatible endpoints only accept [A-Za-z0-9_-], max 64 characters. */
export function safeName(server: string, tool: string): string {
  return `${TOOL_PREFIX}${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Find the real file for a command. `npx` is `npx.cmd` on Windows, and
 * `spawn("npx")` without a shell cannot see through PATHEXT.
 * Re-exported so callers (and tests) keep importing it from here.
 */
export { resolveCommand };

/** Quote one argument for `cmd.exe /c` (only used for .cmd/.bat servers). */
function quoteForCmd(value: string): string {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

class StdioConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private stderr = "";
  private closed = false;

  constructor(server: McpServer, private readonly timeoutMs: number) {
    const command = resolveCommand(server.command);
    const env = { ...process.env, ...server.env };
    // .cmd / .bat (npx.cmd, uvx.cmd) cannot be spawned directly on Windows.
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
      const line = [quoteForCmd(command), ...server.args.map(quoteForCmd)].join(" ");
      this.child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], {
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      this.child = spawn(command, server.args, {
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-2_000);
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code) => {
      this.closed = true;
      this.failAll(new Error(`the server exited (code ${code})${this.stderrTail()}`));
    });
  }

  private stderrTail(): string {
    const text = this.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" / ");
    return text ? `: ${text}` : "";
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return; // not JSON-RPC (some servers log to stdout); ignore
    }
    // A notification (no id): nothing to answer, nothing to wait for.
    if (message.id === undefined || message.id === null) return;
    const entry = this.pending.get(Number(message.id));
    if (!entry) {
      // A request *from* the server (sampling, roots, elicitation). We do not
      // implement those, but it must not be left waiting for an answer.
      if (typeof message.method === "string") this.respondUnsupported(message);
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(Number(message.id));
    if (message.error) entry.reject(new Error(message.error.message ?? "MCP error"));
    else entry.resolve(message.result);
  }

  private respondUnsupported(message: RpcMessage): void {
    if (!this.child.stdin.writable) return;
    const reply = {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32601, message: `win-agent does not implement ${message.method}` },
    };
    try {
      this.child.stdin.write(`${JSON.stringify(reply)}\n`);
    } catch {
      // the pipe is gone; nothing to answer
    }
  }

  request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error(this.whyDead()));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer to ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.notify(method, params, id);
    });
  }

  /** Send a request or a notification (no id when `id` is omitted). */
  private notify(method: string, params: unknown, id?: number): void {
    const message: RpcMessage = id === undefined ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      if (id !== undefined) {
        const entry = this.pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.reject(error as Error);
        }
      }
    }
  }

  notification(method: string, params: unknown): void {
    this.notify(method, params);
  }

  /** Wait until the child has actually started; fail fast when it cannot. */
  async ready(): Promise<void> {
    if (this.closed) throw new Error(this.whyDead());
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 2000);
      const done = (): void => clearTimeout(timer);
      this.child.once("spawn", () => {
        done();
        resolve();
      });
      this.child.once("error", (error) => {
        done();
        reject(new Error(`could not start: ${error.message}`));
      });
      this.child.once("exit", (code) => {
        done();
        reject(new Error(`the server exited immediately (code ${code})${this.stderrTail()}`));
      });
    });
  }

  private whyDead(): string {
    return `the server is not running${this.stderrTail()}`;
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error("connection closed"));
    try {
      this.child.kill();
    } catch {
      // already gone
    }
  }
}

/* -------------------------------------------------------------------------- */
/* JSON-RPC over Streamable HTTP                                              */
/* -------------------------------------------------------------------------- */

class HttpConnection {
  private session: string | null = null;
  private nextId = 1;

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  private headers(): Record<string, string> {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (this.session) base["Mcp-Session-Id"] = this.session;
    return base;
  }

  async request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.session = session;
    if (!res.ok) throw new Error(`${method} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

    const type = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (!body.trim()) return null;
    const messages = type.includes("text/event-stream") ? parseSse(body) : [safeParse(body)];
    for (const message of messages) {
      if (!message) continue;
      if (message.error) throw new Error(message.error.message ?? "MCP error");
      if (Number(message.id) === id) return message.result;
    }
    // Some servers answer the notification-style POST and stream the reply later;
    // take the last result we saw rather than failing outright.
    const last = messages.filter(Boolean).pop();
    return last?.result ?? null;
  }

  async notification(method: string, params: unknown): Promise<void> {
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const session = res.headers.get("mcp-session-id");
      if (session) this.session = session;
      await res.text();
    } catch {
      // notifications are best-effort by design
    }
  }

  close(): void {
    this.session = null;
  }
}

const MCP_PROTOCOL_VERSION = "2025-06-18";

function safeParse(text: string): RpcMessage | null {
  try {
    return JSON.parse(text) as RpcMessage;
  } catch {
    return null;
  }
}

/** Parse an SSE body into the JSON-RPC messages it carries. */
function parseSse(body: string): Array<RpcMessage | null> {
  const out: Array<RpcMessage | null> = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (data) out.push(safeParse(data));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Connection + tool cache                                                    */
/* -------------------------------------------------------------------------- */

type Connection = StdioConnection | HttpConnection;

class McpSession {
  private connection: Connection;
  readonly tools: McpToolInfo[] = [];
  error = "";

  constructor(private readonly server: McpServer, private readonly timeoutMs: number) {
    this.connection =
      server.transport === "http"
        ? new HttpConnection(server.url, timeoutMs)
        : new StdioConnection(server, timeoutMs);
  }

  async start(): Promise<void> {
    if (this.connection instanceof StdioConnection) await this.connection.ready();
    const init = (await this.connection.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "win-agent", version: VERSION },
      },
      Math.min(this.timeoutMs, 15_000),
    )) as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string } | null;

    await this.connection.notification("notifications/initialized", {});
    this.serverInfo = init?.serverInfo?.name ? `${init.serverInfo.name} ${init.serverInfo.version ?? ""}`.trim() : "";

    // tools/list is paginated; keep asking while the server hands back a cursor.
    let cursor: string | undefined;
    do {
      const page = (await this.connection.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
        nextCursor?: string;
      } | null;
      for (const tool of page?.tools ?? []) {
        if (!tool?.name) continue;
        this.tools.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        });
      }
      cursor = page?.nextCursor;
    } while (cursor);
  }

  serverInfo = "";

  async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = (await this.connection.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string; resource?: unknown }>;
      structuredContent?: unknown;
      isError?: boolean;
    } | null;

    const parts: string[] = [];
    for (const item of result?.content ?? []) {
      if (item?.type === "text" && typeof item.text === "string") parts.push(item.text);
      else if (item?.type === "image") parts.push(`[image ${item.mimeType ?? "?"}, ${item.data ? `${item.data.length} base64 chars` : "no data"}]`);
      else if (item?.type === "resource") parts.push(`[resource ${JSON.stringify(item.resource ?? {}).slice(0, 200)}]`);
      else if (item) parts.push(`[${item.type ?? "unknown"} content]`);
    }
    if (result?.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
    const text = parts.join("\n").trim();
    return { text: text || "(the tool returned nothing)", isError: result?.isError === true };
  }

  close(): void {
    this.connection.close();
  }
}

/**
 * Holds the live connections and the tool list they advertise.
 *
 * The tool set is refreshed on demand (startup, "Refresh" in the UI, before a
 * turn) and cached in between, because a model turn must never wait for a
 * server that is slow to answer.
 */
export class McpManager {
  private sessions = new Map<string, McpSession>();
  private entries: Array<{ server: McpServer; tool: McpToolInfo; fullName: string }> = [];
  private statuses: McpStatus[] = [];
  private lastRefresh = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly servers: () => McpServer[],
    private readonly timeoutMs = 20_000,
  ) {}

  /** The tools found on the last successful refresh, as win-agent tools. */
  tools(approval: Approval, dryRun: boolean): Tool[] {
    return this.entries.map(({ server, tool, fullName }) => ({
      schema: {
        type: "function" as const,
        function: {
          name: fullName,
          description: `${tool.description || tool.name} (MCP server "${server.name}")`,
          parameters: normalizeSchema(tool.inputSchema),
        },
      },
      run: async (args: Record<string, unknown>, ctx): Promise<string> => {
        if (ctx.dryRun || dryRun) {
          return `DRY RUN: would call ${server.name}/${tool.name} with ${JSON.stringify(args)}`;
        }
        // MCP tools can do anything their server can do, so they are approved
        // unless the server was marked as trusted.
        if (!server.autoApprove && !(await ctx.approve(`call MCP tool ${server.name}/${tool.name}`))) {
          return `Cancelled: the user did not approve calling ${server.name}/${tool.name}.`;
        }
        try {
          const result = await this.call(fullName, args);
          return result.isError ? `Error: ${result.text}` : result.text;
        } catch (error) {
          return `Error: ${(error as Error).message}`;
        }
      },
    }));
  }

  /** Current state of every configured server, for the UI and `/mcp`. */
  status(): McpStatus[] {
    const configured = this.servers();
    return configured.map((server) => {
      const known = this.statuses.find((s) => s.id === server.id);
      const session = this.sessions.get(server.id);
      return (
        known ?? {
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          connected: Boolean(session),
          serverInfo: session?.serverInfo ?? "",
          tools: server.tools,
          error: "",
        }
      );
    });
  }

  /** How long ago the tool list was refreshed (ms), or -1 when never. */
  age(): number {
    return this.lastRefresh === 0 ? -1 : Date.now() - this.lastRefresh;
  }

  /** Refresh at most once per `ttlMs`; never throws. */
  async ensureFresh(ttlMs = 120_000): Promise<void> {
    if (this.age() >= 0 && this.age() < ttlMs) return;
    await this.refresh();
  }

  /** (Re)connect to every enabled server and rebuild the tool list. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    const wanted = this.servers().filter((s) => s.enabled && isUsable(s));
    // Drop connections to servers that were removed or switched off.
    for (const [id, session] of [...this.sessions]) {
      if (!wanted.some((s) => s.id === id)) {
        session.close();
        this.sessions.delete(id);
      }
    }

    this.entries = [];
    const statuses: McpStatus[] = [];

    const results = await Promise.all(
      wanted.map(async (server) => {
        try {
          let session = this.sessions.get(server.id);
          if (!session) {
            session = new McpSession(server, this.timeoutMs);
            await session.start();
            this.sessions.set(server.id, session);
          }
          return { server, session, error: "" };
        } catch (error) {
          const failed = this.sessions.get(server.id);
          failed?.close();
          this.sessions.delete(server.id);
          return { server, session: null, error: (error as Error).message };
        }
      }),
    );

    for (const { server, session, error } of results) {
      if (session) {
        for (const tool of session.tools) {
          this.entries.push({ server, tool, fullName: safeName(server.id, tool.name) });
        }
        statuses.push({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          connected: true,
          serverInfo: session.serverInfo,
          tools: session.tools.map((t) => t.name),
          error: "",
        });
      } else {
        statuses.push({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          connected: false,
          serverInfo: "",
          tools: [],
          error,
        });
      }
    }

    for (const server of this.servers().filter((s) => !s.enabled || !isUsable(s))) {
      statuses.push({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        connected: false,
        serverInfo: "",
        tools: [],
        error: server.enabled ? "incomplete configuration: needs a command (stdio) or a URL (http)" : "",
      });
    }

    this.statuses = statuses;
    this.lastRefresh = Date.now();
  }

  /** Call one MCP tool by its win-agent name. */
  async call(fullName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const entry = this.entries.find((e) => e.fullName === fullName);
    if (!entry) throw new Error(`unknown MCP tool "${fullName}" - refresh the server list`);
    const session = this.sessions.get(entry.server.id);
    if (!session) throw new Error(`MCP server "${entry.server.name}" is not connected`);
    return session.call(entry.tool.name, args);
  }

  /** Tool names grouped by server, for `/mcp` and the settings panel. */
  summary(): { servers: McpStatus[]; totalTools: number } {
    const servers = this.status();
    return { servers, totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0) };
  }

  close(): void {
    for (const [, session] of this.sessions) session.close();
    this.sessions.clear();
    this.entries = [];
    this.statuses = [];
    this.lastRefresh = 0;
  }

  /** Forget one server's connection so the next refresh starts it again. */
  drop(id: string): void {
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
  }
}

/** A server is usable only when it has what its transport needs. */
export function isUsable(server: McpServer): boolean {
  return server.transport === "http" ? Boolean(server.url) : Boolean(server.command);
}

/** MCP input schemas are JSON Schema; make sure the model gets an object. */
function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || !schema.type) {
    return { type: "object", properties: {}, ...(schema ?? {}) };
  }
  if (schema.type !== "object") {
    // Some servers describe a single value; wrap it so tool calling still works.
    return { type: "object", properties: { value: schema }, required: ["value"] };
  }
  return schema;
}

/* -------------------------------------------------------------------------- */
/* The manager used by the agent                                              */
/* -------------------------------------------------------------------------- */

/**
 * The one manager the agent talks to. It reads its server list from the
 * settings on every use, so adding a server in the UI takes effect immediately.
 */
export const mcp = new McpManager(() => {
  const s = getSettings();
  if (!s.mcpEnabled) return [];
  return s.mcpServers;
});

export const MCP_TIMEOUT_MS = 20_000;

/** Add or replace a server in a settings list (used by the API and `/mcp add`). */
export function upsertServer(list: McpServer[], next: McpServer): McpServer[] {
  const out = list.map((s) => ({ ...s, args: [...s.args], env: { ...s.env }, tools: [...s.tools] }));
  const index = out.findIndex((s) => s.id === next.id);
  if (index >= 0) out[index] = next;
  else out.push(next);
  return out;
}

export const MCP_SERVER_ID = /^[a-zA-Z0-9_-]{1,32}$/;
