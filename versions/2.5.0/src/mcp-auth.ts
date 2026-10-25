/**
 * OAuth 2.1 for remote MCP servers.
 *
 * The MCP authorization spec uses ordinary OAuth, with two twists that matter
 * here: the MCP URL is the *resource* (RFC 8707), not the authorization server,
 * and the client is usually registered dynamically on first connect.
 *
 * Flow:
 *   MCP URL -> /.well-known/oauth-protected-resource -> authorization server
 *           -> /.well-known/oauth-authorization-server -> registration endpoint
 *           -> browser + PKCE S256 -> loopback callback -> token endpoint
 *
 * Tokens and dynamically registered client credentials are encrypted with
 * DPAPI in `data/secrets.json` (see src/secrets.ts). They never enter
 * settings.json, the chat log, the audit log or an MCP server's stderr buffer.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer } from "./mcp.js";
import { deleteSecret, getSecretJson, setSecretJson } from "./secrets.js";

const AUTH_TIMEOUT_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 20_000;
const MAX_METADATA_BYTES = 512 * 1024;

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt?: number;
  clientId: string;
  clientSecret?: string;
  /** How the token endpoint wants the client secret (if there is one). */
  tokenEndpointAuthMethod?: string;
  tokenEndpoint: string;
  authorizationServer: string;
  resource: string;
}

interface ClientRegistration {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: string;
  /** Where the registration was created; a different issuer needs a new one. */
  authorizationServer?: string;
  /** The loopback callback the registration was created for. */
  redirectUri?: string;
}

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

export interface OAuthStatus {
  configured: boolean;
  authorized: boolean;
  expiresAt: string | null;
  authorizationServer: string;
  tokenEndpoint: string;
  error: string;
}

export class McpAuthRequiredError extends Error {
  constructor(
    message: string,
    readonly serverId: string,
    readonly authorizationServer = "",
  ) {
    super(message);
    this.name = "McpAuthRequiredError";
  }
}

function tokenSecret(server: McpServer): string {
  return `mcp.${server.id}.oauth`;
}

function clientSecretName(server: McpServer): string {
  return `mcp.${server.id}.client`;
}

export function oauthConfigured(server: McpServer): boolean {
  return server.transport !== "stdio" && Boolean(server.oauth);
}

/** Is this stored token still for this server's resource and configured client? */
function tokenMatches(server: McpServer, token: OAuthTokenSet | null): boolean {
  if (!token) return false;
  const expectedResource = server.oauth?.resource || server.url;
  let sameResource: boolean;
  try {
    sameResource = new URL(token.resource).href === new URL(expectedResource).href;
  } catch {
    sameResource = token.resource === expectedResource;
  }
  const configuredClient = server.oauth?.clientId?.trim() ?? "";
  const sameClient = !configuredClient || token.clientId === configuredClient;
  return sameResource && sameClient;
}

export function oauthStatusFor(server: McpServer): OAuthStatus {
  if (!oauthConfigured(server)) {
    return {
      configured: false,
      authorized: false,
      expiresAt: null,
      authorizationServer: "",
      tokenEndpoint: "",
      error: "",
    };
  }
  const token = getSecretJson<OAuthTokenSet>(tokenSecret(server));
  return {
    configured: true,
    authorized: Boolean(token?.accessToken || token?.refreshToken) && tokenMatches(server, token),
    expiresAt: token?.expiresAt ? new Date(token.expiresAt).toISOString() : null,
    authorizationServer: token?.authorizationServer ?? server.oauth?.authorizationServer ?? "",
    tokenEndpoint: token?.tokenEndpoint ?? "",
    error: "",
  };
}

export function clearOAuth(server: McpServer): boolean {
  const removedToken = deleteSecret(tokenSecret(server));
  const removedClient = deleteSecret(clientSecretName(server));
  return removedToken || removedClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function safeUrl(value: unknown, label: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${label} is missing`);
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${label} must be http(s)`);
  return url.href;
}

