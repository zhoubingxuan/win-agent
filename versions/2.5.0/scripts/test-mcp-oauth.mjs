import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * MCP OAuth 2.1 end to end, without a browser and without a real model:
 * protected-resource discovery, dynamic registration, PKCE S256, the loopback
 * callback, DPAPI storage, refresh after a revoked token, and the trust gate.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-oauth-test-"));
const data = path.join(root, "data");
process.env.AGENT_DATA_DIR = data;
process.env.AGENT_SETTINGS_FILE = path.join(data, "settings.json");

const source = (name) => pathToFileURL(path.join(process.cwd(), "src", name)).href;
const { McpManager } = await import(source("mcp.ts"));
const { oauthHeader, oauthStatusFor, startAuthorization } = await import(source("mcp-auth.ts"));
const { getSecretJson, setSecretJson } = await import(source("secrets.ts"));

let passed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`);
    process.exitCode = 1;
  }
}
function section(name) {
  console.log(`\n${name}`);
}

let base = "";
let expectedAccess = "";
let refreshCalls = 0;
let revoked = false;
let challenge = "";
let authorizationCodes = 0;
let registrationCalls = 0;
const tokenCalls = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", base || "http://127.0.0.1");
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    return send(200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["mcp.read"] });
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return send(200, {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      scopes_supported: ["mcp.read"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }
  if (url.pathname === "/register" && req.method === "POST") {
    registrationCalls++;
    const body = JSON.parse(await readBody(req) || "{}");
    return send(201, {
      client_id: "client-win-agent",
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
    });
  }
  if (url.pathname === "/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    tokenCalls.push(Object.fromEntries(form));
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "code-win-agent") return send(400, { error: "invalid_grant" });
      const computed = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!challenge || computed !== challenge) return send(400, { error: "invalid_grant", error_description: "PKCE mismatch" });
      authorizationCodes++;
      expectedAccess = "access-1";
      return send(200, {
        access_token: expectedAccess,
        refresh_token: "refresh-1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "mcp.read",
      });
    }
    if (form.get("grant_type") === "refresh_token") {
      if (!["refresh-1", "refresh-2"].includes(form.get("refresh_token") ?? "")) {
        return send(400, { error: "invalid_grant" });
      }
      refreshCalls++;
      expectedAccess = "access-2";
      revoked = false;
      return send(200, { access_token: expectedAccess, refresh_token: "refresh-2", token_type: "Bearer", expires_in: 3600 });
    }
    return send(400, { error: "unsupported_grant_type" });
  }
  if (url.pathname === "/mcp" && req.method === "POST") {
    const auth = String(req.headers.authorization ?? "");
    if (revoked || auth !== `Bearer ${expectedAccess}`) {
      return send(401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` });
    }
    const body = JSON.parse(await readBody(req) || "{}");
    if (body.method === "initialize") {
      return send(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "oauth-mock", version: "1.0.0" },
        },
      });
    }
    if (body.method === "notifications/initialized") {
      res.writeHead(202);
      return res.end();
    }
    if (body.method === "tools/list") {
      return send(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }] },
      });
    }
    if (body.method === "tools/call") {
      return send(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "authorized call" }] },
      });
    }
    return send(200, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown" } });
  }
  if (url.pathname === "/mcp" && req.method === "DELETE") {
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === "/authorize") {
    const state = url.searchParams.get("state") ?? "";
    challenge = url.searchParams.get("code_challenge") ?? "";
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", "code-win-agent");
    redirect.searchParams.set("state", state);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<a href="${redirect}">continue</a>`);
    return;
  }
  send(404, { error: "not found" });
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
base = `http://127.0.0.1:${address.port}`;

const remoteServer = {
  id: "oauth",
  name: "OAuth mock",
  transport: "http",
  command: "",
  args: [],
  env: {},
  url: `${base}/mcp`,
  headers: {},
  enabled: true,
  autoApprove: true,
  trusted: true,
  oauth: { scopes: ["mcp.read"] },
  tools: [],
};

section("authorization");
{
  const status = oauthStatusFor(remoteServer);
  check("before connecting, OAuth is configured but not authorized", status.configured && !status.authorized);

  const flow = await startAuthorization(remoteServer);
  check("discovery found the authorization endpoint", flow.authUrl.startsWith(`${base}/authorize`));
  const url = new URL(flow.authUrl);
  check("PKCE S256 is used", url.searchParams.get("code_challenge_method") === "S256" && Boolean(url.searchParams.get("code_challenge")));
  check("the resource indicator is the MCP URL", url.searchParams.get("resource") === `${base}/mcp`);
  check("dynamic registration ran once", registrationCalls === 1);
  check("the requested scope survived discovery", url.searchParams.get("scope") === "mcp.read");

  // Be the browser: open the authorization URL (this records the challenge),
  // then follow its link to the loopback callback.
  const authorizePage = await fetch(flow.authUrl);
  const html = await authorizePage.text();
  const redirect = /href="([^"]+)"/.exec(html)?.[1] ?? "";
  check("the authorization page offers the callback", redirect.startsWith("http://127.0.0.1:"));
  const callback = await fetch(redirect);
  check("the callback page says it is done", callback.status === 200 && (await callback.text()).includes("Authorization complete"));
  const tokens = await flow.done;
  check("the code was exchanged once", authorizationCodes === 1);
  check("the access token is stored in memory", tokens.accessToken === "access-1");
  check("the refresh token is kept", tokens.refreshToken === "refresh-1");
  check("the token request carried a PKCE verifier", tokenCalls[0]?.code_verifier?.length > 20);

  const after = oauthStatusFor(remoteServer);
  check("the server now reports authorized", after.authorized && after.authorizationServer === base);
  check("the token endpoint is remembered", after.tokenEndpoint === `${base}/token`);

  const storedTokens = getSecretJson("mcp.oauth.oauth");
  check("the token remembers its resource", storedTokens?.resource === `${base}/mcp`);
  setSecretJson("mcp.oauth.oauth", { ...storedTokens, resource: `${base}/other` });
  let refusedOtherEndpoint = false;
  try {
    await oauthHeader(remoteServer);
  } catch {
    refusedOtherEndpoint = true;
  }
  check("a token minted for another URL is refused", refusedOtherEndpoint);
  check("the stale token is deleted", getSecretJson("mcp.oauth.oauth") === null);
  setSecretJson("mcp.oauth.oauth", storedTokens);

  const savedOAuth = remoteServer.oauth;
  remoteServer.oauth = { ...savedOAuth, resource: `${base}/custom` };
  setSecretJson("mcp.oauth.oauth", { ...storedTokens, resource: `${base}/custom` });
  let acceptedCustomResource = false;
  try {
    await oauthHeader(remoteServer);
    acceptedCustomResource = true;
  } catch {
    acceptedCustomResource = false;
  }
  check("an explicitly configured resource indicator is accepted", acceptedCustomResource);
  remoteServer.oauth = savedOAuth;
  setSecretJson("mcp.oauth.oauth", storedTokens);

  const file = path.join(data, "secrets.json");
  const raw = fs.readFileSync(file, "utf8");
  check("tokens never appear in plain text", !raw.includes("access-1") && !raw.includes("refresh-1"));
  check("the secrets file is DPAPI-wrapped", raw.includes("dpapi:"));
  check("the registration is stored too", raw.includes("mcp.oauth.client"));
}

