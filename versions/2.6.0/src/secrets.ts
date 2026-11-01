/**
 * Windows DPAPI secret storage.
 *
 * Some things must survive a restart but must not be readable in `data/`: OAuth
 * refresh tokens, an API key, a header token. Windows DPAPI encrypts them to the
 * current user account, so copying `data/secrets.json` to another machine or
 * opening it in Notepad does not reveal the plaintext.
 *
 * The file only ever contains `dpapi:<base64>` values. A `plain:` value is
 * accepted for files written on a non-Windows test runner, never on Windows.
 * Decryption is synchronous on purpose: settings are loaded synchronously at
 * startup, and a settings object with empty keys would be worse than a few
 * milliseconds.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./store.js";

export const SECRET_PREFIX = "dpapi:";
const PLAIN_PREFIX = "plain:";
const SECRET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

interface SecretFile {
  version: 1;
  secrets: Record<string, string>;
}

let cache: { file: string; mtimeMs: number; data: SecretFile } | null = null;
const plain = new Map<string, string>();

export function secretsFile(): string {
  return path.join(dataDir(), "secrets.json");
}

function read(): SecretFile {
  const file = secretsFile();
  if (!fs.existsSync(file)) return { version: 1, secrets: {} };
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SecretFile>;
    const secrets: Record<string, string> = {};
    if (parsed && typeof parsed.secrets === "object" && parsed.secrets) {
      for (const [name, value] of Object.entries(parsed.secrets)) {
        if (SECRET_NAME.test(name) && typeof value === "string") secrets[name] = value;
      }
    }
    cache = { file, mtimeMs, data: { version: 1, secrets } };
    plain.clear();
    return cache.data;
  } catch {
    // A corrupt secrets file must not take the whole app down. It behaves like
    // "no secrets"; the next save rewrites it.
    return { version: 1, secrets: {} };
  }
}

function write(data: SecretFile): void {
  const file = secretsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  cache = null;
  plain.clear();
}

function powershellPath(): string {
  const explicit = process.env.AGENT_POWERSHELL;
  if (explicit) return explicit;
  const root = process.env.SystemRoot ?? "C:\\Windows";
  const modern = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(modern) ? modern : "powershell.exe";
}

function dpapi(input: string, decrypt: boolean): string {
  if (process.platform !== "win32") throw new Error("DPAPI is only available on Windows");
  const operation = decrypt ? "Unprotect" : "Protect";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$in = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Convert]::FromBase64String($in)",
    `$out = [System.Security.Cryptography.ProtectedData]::${operation}($bytes, $null, 'CurrentUser')`,
    "[Console]::Out.Write([Convert]::ToBase64String($out))",
  ].join("\n");
  const result = spawnSync(powershellPath(), ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: decrypt ? input : Buffer.from(input, "utf8").toString("base64"),
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const value = String(result.stdout ?? "").trim();
  if (result.status !== 0 || !value) {
    throw new Error(String(result.stderr ?? "").trim() || "DPAPI failed");
  }
  return value;
}

/** Encrypt one value; returns the exact text stored in the file. */
export function protectSecret(value: string): string {
  if (process.platform !== "win32") {
    return `${PLAIN_PREFIX}${Buffer.from(value, "utf8").toString("base64")}`;
  }
  return `${SECRET_PREFIX}${dpapi(value, false)}`;
}

/** Decrypt one stored value. Returns null when it is missing or unreadable. */
export function unprotectSecret(value: string): string | null {
  if (value.startsWith(PLAIN_PREFIX)) {
    // Only tests on non-Windows runners may write this form; a Windows install
    // must never treat base64 as a protected value.
    if (process.platform === "win32") return null;
    try {
      return Buffer.from(value.slice(PLAIN_PREFIX.length), "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  // Unknown prefixes are not "old plaintext": the 2.5 store has never written
  // one, and accepting it would let a hand-edited file smuggle a raw token in.
  if (!value.startsWith(SECRET_PREFIX)) return null;
  try {
    const encoded = value.slice(SECRET_PREFIX.length);
    return Buffer.from(dpapi(encoded, true), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function hasSecret(name: string): boolean {
  if (!SECRET_NAME.test(name)) return false;
  return Boolean(read().secrets[name]);
}

export function getSecret(name: string): string | null {
  if (!SECRET_NAME.test(name)) return null;
  if (plain.has(name)) return plain.get(name) ?? null;
  const stored = read().secrets[name];
  if (!stored) return null;
  const value = unprotectSecret(stored);
  if (value !== null) plain.set(name, value);
  return value;
}

export function getSecretJson<T>(name: string): T | null {
  const value = getSecret(name);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Save or replace one secret. An empty string deletes it. */
export function setSecret(name: string, value: string): void {
  if (!SECRET_NAME.test(name)) throw new Error("secret names use letters, digits, dot, dash and underscore");
  const data = read();
  if (!value) {
    if (name in data.secrets) {
      delete data.secrets[name];
      write(data);
    }
    plain.delete(name);
    return;
  }
  if (plain.has(name) && plain.get(name) === value) return;
  data.secrets[name] = protectSecret(value);
  write(data);
  plain.set(name, value);
}

export function setSecretJson(name: string, value: unknown): void {
  setSecret(name, JSON.stringify(value));
}

export function deleteSecret(name: string): boolean {
  if (!SECRET_NAME.test(name) || !(name in read().secrets)) return false;
  const data = read();
  delete data.secrets[name];
  write(data);
  plain.delete(name);
  return true;
}

/** Names only; values are never returned. */
export function listSecretNames(): string[] {
  return Object.keys(read().secrets).sort();
}

/** Replace `${secret:name}` with the decrypted value; unknown names become empty. */
export function resolveSecretRefs(text: string): string {
  return String(text ?? "").replace(/\$\{secret:([a-zA-Z0-9][a-zA-Z0-9_.-]{0,95})\}/g, (_whole, name: string) => {
    return getSecret(name) ?? "";
  });
}