async function readJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: "follow",
  });
  const text = (await res.text()).slice(0, MAX_METADATA_BYTES);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${text.slice(0, 200)}`);
  try {
    return asRecord(JSON.parse(text));
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
}

function metadataUrls(resource: string, suffix: string): string[] {
  const url = new URL(resource);
  const root = `${url.protocol}//${url.host}`;
  const pathname = url.pathname.replace(/\/+$/, "");
  const urls = [`${root}/.well-known/${suffix}${pathname}`, `${root}/.well-known/${suffix}`];
  if (pathname && pathname !== "/") urls.push(`${root}${pathname}/.well-known/${suffix}`);
  return [...new Set(urls)];
}

async function discoverFirst<T>(
  urls: string[],
  accept: (value: Record<string, unknown>) => T | null,
): Promise<{ value: T; url: string }> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const body = await readJson(url);
      const value = accept(body);
      if (value) return { value, url };
      failures.push(`${url}: unexpected metadata`);
    } catch (error) {
      failures.push(`${url}: ${(error as Error).message}`);
    }
  }
  throw new Error(`OAuth discovery failed. ${failures.slice(0, 4).join(" | ")}`);
}

async function protectedResource(resource: string): Promise<{ metadata: ProtectedResourceMetadata; url: string }> {
  const found = await discoverFirst(metadataUrls(resource, "oauth-protected-resource"), (body) => {
    const servers = asStringArray(body.authorization_servers);
    if (servers.length === 0) return null;
    return {
      resource: typeof body.resource === "string" ? body.resource : undefined,
      authorization_servers: servers,
      scopes_supported: asStringArray(body.scopes_supported),
    } satisfies ProtectedResourceMetadata;
  });
  return { metadata: found.value, url: found.url };
}

async function authorizationServer(issuer: string): Promise<AuthServerMetadata> {
  const found = await discoverFirst(metadataUrls(issuer, "oauth-authorization-server").concat(metadataUrls(issuer, "openid-configuration")), (body) => {
    if (typeof body.authorization_endpoint !== "string" || typeof body.token_endpoint !== "string") return null;
    return {
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
      authorization_endpoint: safeUrl(body.authorization_endpoint, "authorization_endpoint"),
      token_endpoint: safeUrl(body.token_endpoint, "token_endpoint"),
      registration_endpoint: typeof body.registration_endpoint === "string" ? safeUrl(body.registration_endpoint, "registration_endpoint") : undefined,
      scopes_supported: asStringArray(body.scopes_supported),
      code_challenge_methods_supported: asStringArray(body.code_challenge_methods_supported),
      token_endpoint_auth_methods_supported: asStringArray(body.token_endpoint_auth_methods_supported),
    } satisfies AuthServerMetadata;
  });
  return found.value;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function registerClient(
  server: McpServer,
  metadata: AuthServerMetadata,
  redirectUri: string,
  scopes: string[],
): Promise<ClientRegistration> {
  if (server.oauth?.clientId) {
    return { clientId: server.oauth.clientId, tokenEndpointAuthMethod: "none" };
  }
  const issuer = metadata.issuer ?? metadata.authorization_endpoint;
  const stored = getSecretJson<ClientRegistration>(clientSecretName(server));
  if (stored?.clientId && stored.authorizationServer === issuer && stored.redirectUri === redirectUri) {
    return stored;
  }
  if (!metadata.registration_endpoint) {
    throw new Error(
      "this authorization server does not support dynamic client registration; set oauth.clientId in the server settings",
    );
  }
  const body = await readJson(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "win-agent",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(scopes.length ? { scope: scopes.join(" ") } : {}),
    }),
  });
  const clientId = String(body.client_id ?? "").trim();
  if (!clientId) throw new Error("the registration endpoint did not return client_id");
  const registration: ClientRegistration = {
    clientId,
    ...(body.client_secret ? { clientSecret: String(body.client_secret) } : {}),
    tokenEndpointAuthMethod: String(body.token_endpoint_auth_method ?? "none"),
    authorizationServer: issuer,
    redirectUri,
  };
  setSecretJson(clientSecretName(server), registration);
  return registration;
}