section("the manager uses the bearer token");
{
  // The stored access token is valid in form but the server already rejects it:
  // a real connect has to refresh, not just fail and wait for the user.
  expectedAccess = "access-stale";
  const manager = new McpManager(() => [remoteServer], 10_000);
  await manager.refresh(true);
  const status = manager.status().find((entry) => entry.id === "oauth");
  check("a 401 during connect is refreshed and retried", status?.connected === true, status?.error);
  check("the startup refresh happened once", refreshCalls === 1);
  check("its tool is offered", manager.names().length === 1);
  const result = await manager.call(manager.names()[0], {});
  check("a tool call succeeds", result.text === "authorized call");

  revoked = true;
  const refreshed = await manager.call(manager.names()[0], {});
  check("a revoked token is refreshed and the call retried", refreshed.text === "authorized call");
  check("refresh was requested twice", refreshCalls === 2);
  check("the new token is the one that worked", expectedAccess === "access-2");
  revoked = false;
  manager.close();
}

section("first connect is a trust gate");
{
  const gated = { ...remoteServer, trusted: false };
  const manager = new McpManager(() => [gated], 10_000);
  await manager.refresh(true);
  const status = manager.status().find((entry) => entry.id === "oauth");
  check("an untrusted server is not connected", status?.connected === false);
  check("the reason is the trust gate", /not trusted/i.test(status?.error ?? ""));
  check("no tool is offered before trust", manager.names().length === 0);
  manager.close();
}

section("sign out");
{
  const { clearOAuth } = await import(source("mcp-auth.ts"));
  check("signing out removes the stored credentials", clearOAuth(remoteServer) === true);
  const status = oauthStatusFor(remoteServer);
  check("the server is no longer authorized", status.configured && !status.authorized);
  check("signing out again reports nothing to remove", clearOAuth(remoteServer) === false);
}

server.close();
process.chdir(os.tmpdir());
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${process.exitCode ? "with failures" : "0 failed"}`);
