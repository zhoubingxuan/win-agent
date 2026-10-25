/**
 * Model Context Protocol (MCP) client.
 *
 * MCP is how a local model reaches tools that win-agent does not ship itself:
 * a filesystem server, a git server, a database server, someone's internal API.
 * The agent speaks JSON-RPC 2.0 to each configured server, asks it what it has
 * (tools, resources, prompts), and turns its tools into normal win-agent tools —
 * so the model cannot tell `files` from `mcp__fs__read_file`.
 *
 * Three transports are implemented:
 *
 * - **stdio** — the agent starts the server as a child process and speaks
 *   newline-delimited JSON-RPC over stdin/stdout. This is what `npx -y
 *   @modelcontextprotocol/server-filesystem` speaks.
 * - **http** — "Streamable HTTP": one POST per request, the answer comes back
 *   either as JSON or as a `text/event-stream` body. This is the current remote
 *   transport.
 * - **sse** — the older HTTP+SSE transport (`/sse` + an `endpoint` event). A lot
 *   of deployed servers still speak only this, so it is not a legacy afterthought.
 *
 * Everything is opt-in: the master switch is `mcpEnabled`, each server has its
 * own switch and its own tool rules (`allow`, `ask`, `deny`). A server is trusted
 * to do anything its process can do, so by default an MCP tool asks for approval.
 *
 * Resources and prompts are not turned into one tool per item — a small model
 * does not need forty tools it will never call. They are reachable through the
 * single `mcp_context` tool when at least one connected server offers them.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { VERSION } from "./version.js";
import { getSettings } from "./settings.js";
import { resolveCommand } from "./util/exec.js";
import { killTree } from "./tools/run.js";
import type { Approval, Tool } from "./tools/registry.js";
import { McpAuthRequiredError, oauthConfigured, oauthHeader } from "./mcp-auth.js";
import { resolveSecretRefs } from "./secrets.js";

/** The newest protocol revision this client speaks. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TIMEOUT_MS = 20_000;
export const MCP_RESULT_LIMIT = 64_000;

export type McpTransport = "stdio" | "http" | "sse";
export type McpToolPolicy = "allow" | "ask" | "deny";

/** One configured MCP server. */
export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  /** stdio: the program to run (resolved on PATH when it has no extension). */
  command: string;
  args: string[];
  /** Extra environment variables for the child process. `${VAR}` is expanded. */
  env: Record<string, string>;
  /** stdio: working directory for the child (default: the agent's folder). */
  cwd?: string;
  /** http / sse: the full endpoint URL. */
  url: string;
  /** http / sse: extra request headers, e.g. Authorization. */
  headers?: Record<string, string>;
  enabled: boolean;
  /** Skip the approval prompt for this server's tools (a tool rule overrides it). */
  autoApprove: boolean;
  /** Per-tool override: allow without asking, ask, or do not offer the tool at all. */
  toolPolicies?: Record<string, McpToolPolicy>;
  /** How long one request may take, in milliseconds. */
  timeoutMs?: number;
  /**
   * The user has seen what this server is and allowed it to start. A new server
   * defaults to false, so adding one never runs code or sends a token before an
   * explicit confirmation. Servers saved before 2.5 have no field and stay
   * trusted, so an update does not disable an existing install.
   */
  trusted?: boolean;
  /** Remote servers: OAuth 2.1 discovery, PKCE and refresh. */
  oauth?: McpOAuthConfig;
  /** Tool names this server offered the last time it answered. */
  tools: string[];
}

export interface McpOAuthConfig {
  /** Scopes to request; empty means "whatever discovery suggests". */
  scopes?: string[];
  /** Pre-registered client. Omit to use dynamic client registration. */
  clientId?: string;
  /** Override the authorization server from the protected-resource metadata. */
  authorizationServer?: string;
  /** RFC 8707 resource indicator; defaults to the MCP URL. */
  resource?: string;
  /** Fixed loopback callback port; 0/undefined picks a free port. */
  callbackPort?: number;
}

/** An MCP tool as the server describes it. */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface McpPromptInfo {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
}

export interface McpCapabilities {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
}

export interface McpStatus {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  connected: boolean;
  /** What the server called itself during the handshake, e.g. "mock-mcp 1.0.0". */
  serverInfo: string;
  tools: string[];
  resources: string[];
  prompts: string[];
  capabilities: McpCapabilities;
  /** Handshake + list time of the live connection. */
  latencyMs: number;
  /** Recent stderr / protocol log lines, for the settings panel. */
  stderr: string;
  error: string;
  /** When a failed server will be tried again (ms from now), 0 when healthy. */
  nextRetryMs: number;
}

/* -------------------------------------------------------------------------- */
/* JSON-RPC                                                                   */
/* -------------------------------------------------------------------------- */

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
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

/** Expand `${NAME}`, `${env:NAME}` and `%NAME%` from the agent's environment. */
export function expandEnv(value: string): string {
  return resolveSecretRefs(String(value ?? "")).replace(
    /\$\{env:([^}]+)\}|\$\{([^}]+)\}|%([^%]+)%/g,
    (whole, envName, plainName, percentName) => {
      const name = String(envName ?? plainName ?? percentName ?? "");
      const found = process.env[name];
      return found === undefined ? "" : found;
    },
  );
}

/** The working directory offered to a server that asks for MCP roots. */
function clientRoots(): Array<{ uri: string; name: string }> {
  try {
    const workdir = getSettings().workdir;
    return [{ uri: pathToFileURL(path.resolve(workdir)).href, name: path.basename(workdir) || "workdir" }];
  } catch {
    return [];
  }
}