interface CallbackServer {
  redirectUri: string;
  code: (state: string) => Promise<string>;
  cancel: () => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function startCallback(port: number): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let finish: ((code: string) => void) | null = null;
    let fail: ((error: Error) => void) | null = null;
    let settled = false;
    let expectedState = "";
    const timer = setTimeout(() => {
      fail?.(new Error("timed out waiting for the browser to come back"));
      server.close();
    }, AUTH_TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const error = url.searchParams.get("error");
      const description = url.searchParams.get("error_description") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const ok = !error && code && (!expectedState || state === expectedState);
      const message = ok
        ? "授权完成，可以关闭此页面。/ Authorization complete. You can close this page."
        : `授权失败 / Authorization failed: ${error ?? "state mismatch"} ${description}`;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>win-agent MCP</title>` +
          `<style>body{font:15px system-ui;margin:3rem;color:#222}code{background:#eee;padding:.15rem .35rem}</style>` +
          `<h2>${ok ? "win-agent" : "win-agent"}</h2><p>${escapeHtml(message)}</p>` +
          `<script>setTimeout(()=>window.close(),${ok ? 1200 : 999999})</script>`,
      );
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        finish?.(code);
        server.close();
      } else {
        fail?.(new Error(error ? `${error}: ${description}` : "the authorization callback did not carry the expected state"));
        server.close();
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        code: (state: string) =>
          new Promise<string>((done, error) => {
            expectedState = state;
            finish = done;
            fail = error;
          }),
        cancel: () => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            fail?.(new Error("authorization cancelled"));
          }
          server.close();
        },
      });
    });
  });
}

function formTokenRequest(
  endpoint: string,
  params: Record<string, string>,
  client: ClientRegistration,
  metadata: AuthServerMetadata,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const method = client.tokenEndpointAuthMethod ?? "none";
  if (client.clientSecret && method === "client_secret_basic") {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`, "utf8").toString("base64")}`;
  } else {
    body.set("client_id", client.clientId);
    if (client.clientSecret) body.set("client_secret", client.clientSecret);
  }
  return readJson(endpoint, { method: "POST", headers, body: body.toString() });
}

function tokenSetFromResponse(
  body: Record<string, unknown>,
  client: ClientRegistration,
  metadata: AuthServerMetadata,
  resource: string,
  previous?: OAuthTokenSet,
): OAuthTokenSet {
  const accessToken = String(body.access_token ?? "").trim();
  if (!accessToken) throw new Error("the token endpoint did not return access_token");
  const expiresIn = Number(body.expires_in ?? 0);
  return {
    accessToken,
    refreshToken: String(body.refresh_token ?? previous?.refreshToken ?? "") || undefined,
    tokenType: String(body.token_type ?? "Bearer"),
    scope: String(body.scope ?? previous?.scope ?? "") || undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + Math.round(expiresIn * 1000) : previous?.expiresAt,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    tokenEndpoint: metadata.token_endpoint,
    authorizationServer: metadata.issuer ?? metadata.authorization_endpoint,
    resource,
  };
}

const refreshing = new Map<string, Promise<OAuthTokenSet>>();

/**
 * A valid `Authorization` value, refreshing when needed. Null when no OAuth.
 * `forceRefresh` is for a 401 on a token that has not reached its stated
 * expiry: the server may have revoked it.
 */
