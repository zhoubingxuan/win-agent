/**
 * Version isolation test / 版本隔离测试.
 *
 * The hard rule: two copies of this agent on the same machine - in particular
 * two folders under `versions/` - must never share data, and each must report
 * its own version, no matter which folder it was started from.
 *
 * The test builds three fake installations in a temp folder, copies the built
 * `dist/` into each one with a different package.json, then imports one copy's
 * module *while the working folder is another copy*. Before 1.1.1 that read the
 * working folder and the check failed.
 *
 * Run:  npm run build && npm run test:isolation
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      expected ${expected}\n      got      ${actual}`);
}

if (!fs.existsSync(path.join(dist, "store.js"))) {
  console.error("dist/store.js is missing - run `npm run build` first.");
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-isolation-"));
const probe = path.join(tmp, "probe.mjs");
fs.writeFileSync(
  probe,
  `import { pathToFileURL } from "node:url";
const store = await import(pathToFileURL(process.argv[2]).href);
const version = await import(pathToFileURL(process.argv[3]).href);
process.stdout.write(JSON.stringify({
  install: store.installDir(),
  data: store.dataDir(),
  version: version.VERSION,
}));`,
  "utf8",
);

/** One fake installation: <dir>/dist (built code) + <dir>/package.json. */
function install(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(dist, path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "win-agent", version, type: "module" }, null, 2),
    "utf8",
  );
  return {
    dir,
    store: path.join(dir, "dist", "store.js"),
    version: path.join(dir, "dist", "version.js"),
  };
}

/** Ask a copy what it thinks its install folder / data folder / version are. */
function ask(copy, cwd) {
  const out = execFileSync(process.execPath, [probe, copy.store, copy.version], {
    cwd,
    encoding: "utf8",
  });
  return JSON.parse(out);
}
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const a = install(path.join(tmp, "agent-a"), "9.9.1-a");
const b = install(path.join(tmp, "agent-b"), "9.9.2-b");
const globalLike = install(path.join(tmp, "node_modules", "win-agent"), "9.9.3-g");

// 1. Ask A while standing in B: must answer with A's own folders and version.
const fromB = ask(a, b.dir);
check("A started from B still reports A's install folder", same(fromB.install, a.dir), true);
check("A started from B still reports A's data folder", same(fromB.data, path.join(a.dir, "data")), true);
check("A started from B still reports A's own version", fromB.version, "9.9.1-a");

// 2. And the other way round.
const fromA = ask(b, a.dir);
check("B started from A still reports B's data folder", same(fromA.data, path.join(b.dir, "data")), true);
check("B started from A still reports B's own version", fromA.version, "9.9.2-b");

// 3. Started from a neutral folder.
const neutral = ask(a, tmp);
check("A started from a neutral folder keeps its own data folder", same(neutral.data, path.join(a.dir, "data")), true);

// 4. Two copies never point at the same data folder.
check("the two copies use different data folders", same(fromB.data, fromA.data), false);

// 5. A copy installed inside node_modules falls back to the working folder
//    (there, "next to the code" would mean "inside node_modules").
const globalRun = ask(globalLike, tmp);
check("node_modules copy falls back to the working folder", same(globalRun.install, tmp), true);

// 6. Nothing was created: asking for a path must not write to disk.
check("asking for paths does not create data folders", fs.existsSync(path.join(a.dir, "data")), false);

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // Windows can hold a handle briefly; a temp folder is not worth a red suite.
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