function clip(text: string, max = MCP_RESULT_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (${text.length - max} characters trimmed)`;
}

/** Keep the last few stderr lines: enough to diagnose, not enough to flood the UI. */
function tail(text: string, max = 2_000): string {
  const value = String(text ?? "").trim();
  return value.length <= max ? value : `...${value.slice(-max)}`;
}

/* -------------------------------------------------------------------------- */
/* stdio                                                                       */
/* -------------------------------------------------------------------------- */

class StdioConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private log = "";
  private closed = false;

  constructor(
    server: McpServer,
    private readonly timeoutMs: number,
    private readonly onNotify: (method: string, params: unknown) => void,
  ) {
    const command = expandEnv(resolveCommand(expandEnv(server.command)));
    const env = { ...process.env };
    for (const [key, value] of Object.entries(server.env ?? {})) env[key] = expandEnv(value);
    const cwd = server.cwd ? expandEnv(server.cwd) : undefined;
    // .cmd / .bat (npx.cmd, uvx.cmd) cannot be spawned directly on Windows.
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
      const line = [quoteForCmd(command), ...(server.args ?? []).map((a) => quoteForCmd(expandEnv(a)))].join(" ");
      this.child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], {
        env,
        cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      this.child = spawn(command, (server.args ?? []).map(expandEnv), {
        env,
        cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: string) => this.appendLog(chunk));
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code) => {
      this.closed = true;
      this.failAll(new Error(`the server exited (code ${code})${this.stderrTail()}`));
    });
  }

  private appendLog(text: string): void {
    this.log = tail(`${this.log}${text}`);
  }

  stderrTail(): string {
    const text = this.log.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" / ");
    return text ? `: ${text}` : "";
  }

  logs(): string {
    return tail(this.log);
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
      // Not JSON-RPC (some servers log to stdout); keep it for the error panel.
      this.appendLog(`${line}\n`);
      return;
    }
    if (message.method !== undefined) {
      if (message.id === undefined || message.id === null) {
        this.onNotify(message.method, message.params ?? {});
        return;
      }
      this.answerServerRequest(message);
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const entry = this.pending.get(Number(message.id));
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(Number(message.id));
    if (message.error) entry.reject(new RpcError(message.error.message ?? "MCP error", message.error.code));
    else entry.resolve(message.result);
  }

  /**
   * Servers may ask the client for roots or a ping. Answer what we support,
   * and answer the rest with an error so the server is not left waiting.
   */
  private answerServerRequest(message: RpcMessage): void {
    let result: unknown;
    let error: { code: number; message: string } | undefined;
    if (message.method === "ping") {
      result = {};
    } else if (message.method === "roots/list") {
      result = { roots: clientRoots() };
    } else {
      error = { code: -32601, message: `win-agent does not implement ${message.method}` };
    }
    const reply = error
      ? { jsonrpc: "2.0", id: message.id ?? null, error }
      : { jsonrpc: "2.0", id: message.id ?? null, result };
    try {
      if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(reply)}\n`);
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
    const message: RpcMessage =
      id === undefined ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
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
    killTree(this.child);
  }
}

/* -------------------------------------------------------------------------- */
/* Streamable HTTP                                                             */
/* -------------------------------------------------------------------------- */

class HttpConnection {
  private session: string | null = null;
  private nextId = 1;
  private lastError = "";

  constructor(
    private readonly server: McpServer,
    private readonly timeoutMs: number,
    private readonly onNotify: (method: string, params: unknown) => void,
  ) {}

  private headers(): Record<string, string> {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    for (const [name, value] of Object.entries(this.server.headers ?? {})) base[name] = expandEnv(value);
    if (this.session) base["Mcp-Session-Id"] = this.session;
    return base;
  }

  async request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const res = await fetch(expandEnv(this.server.url), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.session = session;
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      this.lastError = `HTTP ${res.status} ${res.statusText}: ${body}`;
      throw new Error(`${method} failed: ${this.lastError}`);
    }

    const type = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (!body.trim()) return null;
    const messages = type.includes("text/event-stream") ? parseSse(body) : [safeParse(body)];
    return this.handleMessages(messages, id);
  }

  private async handleMessages(messages: Array<RpcMessage | null>, wantedId: number): Promise<unknown> {
    let last: RpcMessage | null = null;
    for (const message of messages) {
      if (!message) continue;
      if (message.method !== undefined) {
        if (message.id === undefined || message.id === null) {
          this.onNotify(message.method, message.params ?? {});
        } else {
          await this.answerServerRequest(message);
        }
        continue;
      }
      if (Number(message.id) === wantedId) {
        if (message.error) throw new RpcError(message.error.message ?? "MCP error", message.error.code);
        return message.result;
      }
      last = message;
    }
    // Some servers answer a notification-style POST with only notifications and
    // stream the real reply later; take the last result we saw rather than fail.
    return last?.result ?? null;
  }

  private async answerServerRequest(message: RpcMessage): Promise<void> {
    let result: unknown;
    let error: { code: number; message: string } | undefined;
    if (message.method === "ping") result = {};
    else if (message.method === "roots/list") result = { roots: clientRoots() };
    else error = { code: -32601, message: `win-agent does not implement ${message.method}` };
    const body = error
      ? { jsonrpc: "2.0", id: message.id ?? null, error }
      : { jsonrpc: "2.0", id: message.id ?? null, result };
    try {
      await this.post(body);
    } catch {
      // best effort: the server already has its answer or has gone away
    }
  }

  private async post(body: unknown): Promise<string> {
    const res = await fetch(expandEnv(this.server.url), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.session = session;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.text();
  }

  async notification(method: string, params: unknown): Promise<void> {
    try {
      const text = await this.post({ jsonrpc: "2.0", method, params });
      if (text.trim()) {
        const messages = text.includes("data:") ? parseSse(text) : [safeParse(text)];
        for (const message of messages) {
          if (message?.method !== undefined && (message.id === undefined || message.id === null)) {
            this.onNotify(message.method, message.params ?? {});
          }
        }
      }
    } catch (error) {
      this.lastError = (error as Error).message;
      // notifications are best-effort by design
    }
  }

  logs(): string {
    return tail(this.lastError);
  }

  stderrTail(): string {
    return this.lastError ? `: ${this.lastError}` : "";
  }

  close(): void {
    const session = this.session;
    this.session = null;
    if (!session) return;
    // Terminate the session if the server supports it; a failure here is noise.
    try {
      void fetch(expandEnv(this.server.url), {
        method: "DELETE",
        headers: this.headers(),
        signal: AbortSignal.timeout(2000),
      }).catch(() => undefined);
    } catch {
      // already gone
    }
  }
}

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
/* Legacy HTTP+SSE                                                             */
/* -------------------------------------------------------------------------- */

interface SseEvent {
  event: string;
  data: string;
}

/** One parsed SSE event from a live stream. */
function parseSseEvent(block: string): SseEvent | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