export async function oauthHeader(server: McpServer, forceRefresh = false): Promise<string | null> {
  if (!oauthConfigured(server)) return null;
  const stored = getSecretJson<OAuthTokenSet>(tokenSecret(server));
  if (!stored?.accessToken) {
    throw new McpAuthRequiredError(`MCP server "${server.id}" needs OAuth authorization`, server.id);
  }
  // A token is scoped to the MCP resource it was minted for. That is the
  // explicitly configured resource indicator, or the MCP URL by default. If the
  // endpoint or the explicitly configured client changed, do not send the old
  // token to it.
  if (!tokenMatches(server, stored)) {
    deleteSecret(tokenSecret(server));
    throw new McpAuthRequiredError(
      `the OAuth token for MCP server "${server.id}" belongs to another endpoint; authorize it again`,
      server.id,
    );
  }
  if (!forceRefresh && stored.expiresAt && stored.expiresAt > Date.now() + 30_000) {
    return `${stored.tokenType || "Bearer"} ${stored.accessToken}`;
  }
  if (!stored.refreshToken) {
    deleteSecret(tokenSecret(server));
    throw new McpAuthRequiredError(`the OAuth token for MCP server "${server.id}" expired`, server.id, stored.authorizationServer);
  }
  const running = refreshing.get(server.id);
  if (running) return `${(await running).tokenType || "Bearer"} ${(await running).accessToken}`;
  const refresh = (async () => {
    const metadata: AuthServerMetadata = {
      issuer: stored.authorizationServer,
      authorization_endpoint: stored.authorizationServer,
      token_endpoint: stored.tokenEndpoint,
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    };
    const registration = getSecretJson<ClientRegistration>(clientSecretName(server));
    const client: ClientRegistration = {
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      tokenEndpointAuthMethod:
        stored.tokenEndpointAuthMethod ??
        registration?.tokenEndpointAuthMethod ??
        (stored.clientSecret ? "client_secret_basic" : "none"),
    };
    try {
      const body = await formTokenRequest(
        stored.tokenEndpoint,
        {
          grant_type: "refresh_token",
          refresh_token: stored.refreshToken ?? "",
          ...(stored.scope ? { scope: stored.scope } : {}),
          resource: stored.resource,
        },
        client,
        metadata,
      );
      const next = tokenSetFromResponse(body, client, metadata, stored.resource, stored);
      setSecretJson(tokenSecret(server), next);
      return next;
    } catch (error) {
      deleteSecret(tokenSecret(server));
      throw new McpAuthRequiredError(
        `the OAuth token for MCP server "${server.id}" could not be refreshed: ${(error as Error).message}`,
        server.id,
        stored.authorizationServer,
      );
    }
  })().finally(() => refreshing.delete(server.id));
  refreshing.set(server.id, refresh);
  const next = await refresh;
  return `${next.tokenType || "Bearer"} ${next.accessToken}`;
}

/**
 * `beginAuthorization` has to return before discovery finishes so the HTTP
 * request can answer, but the URL only exists after discovery. This wrapper
 * starts the flow and resolves with the URL while keeping the same callback.
 */
export async function startAuthorization(
  server: McpServer,
  opener?: (url: string) => void,
): Promise<{ authUrl: string; done: Promise<OAuthTokenSet>; cancel: () => void }> {
  if (!oauthConfigured(server)) throw new Error(`MCP server "${server.id}" is not configured for OAuth`);
  const callback = await startCallback(server.oauth?.callbackPort ?? 0);
  let cancelled = false;

  let authUrl: string;
  let verifier: string;
  let state: string;
  let client: ClientRegistration;
  let metadata: AuthServerMetadata;
  let resource: string;
  try {
    let issuer = server.oauth?.authorizationServer ?? "";
    let scopes = server.oauth?.scopes ?? [];
    resource = server.oauth?.resource || server.url;
    if (!resource) throw new Error("the server URL is empty");
    if (!issuer) {
      const protectedMetadata = await protectedResource(resource);
      issuer = protectedMetadata.metadata.authorization_servers?.[0] ?? "";
      if (scopes.length === 0) scopes = protectedMetadata.metadata.scopes_supported ?? [];
    }
    if (!issuer) throw new Error("the protected-resource metadata did not name an authorization server");
    metadata = await authorizationServer(issuer);
    if (
      metadata.code_challenge_methods_supported?.length &&
      !metadata.code_challenge_methods_supported.includes("S256")
    ) {
      throw new Error("the authorization server does not support PKCE S256");
    }
    client = await registerClient(server, metadata, callback.redirectUri, scopes);
    const pair = pkce();
    verifier = pair.verifier;
    state = base64url(crypto.randomBytes(24));
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", callback.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pair.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("resource", resource);
    authUrl = url.href;
  } catch (error) {
    callback.cancel();
    throw error;
  }

  const code = callback.code(state);
  const done = (async () => {
    try {
      const value = await code;
      if (cancelled) throw new Error("authorization cancelled");
      const body = await formTokenRequest(
        metadata.token_endpoint,
        {
          grant_type: "authorization_code",
          code: value,
          redirect_uri: callback.redirectUri,
          code_verifier: verifier,
          resource,
        },
        client,
        metadata,
      );
      const tokens = tokenSetFromResponse(body, client, metadata, resource);
      setSecretJson(tokenSecret(server), tokens);
      return tokens;
    } finally {
      callback.cancel();
    }
  })();
  opener?.(authUrl);
  return {
    authUrl,
    done,
    cancel: () => {
      cancelled = true;
      callback.cancel();
    },
  };
}
