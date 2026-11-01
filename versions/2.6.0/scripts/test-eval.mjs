// The eval harness is only as good as its checks: a task whose check always says
// "pass" would report a model as perfect, and one that always says "fail" would
// report it as useless. This suite proves every check rejects an untouched folder
// and accepts the result a correct agent would produce - no model needed.
//
// Run with: npm run test:eval
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

const source = fs.readFileSync(path.join(ROOT, "scripts", "eval.mjs"), "utf8");
const ids = [...source.matchAll(/^\s{4}id: "([a-z0-9_]+)",/gm)].map((match) => match[1]);

console.log("the task list");
check("has 34 tasks", ids.length === 34, String(ids.length));
check("no duplicate id", new Set(ids).size === ids.length, ids.join(","));
check(
  "every task carries a prompt, a check and a solver",
  (source.match(/^\s{4}prompt:/gm) ?? []).length === 34 &&
    (source.match(/^\s{4}check:/gm) ?? []).length === 34 &&
    (source.match(/^\s{4}solve:/gm) ?? []).length === 34,
);
check("the ids are readable in the report", ids.every((id) => /^[a-z][a-z0-9_]{2,}$/.test(id)));
check("the code suite has 8 tasks", (source.match(/^\s{4}suite: "code",/gm) ?? []).length === 8);
check("the files suite is the default", ids.filter((id) => id.startsWith("code_")).length === 8);

console.log("\nself-check (no model)");
const full = spawnSync(process.execPath, ["scripts/eval.mjs", "--self-check"], { cwd: ROOT, encoding: "utf8" });
const fullOut = `${full.stdout ?? ""}${full.stderr ?? ""}`;
check("it exits 0", full.status === 0, `status ${full.status}`);
check("all 34 checks are honest", /34\/34 checks are honest/.test(fullOut), fullOut.split("\n").slice(-3).join(" | "));
check("no check is trivially true", !/FAIL /.test(fullOut));

const code = spawnSync(process.execPath, ["scripts/eval.mjs", "--self-check", "--suite", "code"], {
  cwd: ROOT,
  encoding: "utf8",
});
check("--suite code runs only the coder tasks", /8\/8 checks are honest/.test(`${code.stdout}${code.stderr}`), `${code.stdout}${code.stderr}`.split("\n").slice(-2).join(" | "));
const files = spawnSync(process.execPath, ["scripts/eval.mjs", "--self-check", "--suite", "files"], {
  cwd: ROOT,
  encoding: "utf8",
});
check("--suite files skips the coder tasks", /26\/26 checks are honest/.test(`${files.stdout}${files.stderr}`), `${files.stdout}${files.stderr}`.split("\n").slice(-2).join(" | "));

const badSuite = spawnSync(process.execPath, ["scripts/eval.mjs", "--self-check", "--suite", "nope"], {
  cwd: ROOT,
  encoding: "utf8",
});
check(
  "an unknown suite is refused",
  badSuite.status === 2 && /unknown suite/.test(`${badSuite.stdout}${badSuite.stderr}`),
  `status ${badSuite.status}`,
);

const subset = spawnSync(
  process.execPath,
  ["scripts/eval.mjs", "--self-check", "--only", "multi_write3,hash_same"],
  { cwd: ROOT, encoding: "utf8" },
);
const subsetOut = `${subset.stdout ?? ""}${subset.stderr ?? ""}`;
check("--only narrows the run", /2\/2 checks are honest/.test(subsetOut), subsetOut.split("\n").slice(-2).join(" | "));

const unknown = spawnSync(process.execPath, ["scripts/eval.mjs", "--self-check", "--only", "nope"], { cwd: ROOT, encoding: "utf8" });
check(
  "an unknown task name is refused",
  unknown.status === 2 && /no task matched/.test(`${unknown.stdout}${unknown.stderr}`),
  `status ${unknown.status}`,
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`failing checks: ${failures.join(", ")}`);
  process.exit(1);
}