class SseConnection {
  private nextId = 1;
  private endpoint: string | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private abort = new AbortController();
  private closed = false;
  private log = "";
  private endpointTimer: NodeJS.Timeout;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    private readonly server: McpServer,
    private readonly timeoutMs: number,
    private readonly onNotify: (method: string, params: unknown) => void,
  ) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.endpointTimer = setTimeout(() => {
      const error = new Error(`no SSE endpoint event within ${Math.round(this.timeoutMs / 1000)}s`);
      this.rejectReady(error);
      this.failAll(error);
    }, Math.min(this.timeoutMs, 20_000));
    void this.stream();
  }

  private appendLog(text: string): void {
    this.log = tail(`${this.log}${text}`);
  }

  private headers(): Record<string, string> {
    const base: Record<string, string> = { Accept: "text/event-stream" };
    for (const [name, value] of Object.entries(this.server.headers ?? {})) base[name] = expandEnv(value);
    return base;
  }

  private async stream(): Promise<void> {
    try {
      const res = await fetch(expandEnv(this.server.url), {
        headers: this.headers(),
        signal: this.abort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error("the server returned no event stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const block = buffer.slice(0, index).replace(/\r/g, "");
          buffer = buffer.slice(index + 2);
          this.onEventBlock(block);
          index = buffer.indexOf("\n\n");
        }
      }
      if (!this.closed) throw new Error("the SSE stream closed");
    } catch (error) {
      if (this.closed) return;
      const message = (error as Error).message || String(error);
      this.appendLog(`${message}\n`);
      this.rejectReady(new Error(`the SSE stream failed: ${message}`));
      this.failAll(new Error(`the SSE stream failed: ${message}`));
    }
  }

  private onEventBlock(block: string): void {
    const event = parseSseEvent(block);
    if (!event) return;
    if (event.event === "endpoint") {
      try {
        this.endpoint = new URL(event.data, expandEnv(this.server.url)).toString();
        clearTimeout(this.endpointTimer);
        this.resolveReady();
      } catch (error) {
        this.rejectReady(new Error(`invalid SSE endpoint "${event.data}": ${(error as Error).message}`));
      }
      return;
    }
    const message = safeParse(event.data);
    if (!message) {
      this.appendLog(`${event.data}\n`);
      return;
    }
    if (message.method !== undefined) {
      if (message.id === undefined || message.id === null) {
        this.onNotify(message.method, message.params ?? {});
      } else {
        void this.answerServerRequest(message);
      }
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const entry = this.pending.get(Number(message.id));
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(Number(message.id));
    if (message.error) entry.reject(new RpcError(message.error.message ?? "MCP error", message.error.code));
    else entry.resolve(message.result);
  }

  private async answerServerRequest(message: RpcMessage): Promise<void> {
    let result: unknown;
    let error: { code: number; message: string } | undefined;
    if (message.method === "ping") result = {};
    else if (message.method === "roots/list") result = { roots: clientRoots() };
    else error = { code: -32601, message: `win-agent does not implement ${message.method}` };
    try {
      await this.post(
        error
          ? { jsonrpc: "2.0", id: message.id ?? null, error }
          : { jsonrpc: "2.0", id: message.id ?? null, result },
      );
    } catch {
      // best effort
    }
  }

  private async post(body: unknown): Promise<Response> {
    if (!this.endpoint) throw new Error("the SSE endpoint is not ready");
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    for (const [name, value] of Object.entries(this.server.headers ?? {})) headers[name] = expandEnv(value);
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res;
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  async request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    await this.ready();
    if (this.closed) throw new Error(this.whyDead());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer to ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.post({ jsonrpc: "2.0", id, method, params })
        .then(async (res) => {
          // A conforming server answers 202 and sends the result on the stream.
          // Some return the JSON directly; accept that too.
          const text = await res.text();
          if (!text.trim()) return;
          const messages = parseSse(text);
          for (const message of messages) {
            if (!message) continue;
            if (message.id !== undefined && message.id !== null && Number(message.id) === id) {
              const entry = this.pending.get(id);
              if (!entry) return;
              clearTimeout(entry.timer);
              this.pending.delete(id);
              if (message.error) entry.reject(new RpcError(message.error.message ?? "MCP error", message.error.code));
              else entry.resolve(message.result);
            } else if (message.method !== undefined && (message.id === undefined || message.id === null)) {
              this.onNotify(message.method, message.params ?? {});
            }
          }
        })
        .catch((error) => {
          const entry = this.pending.get(id);
          if (!entry) return;
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.reject(error as Error);
        });
    });
  }

  async notification(method: string, params: unknown): Promise<void> {
    try {
      const res = await this.post({ jsonrpc: "2.0", method, params });
      await res.text();
    } catch (error) {
      this.appendLog(`${(error as Error).message}\n`);
    }
  }

  private whyDead(): string {
    const text = this.log.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" / ");
    return `the server is not running${text ? `: ${text}` : ""}`;
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  logs(): string {
    return tail(this.log);
  }

  stderrTail(): string {
    const text = this.log.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" / ");
    return text ? `: ${text}` : "";
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.endpointTimer);
    this.failAll(new Error("connection closed"));
    this.abort.abort();
  }
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

type Connection = StdioConnection | HttpConnection | SseConnection;

class McpSession {
  private connection: Connection;
  readonly tools: McpToolInfo[] = [];
  readonly resources: McpResourceInfo[] = [];
  readonly prompts: McpPromptInfo[] = [];
  serverInfo = "";
  protocolVersion = MCP_PROTOCOL_VERSION;
  capabilities: McpCapabilities = { tools: false, resources: false, prompts: false };
  latencyMs = 0;

  constructor(
    private readonly server: McpServer,
    private readonly timeoutMs: number,
    private readonly onNotify: (method: string, params: unknown) => void,
  ) {
    const timeout = server.timeoutMs && server.timeoutMs > 0 ? server.timeoutMs : timeoutMs;
    if (server.transport === "sse") this.connection = new SseConnection(server, timeout, onNotify);
    else if (server.transport === "http") this.connection = new HttpConnection(server, timeout, onNotify);
    else this.connection = new StdioConnection(server, timeout, onNotify);
  }

