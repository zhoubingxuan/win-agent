import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Windows secret storage: DPAPI round-trips, secret references, and the
 * settings-file migration that keeps API keys out of plaintext JSON.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-secrets-test-"));
const data = path.join(root, "data");
const settingsPath = path.join(root, "settings.json");
process.env.AGENT_DATA_DIR = data;
process.env.AGENT_SETTINGS_FILE = settingsPath;

const source = (name) => pathToFileURL(path.join(process.cwd(), "src", name)).href;
const secrets = await import(source("secrets.ts"));
const settings = await import(source("settings.ts"));

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

console.log("DPAPI");
{
  const text = "token-秘密-42";
  const stored = secrets.protectSecret(text);
  check("a value round-trips through DPAPI", secrets.unprotectSecret(stored) === text);
  check("the stored form is not the plaintext", !stored.includes(text));
  check("it carries the dpapi prefix", stored.startsWith("dpapi:"));
  if (process.platform === "win32") {
    check("the ciphertext is real DPAPI output", stored.length > 40);
  }
  check("an unprefixed value is not treated as a secret", secrets.unprotectSecret("raw-token") === null);
}

console.log("\nsecret store");
{
  secrets.setSecret("mcp.header.Authorization", "Bearer abc");
  check("a secret can be read back", secrets.getSecret("mcp.header.Authorization") === "Bearer abc");
  const { expandEnv } = await import(source("mcp.ts"));
  check(
    "MCP ${secret:name} expansion uses the DPAPI value",
    expandEnv("Authorization: ${secret:mcp.header.Authorization}") === "Authorization: Bearer abc",
  );
  check("it appears in the name list", secrets.listSecretNames().includes("mcp.header.Authorization"));
  check("the name list never holds values", !secrets.listSecretNames().some((name) => name.includes("Bearer")));

  secrets.setSecretJson("mcp.oauth", { accessToken: "a", refreshToken: "r" });
  check("JSON secrets round-trip", secrets.getSecretJson("mcp.oauth")?.refreshToken === "r");
  check(
    "a secret reference is expanded",
    secrets.resolveSecretRefs("Authorization: ${secret:mcp.header.Authorization}") === "Authorization: Bearer abc",
  );
  check("an unknown reference becomes empty", secrets.resolveSecretRefs("x${secret:nope}x") === "xx");
  check("a bad name is refused", (() => {
    try {
      secrets.setSecret("../escape", "x");
      return false;
    } catch {
      return true;
    }
  })());

  const raw = fs.readFileSync(secrets.secretsFile(), "utf8");
  check("the secrets file holds DPAPI values", raw.includes("dpapi:"));
  check("the token is not in the file", !raw.includes("Bearer abc") && !raw.includes('"a"'));
  check("removing a secret works", secrets.deleteSecret("mcp.oauth") && secrets.getSecret("mcp.oauth") === null);
}

console.log("\nsettings never keep API keys in plaintext");
{
  const s = settings.loadSettings();
  settings.updateSettings({ apiKey: "sk-live-secret-秘密" });
  settings.saveSettings();
  const file = fs.readFileSync(settingsPath, "utf8");
  check("the settings file does not contain the key", !file.includes("sk-live-secret"));
  check("the key is in the DPAPI store", secrets.listSecretNames().some((name) => name.startsWith("profile.")));
  const reloaded = settings.loadSettings();
  check("loading restores the key", reloaded.apiKey === "sk-live-secret-秘密");
  check("the active profile keeps it too", settings.activeProfile(reloaded).apiKey === "sk-live-secret-秘密");
  check("the JSON file has an empty key placeholder", JSON.parse(file).apiKey === "");

  settings.updateSettings({ apiKey: "" });
  settings.saveSettings();
  const cleared = settings.loadSettings();
  check("clearing a key stays cleared", cleared.apiKey === "");
  check("clearing deletes the DPAPI copy", !secrets.listSecretNames().includes(`profile.${settings.activeProfile(cleared).id}.apiKey`));

  secrets.setSecret("profile.gone.apiKey", "orphan");
  settings.saveSettings();
  check("a removed profile's key is cleaned up", !secrets.listSecretNames().includes("profile.gone.apiKey"));
}

console.log("\nsettings file parsing still accepts a hand-written plaintext key");
{
  const current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  current.apiKey = "plain-from-notepad";
  const active = current.profiles.find((profile) => profile.id === current.activeProfile);
  if (active) active.apiKey = "plain-from-notepad";
  fs.writeFileSync(settingsPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  check("a legacy key is read", settings.loadSettings().apiKey === "plain-from-notepad");
  check("loading encrypts it immediately", !fs.readFileSync(settingsPath, "utf8").includes("plain-from-notepad"));
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${process.exitCode ? "with failures" : "0 failed"}`);