  private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    return this.connection.request(method, params, timeoutMs);
  }

  async start(): Promise<void> {
    const started = Date.now();
    if (this.connection instanceof StdioConnection || this.connection instanceof SseConnection) {
      await this.connection.ready();
    }
    const init = (await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: "win-agent", version: VERSION },
      },
      Math.min(this.timeoutMs, 15_000),
    )) as {
      serverInfo?: { name?: string; version?: string };
      protocolVersion?: string;
      capabilities?: { tools?: unknown; resources?: unknown; prompts?: unknown };
    } | null;

    await this.connection.notification("notifications/initialized", {});
    this.serverInfo = init?.serverInfo?.name
      ? `${init.serverInfo.name} ${init.serverInfo.version ?? ""}`.trim()
      : "";
    if (typeof init?.protocolVersion === "string" && init.protocolVersion) {
      this.protocolVersion = init.protocolVersion;
    }
    this.capabilities = {
      tools: init?.capabilities?.tools !== undefined,
      resources: init?.capabilities?.resources !== undefined,
      prompts: init?.capabilities?.prompts !== undefined,
    };
    await this.refreshLists();
    this.latencyMs = Date.now() - started;
  }

  /** Re-read everything this server offers, without restarting it. */
  async refreshLists(): Promise<void> {
    this.tools.length = 0;
    this.resources.length = 0;
    this.prompts.length = 0;

    // tools/list is the one list every useful server has. A resources-only
    // server may legitimately answer -32601; that is not a connection failure.
    try {
      const tools = await this.listAll<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>(
        "tools/list",
        "tools",
      );
      for (const tool of tools) {
        if (!tool?.name) continue;
        this.tools.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        });
      }
      this.capabilities.tools = true;
    } catch (error) {
      if (!isMethodNotFound(error)) throw error;
    }

    if (this.capabilities.resources) {
      const resources = await this.listAll<{
        uri?: string;
        name?: string;
        description?: string;
        mimeType?: string;
      }>("resources/list", "resources");
      for (const item of resources) {
        if (!item?.uri) continue;
        this.resources.push({
          uri: item.uri,
          name: item.name ?? item.uri,
          description: item.description ?? "",
          mimeType: item.mimeType ?? "",
        });
      }
    }

    if (this.capabilities.prompts) {
      const prompts = await this.listAll<{
        name?: string;
        description?: string;
        arguments?: Array<{ name?: string; description?: string; required?: boolean }>;
      }>("prompts/list", "prompts");
      for (const item of prompts) {
        if (!item?.name) continue;
        this.prompts.push({
          name: item.name,
          description: item.description ?? "",
          arguments: (item.arguments ?? [])
            .filter((arg) => typeof arg?.name === "string" && arg.name)
            .map((arg) => ({
              name: String(arg.name),
              description: String(arg.description ?? ""),
              required: arg.required === true,
            })),
        });
      }
    }
  }

  /** Follow nextCursor until the server stops handing one out. */
  private async listAll<T>(method: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = (await this.request(method, cursor ? { cursor } : {})) as
        | (Record<string, unknown> & { nextCursor?: string })
        | null;
      const items = result?.[key];
      if (Array.isArray(items)) out.push(...(items as T[]));
      cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{
        type?: string;
        text?: string;
        data?: string;
        mimeType?: string;
        resource?: { uri?: string; text?: string; blob?: string; mimeType?: string };
        uri?: string;
        name?: string;
      }>;
      structuredContent?: unknown;
      isError?: boolean;
    } | null;

    const parts: string[] = [];
    for (const item of result?.content ?? []) {
      if (item?.type === "text" && typeof item.text === "string") parts.push(item.text);
      else if (item?.type === "image") {
        parts.push(`[image ${item.mimeType ?? "?"}, ${item.data ? `${item.data.length} base64 chars` : "no data"}]`);
      } else if (item?.type === "audio") {
        parts.push(`[audio ${item.mimeType ?? "?"}, ${item.data ? `${item.data.length} base64 chars` : "no data"}]`);
      } else if (item?.type === "resource") {
        const resource = item.resource ?? {};
        if (typeof resource.text === "string") {
          parts.push(`[resource ${resource.uri ?? ""}]\n${resource.text}`);
        } else {
          parts.push(
            `[resource ${resource.uri ?? ""} ${resource.mimeType ?? "?"}, ${resource.blob ? `${resource.blob.length} base64 chars` : "no data"}]`,
          );
        }
      } else if (item?.type === "resource_link") {
        parts.push(`[resource link ${item.name ?? ""} ${item.uri ?? ""}]`);
      } else if (item) parts.push(`[${item.type ?? "unknown"} content]`);
    }
    if (result?.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
    const text = parts.join("\n").trim();
    return { text: clip(text || "(the tool returned nothing)"), isError: result?.isError === true };
  }

  async readResource(uri: string): Promise<string> {
    const result = (await this.request("resources/read", { uri })) as {
      contents?: Array<{ uri?: string; mimeType?: string; text?: string; blob?: string }>;
    } | null;
    const parts: string[] = [];
    for (const item of result?.contents ?? []) {
      if (typeof item?.text === "string") parts.push(item.text);
      else if (item?.blob) {
        const mime = item.mimeType ?? "application/octet-stream";
        if (/^text\//i.test(mime) || /json|xml|yaml|javascript|typescript/i.test(mime)) {
          parts.push(Buffer.from(item.blob, "base64").toString("utf8"));
        } else {
          parts.push(`[binary resource ${item.uri ?? uri} (${mime}), ${item.blob.length} base64 chars]`);
        }
      } else {
        parts.push(`[empty resource ${item?.uri ?? uri}]`);
      }
    }
    return clip(parts.join("\n\n") || "(the resource is empty)");
  }

  async getPrompt(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("prompts/get", { name, arguments: args })) as {
      description?: string;
      messages?: Array<{ role?: string; content?: { type?: string; text?: string } | string }>;
    } | null;
    const parts: string[] = [];
    if (result?.description) parts.push(result.description, "");
    for (const message of result?.messages ?? []) {
      const role = message.role ?? "user";
      const content = message.content;
      if (typeof content === "string") parts.push(`${role}: ${content}`);
      else if (content?.type === "text" && typeof content.text === "string") parts.push(`${role}: ${content.text}`);
      else parts.push(`${role}: [${content?.type ?? "unknown"} content]`);
    }
    return clip(parts.join("\n") || "(the prompt is empty)");
  }

  logs(): string {
    return this.connection.logs();
  }

  stderrTail(): string {
    return this.connection.stderrTail();
  }

  close(): void {
    this.connection.close();
  }
}

function isMethodNotFound(error: unknown): boolean {
  return error instanceof RpcError && (error.code === -32601 || /method not found/i.test(error.message));
}

/* -------------------------------------------------------------------------- */
/* Manager                                                                    */
/* -------------------------------------------------------------------------- */

interface Entry {
  server: McpServer;
  tool: McpToolInfo;
  fullName: string;
  policy: McpToolPolicy;
}

interface RetryState {
  failures: number;
  nextAt: number;
  error: string;
  stderr: string;
}

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

/** The rule that decides whether a tool needs approval. */
export function toolPolicyFor(server: McpServer, tool: string): McpToolPolicy {
  const explicit = server.toolPolicies?.[tool];
  if (explicit === "allow" || explicit === "ask" || explicit === "deny") return explicit;
  return server.autoApprove ? "allow" : "ask";
}

/** Why a server cannot be started, or "" when it can. */
export function configurationError(server: McpServer): string {
  if (server.transport === "stdio") {
    if (!String(server.command ?? "").trim()) return "needs a command (stdio)";
    if (server.cwd) {
      try {
        if (!fs.existsSync(server.cwd) || !fs.statSync(server.cwd).isDirectory()) {
          return `cwd does not exist: ${server.cwd}`;
        }
      } catch {
        return `cwd cannot be read: ${server.cwd}`;
      }
    }
    return "";
  }
  if (!String(server.url ?? "").trim()) return `needs a URL (${server.transport})`;
  try {
    const url = new URL(server.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `URL must start with http:// or https://`;
  } catch {
    return `invalid URL: ${server.url}`;
  }
  return "";
}

/** A server is usable only when it has what its transport needs. */
export function isUsable(server: McpServer): boolean {
  return configurationError(server) === "";
}

/**
 * Add the OAuth bearer token at the last moment, on a copy. The configured
 * server (and therefore settings.json and the UI) never contains the token.
 */
async function withOAuth(server: McpServer): Promise<McpServer> {
  if (!oauthConfigured(server)) return server;
  const header = await oauthHeader(server);
  if (!header) return server;
  return { ...server, headers: { ...(server.headers ?? {}), Authorization: header } };
}

/** Does this failure mean "get a fresh OAuth token and try once more"? */
function isAuthProblem(server: McpServer, error: unknown): boolean {
  return (
    error instanceof McpAuthRequiredError ||
    (oauthConfigured(server) && /\b401\b|unauthori[sz]ed|authorization required/i.test((error as Error).message))
  );
}

/**
 * Holds the live connections and the lists they advertise.
 *
 * The lists are refreshed on demand (startup, "Refresh" in the UI, before a
 * turn) and cached in between, because a model turn must never wait for a
 * server that is slow to answer. A server that fails is retried with backoff
 * instead of on every turn.
 */
export class McpManager {
  private sessions = new Map<string, McpSession>();
  private entries: Entry[] = [];
  private statuses = new Map<string, McpStatus>();
  private retry = new Map<string, RetryState>();
  private dirty = new Set<string>();
  private lastRefresh = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly servers: () => McpServer[],
    private readonly timeoutMs = MCP_TIMEOUT_MS,
  ) {}

  /** The unique names the model calls, in the order they are offered. */
  names(): string[] {
    return this.entries.filter((entry) => entry.policy !== "deny").map((entry) => entry.fullName);
  }

  /** The tools found on the last successful refresh, as win-agent tools. */
  tools(approval: Approval, dryRun: boolean): Tool[] {
    return this.entries
      .filter((entry) => entry.policy !== "deny")
      .map(({ server, tool, fullName, policy }) => ({
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
          if (policy === "deny") {
            return `Refused: ${server.name}/${tool.name} is set to "deny" in the MCP tool rules.`;
          }
          // MCP tools can do anything their server can do, so they are approved
          // unless the user made this tool (or the whole server) trusted.
          if (policy !== "allow" && !(await ctx.approve(`call MCP tool ${server.name}/${tool.name}`))) {
            return `Cancelled: the user did not approve calling ${server.name}/${tool.name}.`;
          }
          try {
            const result = await this.callTool(fullName, args);
            // What an MCP server does on the other side is out of our hands, so the
            // audit log keeps at least the call itself: server, tool, arguments.
            ctx.record({
              action: tool.name,
              summary: `called MCP tool ${server.name}/${tool.name} with ${JSON.stringify(args).slice(0, 200)}`,
              paths: [fullName],
            });
            return result.isError ? `Error: ${result.text}` : result.text;
          } catch (error) {
            return `Error: ${(error as Error).message}`;
          }
        },
      }));
  }

  /**
   * One read-only tool for resources and prompts, or null when no server has
   * either. Forty resource-specific tools would cost more than they are worth
   * for a small model; one tool with three actions is cheaper and teachable.
   */
  contextTool(): Tool | null {
    if (!this.hasContext()) return null;
    return {
      schema: {
        type: "function",
        function: {
          name: "mcp_context",
          description:
            "List or read context offered by MCP servers: resources (documents, records, files) and prompts. Use action \"list\" first, then \"read\" with a uri or \"prompt\" with a name.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["list", "read", "prompt"] },
              uri: { type: "string", description: "resource URI, for action=read" },
              name: { type: "string", description: "prompt name, for action=prompt" },
              server: { type: "string", description: "optional server id when two servers share a name" },
              arguments: { type: "object", description: "prompt arguments, for action=prompt" },
            },
            required: ["action"],
          },
        },
      },
      run: async (args, ctx) => {
        const action = String(args.action ?? "");
        if (action === "list") return this.describeContext();
        if (ctx.dryRun) return `DRY RUN: would ${action} MCP context`;
        try {
          if (action === "read") {
            const uri = String(args.uri ?? "").trim();
            if (!uri) return "Error: action=read needs a uri (call action=list to see them)";
            const text = await this.readResource(uri, optional(args.server));
            ctx.record({ action: "read_resource", summary: `read MCP resource ${uri}`, paths: [uri] });
            return text;
          }
          if (action === "prompt") {
            const name = String(args.name ?? "").trim();
            if (!name) return "Error: action=prompt needs a name (call action=list to see them)";
            const text = await this.getPrompt(name, asObject(args.arguments), optional(args.server));
            ctx.record({ action: "get_prompt", summary: `read MCP prompt ${name}`, paths: [name] });
            return text;
          }
          return `Error: unknown action "${action}". Valid values: list, read, prompt`;
        } catch (error) {
          return `Error: ${(error as Error).message}`;
        }
      },
    };
  }

  /** True when a connected server offers resources or prompts. */
  hasContext(): boolean {
    return [...this.sessions.values()].some((s) => s.resources.length > 0 || s.prompts.length > 0);
  }

  /** Current state of every configured server, for the UI and `/mcp`. */
  status(): McpStatus[] {
    const now = Date.now();
    return this.servers().map((server) => {
      const known = this.statuses.get(server.id);
      if (known) {
        const retry = this.retry.get(server.id);
        return { ...known, enabled: server.enabled, nextRetryMs: retry ? Math.max(0, retry.nextAt - now) : 0 };
      }
      return {
        id: server.id,
        name: server.name,
        transport: server.transport,
        enabled: server.enabled,
        connected: false,
        serverInfo: "",
        tools: server.tools,
        resources: [],
        prompts: [],
        capabilities: { tools: false, resources: false, prompts: false },
        latencyMs: 0,
        stderr: "",
        error: server.trusted === false ? "not trusted yet - review the server and press Trust and connect" : "",
        nextRetryMs: 0,
      };
    });
  }

  /** How long ago the lists were refreshed (ms), or -1 when never. */
  age(): number {
    return this.lastRefresh === 0 ? -1 : Date.now() - this.lastRefresh;
  }

  /** Refresh at most once per `ttlMs`; never throws. */
  async ensureFresh(ttlMs = 120_000): Promise<void> {
    if (this.dirty.size > 0) {
      await this.refresh(false);
      return;
    }
    if (this.age() >= 0 && this.age() < ttlMs) return;
    await this.refresh(false);
  }

  /**
   * (Re)connect and rebuild the lists. `reconnect` closes live processes first;
   * without it a live server is only asked to re-list when it said something
   * changed, which is what a `notifications/*​/list_changed` means.
   */
  refresh(reconnect = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh(reconnect).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(reconnect: boolean): Promise<void> {
    const wanted = this.servers().filter((s) => s.enabled && isUsable(s) && s.trusted !== false);
    // Drop connections to servers that were removed or switched off.
    for (const [id, session] of [...this.sessions]) {
      if (!wanted.some((s) => s.id === id) || reconnect) {
        session.close();
        this.sessions.delete(id);
      }
    }

    this.entries = [];
    const statuses = new Map<string, McpStatus>();

    const results = await Promise.all(
      wanted.map(async (server) => {
        const prior = this.sessions.get(server.id);
        if (!prior) {
          const retry = this.retry.get(server.id);
          if (!reconnect && retry && retry.nextAt > Date.now()) {
            return { server, session: null, error: retry.error, stderr: retry.stderr };
          }
        }
        const started = Date.now();
        let session = prior;
        try {
          if (!session) {
            const open = async () => {
              const prepared = await withOAuth(server);
              return new McpSession(prepared, this.timeoutMs, (method) => this.onServerNotification(server.id, method));
            };
            session = await open();
            try {
              await session.start();
            } catch (error) {
              // A token can be revoked before its stated expiry. Refresh once and
              // retry the handshake, then let the normal error path report it.
              if (!isAuthProblem(server, error)) throw error;
              session.close();
              await oauthHeader(server, true);
              session = await open();
              await session.start();
            }
            this.sessions.set(server.id, session);
          } else if (this.dirty.has(server.id)) {
            await session.refreshLists();
          }
          this.retry.delete(server.id);
          return { server, session, error: "", stderr: session.logs() };
        } catch (error) {
          const failed = session ?? this.sessions.get(server.id);
          failed?.close();
          this.sessions.delete(server.id);
          const previous = this.retry.get(server.id);
          const failures = (previous?.failures ?? 0) + 1;
          const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
          const message = (error as Error).message;
          this.retry.set(server.id, {
            failures,
            nextAt: Date.now() + delay,
            error: message,
            stderr: failed?.logs() ?? "",
          });
          return {
            server,
            session: null,
            error: message,
            stderr: failed?.logs() ?? "",
            latencyMs: Date.now() - started,
          };
        }
      }),
    );

    for (const result of results) {
      const { server, session, error } = result;
      if (session) {
        statuses.set(server.id, {
          id: server.id,
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          connected: true,
          serverInfo: session.serverInfo,
          tools: session.tools.map((t) => t.name),
          resources: session.resources.map((r) => r.uri),
          prompts: session.prompts.map((p) => p.name),
          capabilities: session.capabilities,
          latencyMs: session.latencyMs,
          stderr: session.logs(),
          error: "",
          nextRetryMs: 0,
        });
        for (const tool of session.tools) {
          const policy = toolPolicyFor(server, tool.name);
          this.entries.push({
            server,
            tool,
            fullName: "",
            policy,
          });
        }
      } else {
        statuses.set(server.id, {
          id: server.id,
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          connected: false,
          serverInfo: "",
          tools: [],
          resources: [],
          prompts: [],
          capabilities: { tools: false, resources: false, prompts: false },
          latencyMs: 0,
          stderr: result.stderr ?? "",
          error,
          nextRetryMs: this.retry.get(server.id)?.nextAt ? Math.max(0, (this.retry.get(server.id)?.nextAt ?? 0) - Date.now()) : 0,
        });
      }
    }

    // Give every tool a unique name. Two servers whose ids sanitize to the same
    // string (or two long names truncated at 64) would otherwise overwrite each
    // other silently in the registry.
    const used = new Set<string>();
    for (const entry of this.entries) {
      let name = safeName(entry.server.id, entry.tool.name);
      let suffix = 2;
      while (used.has(name)) {
        const tail = `_${suffix++}`;
        name = `${name.slice(0, 64 - tail.length)}${tail}`;
      }
      used.add(name);
      entry.fullName = name;
    }

    this.statuses = statuses;
    this.dirty.clear();
    this.lastRefresh = Date.now();
  }

  private onServerNotification(id: string, method: string): void {
    if (/\/list_changed$/.test(method)) this.dirty.add(id);
  }

  /** Call one MCP tool by its win-agent name, reconnecting once if it died. */
  async call(fullName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    return this.callTool(fullName, args);
  }

  private async callTool(fullName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    let entry = this.entries.find((e) => e.fullName === fullName);
    if (!entry) throw new Error(`unknown MCP tool "${fullName}" - refresh the server list`);
    let session = this.sessions.get(entry.server.id);
    if (!session) {
      await this.reconnect(entry.server.id);
      entry = this.entries.find((e) => e.fullName === fullName);
      if (!entry) throw new Error(`MCP tool "${fullName}" is not offered after reconnecting`);
      session = this.sessions.get(entry.server.id);
    }
    if (!session) throw new Error(`MCP server "${entry.server.name}" is not connected`);
    try {
      return await session.call(entry.tool.name, args);
    } catch (error) {
      if (isAuthProblem(entry.server, error)) {
        // A 401 can mean the token was revoked before its stated expiry. Ask for
        // a refresh explicitly, then reconnect once with the new header.
        await oauthHeader(entry.server, true);
        await this.reconnect(entry.server.id);
        const again = this.entries.find((e) => e.fullName === fullName);
        const live = again ? this.sessions.get(again.server.id) : null;
        if (!again || !live) throw error;
        return live.call(again.tool.name, args);
      }
      if (!looksDisconnected(error)) throw error;
      await this.reconnect(entry.server.id);
      const again = this.entries.find((e) => e.fullName === fullName);
      const live = again ? this.sessions.get(again.server.id) : null;
      if (!again || !live) throw new Error(`MCP server "${entry.server.name}" is not connected after reconnect`);
      return live.call(again.tool.name, args);
    }
  }

  /** Drop one server and try it once, without waiting for the backoff timer. */
  private async reconnect(id: string): Promise<void> {
    this.drop(id);
    this.retry.delete(id);
    await this.refresh(true);
  }

  /** Every resource and prompt, grouped for the UI and `mcp_context`. */
  resources(serverId?: string): Array<McpResourceInfo & { server: string }> {
    return [...this.sessions.entries()]
      .filter(([id]) => !serverId || id === serverId)
      .flatMap(([id, session]) => session.resources.map((resource) => ({ ...resource, server: id })));
  }

  prompts(serverId?: string): Array<McpPromptInfo & { server: string }> {
    return [...this.sessions.entries()]
      .filter(([id]) => !serverId || id === serverId)
      .flatMap(([id, session]) => session.prompts.map((prompt) => ({ ...prompt, server: id })));
  }

  async readResource(uri: string, serverId?: string): Promise<string> {
    const found = this.findContext("resource", uri, serverId);
    return this.withReconnect(found.server, (session) => session.readResource(uri));
  }

  async getPrompt(name: string, args: Record<string, unknown>, serverId?: string): Promise<string> {
    const found = this.findContext("prompt", name, serverId);
    return this.withReconnect(found.server, (session) => session.getPrompt(name, args));
  }

  private findContext(kind: "resource" | "prompt", name: string, serverId?: string): { server: string; session: McpSession } {
    const matches = [...this.sessions.entries()].filter(([id, session]) => {
      if (serverId && id !== serverId) return false;
      return kind === "resource"
        ? session.resources.some((r) => r.uri === name)
        : session.prompts.some((p) => p.name === name);
    });
    if (matches.length === 0) {
      const known =
        kind === "resource"
          ? this.resources(serverId).map((r) => r.uri)
          : this.prompts(serverId).map((p) => p.name);
      throw new Error(
        `no MCP ${kind} "${name}"${serverId ? ` on server "${serverId}"` : ""}. Available: ${known.join(", ") || "(none)"}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(`"${name}" exists on more than one server (${matches.map(([id]) => id).join(", ")}); pass server`);
    }
    const [server, session] = matches[0];
    return { server, session };
  }

  private async withReconnect(
    serverId: string,
    work: (session: McpSession) => Promise<string>,
  ): Promise<string> {
    let session = this.sessions.get(serverId);
    if (!session) throw new Error(`MCP server "${serverId}" is not connected`);
    try {
      return await work(session);
    } catch (error) {
      if (!looksDisconnected(error)) throw error;
      await this.reconnect(serverId);
      session = this.sessions.get(serverId);
      if (!session) throw new Error(`MCP server "${serverId}" is not connected after reconnect`);
      return work(session);
    }
  }

  /** A compact catalogue for `mcp_context action=list`. */
  describeContext(): string {
    const servers = this.status();
    const lines: string[] = ["MCP servers:"];
    for (const server of servers) {
      if (!server.connected) continue;
      lines.push(
        `- ${server.id} (${server.serverInfo || "connected"}): ${server.tools.length} tool(s), ${server.resources.length} resource(s), ${server.prompts.length} prompt(s)`,
      );
    }
    const resources = this.resources();
    lines.push("", `Resources (${resources.length}):`);
    if (resources.length === 0) lines.push("- (none)");
    for (const resource of resources) {
      lines.push(`- ${resource.server}: ${resource.uri}${resource.name && resource.name !== resource.uri ? ` (${resource.name})` : ""}${resource.mimeType ? ` [${resource.mimeType}]` : ""}`);
    }
    const prompts = this.prompts();
    lines.push("", `Prompts (${prompts.length}):`);
    if (prompts.length === 0) lines.push("- (none)");
    for (const prompt of prompts) {
      const args = prompt.arguments.length
        ? ` args: ${prompt.arguments.map((arg) => `${arg.name}${arg.required ? "*" : ""}`).join(", ")}`
        : "";
      lines.push(`- ${prompt.server}: ${prompt.name}${prompt.description ? ` — ${prompt.description}` : ""}${args}`);
    }
    return clip(lines.join("\n"));
  }

  /** Tool names grouped by server, for `/mcp` and the settings panel. */
  summary(): { servers: McpStatus[]; totalTools: number; totalResources: number; totalPrompts: number } {
    const servers = this.status();
    return {
      servers,
      totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0),
      totalResources: servers.reduce((sum, s) => sum + s.resources.length, 0),
      totalPrompts: servers.reduce((sum, s) => sum + s.prompts.length, 0),
    };
  }

  close(): void {
    for (const [, session] of this.sessions) session.close();
    this.sessions.clear();
    this.entries = [];
    this.statuses.clear();
    this.retry.clear();
    this.dirty.clear();
    this.lastRefresh = 0;
  }

  /** Forget one server's connection so the next refresh starts it again. */
  drop(id: string): void {
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
    this.statuses.delete(id);
    this.dirty.delete(id);
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A failure that means the pipe/socket is gone, not that the tool said no. */
function looksDisconnected(error: unknown): boolean {
  return /not running|exited|closed|ECONNREFUSED|ECONNRESET|EPIPE|fetch failed|SSE stream failed|socket hang up|not connected/i.test(
    (error as Error)?.message ?? "",
  );
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
/* One-off test + import                                                      */
/* -------------------------------------------------------------------------- */

export interface McpTestResult {
  ok: boolean;
  serverInfo: string;
  protocolVersion: string;
  tools: string[];
  resources: string[];
  prompts: string[];
  capabilities: McpCapabilities;
  latencyMs: number;
  error: string;
  stderr: string;
}

/** Start a server once, read its lists, and stop it. Does not touch the live manager. */
export async function testMcpServer(server: McpServer, timeoutMs = MCP_TIMEOUT_MS): Promise<McpTestResult> {
  const started = Date.now();
  let session = new McpSession(server, timeoutMs, () => undefined);
  try {
    session = new McpSession(await withOAuth(server), timeoutMs, () => undefined);
    await session.start();
    return {
      ok: true,
      serverInfo: session.serverInfo,
      protocolVersion: session.protocolVersion,
      tools: session.tools.map((t) => t.name),
      resources: session.resources.map((r) => r.uri),
      prompts: session.prompts.map((p) => p.name),
      capabilities: session.capabilities,
      latencyMs: Date.now() - started,
      error: "",
      stderr: session.logs(),
    };
  } catch (error) {
    return {
      ok: false,
      serverInfo: session.serverInfo,
      protocolVersion: session.protocolVersion,
      tools: [],
      resources: [],
      prompts: [],
      capabilities: session.capabilities,
      latencyMs: Date.now() - started,
      error: (error as Error).message,
      stderr: session.logs(),
    };
  } finally {
    session.close();
  }
}

export interface McpImportResult {
  servers: McpServer[];
  added: number;
  updated: number;
  skipped: string[];
}

/**
 * Read a Claude Desktop / Cursor / VS Code `mcpServers` block, or a plain map
 * of name -> server. This is the difference between "edit settings.json by
 * hand" and "paste the block you already have".
 */
export function parseMcpConfig(raw: unknown, existing: McpServer[] = []): McpImportResult {
  let doc: unknown = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch (error) {
      throw new Error(`the pasted JSON is not valid: ${(error as Error).message}`);
    }
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error('expected an object such as {"mcpServers": {"name": {"command": "..."}}}');
  }
  const root = doc as Record<string, unknown>;
  const map = (root.mcpServers ?? root.servers ?? root) as Record<string, unknown>;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("mcpServers must be an object of name -> server");
  }

  const servers: McpServer[] = existing.map((server) => ({
    ...server,
    args: [...server.args],
    env: { ...server.env },
    headers: { ...(server.headers ?? {}) },
    toolPolicies: { ...(server.toolPolicies ?? {}) },
    tools: [...server.tools],
  }));
  const skipped: string[] = [];
  let added = 0;
  let updated = 0;
  const used = new Set(servers.map((s) => s.id));

  for (const [rawName, value] of Object.entries(map)) {
    if (rawName === "mcpServers" || rawName === "servers") continue;
    const item = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : typeof value === "string"
        ? { command: value }
        : null;
    if (!item) {
      skipped.push(`${rawName}: not an object`);
      continue;
    }
    let id = sanitizeId(String(item.id ?? rawName));
    if (!id) {
      skipped.push(`${rawName}: no usable id`);
      continue;
    }
    // An id that is already configured is an update, not a collision. Only a
    // second entry in the same import (or a genuinely new id that happens to
    // collide) gets a suffix.
    const prior = existing.find((s) => s.id === id);
    if (!prior && used.has(id)) {
      let suffix = 2;
      const base = id;
      while (used.has(`${base}_${suffix}`)) suffix++;
      id = `${base}_${suffix}`.slice(0, 32);
    }
    const urlProvided = item.url !== undefined || item.serverUrl !== undefined;
    const url = urlProvided ? String(item.url ?? item.serverUrl ?? "") : (prior?.url ?? "");
    const commandValue = item.command;
    const commandParts = Array.isArray(commandValue)
      ? commandValue.map(String)
      : typeof commandValue === "string"
        ? splitCommandLine(commandValue)
        : [];
    // Claude Desktop and Cursor keep the program and its arguments in separate
    // fields; a shell-style `command` string is also accepted.
    const rawArgs = item.args;
    const argParts = Array.isArray(rawArgs)
      ? rawArgs.map(String)
      : typeof rawArgs === "string"
        ? splitCommandLine(rawArgs)
        : [];
    const commandProvided = commandValue !== undefined || rawArgs !== undefined;
    const command = commandProvided ? (commandParts[0] ?? "") : (prior?.command ?? "");
    const args = commandProvided ? [...commandParts.slice(1), ...argParts] : (prior?.args ?? []);
    const declared = String(item.transport ?? item.type ?? "").toLowerCase();
    const transport: McpTransport = declared === "sse"
      ? "sse"
      : declared === "http" || declared === "streamable-http"
        ? "http"
        : declared === "stdio"
          ? "stdio"
          : commandProvided
            ? "stdio"
            : url
              ? /\/sse\/?$/i.test(url)
                ? "sse"
                : "http"
              : (prior?.transport ?? "stdio");
    const changedEndpoint =
      !prior ||
      url !== prior.url ||
      command !== prior.command ||
      JSON.stringify(args) !== JSON.stringify(prior.args);
    // Arguments can change on the same program, and that should not discard the
    // environment it needs. Moving to another URL or program does.
    const sameTarget = Boolean(prior) && url === prior?.url && command === prior?.command;
    const envBase = sameTarget ? (prior?.env ?? {}) : {};
    const env: Record<string, string> = {};
    for (const [name, rawValue] of Object.entries({
      ...envBase,
      ...(item.env !== undefined ? asObject(item.env) : {}),
    })) {
      if (name) env[String(name)] = String(rawValue);
    }
    const headerBase = sameTarget ? (prior?.headers ?? {}) : {};
    const headers: Record<string, string> = {};
    for (const [name, rawValue] of Object.entries({
      ...headerBase,
      ...(item.headers !== undefined ? asObject(item.headers) : {}),
    })) {
      if (name) headers[String(name)] = String(rawValue);
    }
    const policies: Record<string, McpToolPolicy> = {};
    for (const [name, rawValue] of Object.entries(asObject(item.toolPolicies))) {
      if (rawValue === "allow" || rawValue === "ask" || rawValue === "deny") policies[name] = rawValue;
    }
    const timeout = Number(item.timeoutMs);
    const next: McpServer = {
      id,
      name: String(item.name ?? prior?.name ?? rawName),
      transport,
      command,
      args,
      env,
      cwd: String(item.cwd ?? prior?.cwd ?? ""),
      url,
      headers,
      enabled: item.enabled !== undefined ? item.enabled !== false : (prior?.enabled ?? true),
      autoApprove: item.autoApprove !== undefined ? item.autoApprove === true : (prior?.autoApprove ?? false),
      toolPolicies: Object.keys(policies).length > 0 ? policies : (prior?.toolPolicies ?? {}),
      // Imported servers are new code, so they wait for the same explicit trust
      // as one added by hand. Re-importing an existing *unchanged* server keeps
      // its answer; a changed command or URL is a new endpoint and asks again.
      trusted: prior && !changedEndpoint ? prior.trusted !== false : false,
      ...(prior?.oauth ? { oauth: prior.oauth } : {}),
      timeoutMs:
        Number.isFinite(timeout) && timeout > 0
          ? Math.min(600_000, Math.max(1_000, Math.round(timeout)))
          : (prior?.timeoutMs ?? 20_000),
      tools: prior?.tools ?? [],
    };
    const at = servers.findIndex((s) => s.id === id);
    if (at >= 0) {
      servers[at] = next;
      updated++;
    } else {
      servers.push(next);
      added++;
    }
    used.add(id);
  }

  return { servers, added, updated, skipped };
}

function sanitizeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return /^[a-zA-Z0-9_-]{1,32}$/.test(cleaned) ? cleaned : "";
}

/** Split a command line into program + arguments, honouring quotes. */
function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
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

/** Add or replace a server in a settings list (used by the API and `/mcp add`). */
export function upsertServer(list: McpServer[], next: McpServer): McpServer[] {
  const out: McpServer[] = list.map((s) => ({
    ...s,
    args: [...s.args],
    env: { ...s.env },
    headers: { ...(s.headers ?? {}) },
    toolPolicies: { ...(s.toolPolicies ?? {}) },
  }));
  const index = out.findIndex((s) => s.id === next.id);
  if (index >= 0) out[index] = next;
  else out.push(next);
  return out;
}

export const MCP_SERVER_ID = /^[a-zA-Z0-9_-]{1,32}$/;
