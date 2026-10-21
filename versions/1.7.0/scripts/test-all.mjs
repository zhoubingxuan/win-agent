// Run every suite in order, then make a failure legible.
// Run with: npm run test:all
//
// GitHub folds a failed step into one "Process completed with exit code 1." line, and
// reading a job's log needs an authenticated request - so a red CI run used to say
// nothing about *what* broke. Every failing check is therefore also echoed as a
// workflow annotation (::error::), which is visible on the run page and readable
// through the public check-runs API.
import { spawn } from "node:child_process";

/** The suites in the order they run; `tsx` marks the ones that need the TS loader. */
const SUITES = [
  ["context", "scripts/test-context.mjs", true],
  ["providers", "scripts/test-providers.mjs", true],
  ["mcp", "scripts/test-mcp.mjs", true],
  ["models", "scripts/test-models.mjs", true],
  ["mode", "scripts/test-mode.mjs", true],
  ["sandbox", "scripts/test-sandbox.mjs", true],
  ["agent", "scripts/test-agent.mjs", true],
  ["i18n", "scripts/test-i18n.mjs", true],
  ["docs", "scripts/test-docs.mjs", true],
  ["api", "scripts/test-api.mjs", true],
  ["audit", "scripts/test-audit.mjs", true],
  ["windows", "scripts/test-windows.mjs", true],
  ["isolation", "scripts/test-isolation.mjs", false],
];

/** The lines a suite prints per failed check (its summary reads "N passed, M failed"). */
const FAILING = /^\s+FAIL |FAILED$/;

/** Workflow-command escaping: the annotation is one line and must survive the wire. */
function escapeAnnotation(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Run one suite, streaming its output, and collect the lines that said FAIL. */
function runSuite(script, needsTsx) {
  return new Promise((resolve) => {
    const args = needsTsx ? ["--import", "tsx", script] : [script];
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const failing = [];
    const watch = (stream) => {
      let rest = "";
      stream.on("data", (chunk) => {
        const text = String(chunk);
        process.stdout.write(text);
        rest += text;
        const lines = rest.split(/\r?\n/);
        rest = lines.pop() ?? "";
        for (const line of lines) if (FAILING.test(line)) failing.push(line.trim());
      });
    };
    watch(child.stdout);
    watch(child.stderr);
    child.on("error", (error) => {
      process.stdout.write(`could not start ${script}: ${error.message}\n`);
      resolve({ code: 1, failing });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, failing }));
  });
}

const failed = [];
for (const [name, script, needsTsx] of SUITES) {
  console.log(`\n================ ${name} (${script}) ================`);
  const result = await runSuite(script, needsTsx);
  if (result.code !== 0) {
    failed.push({ name, script, ...result });
    break; // like the "&&" chain this replaces: stop at the first failure
  }
}

if (failed.length === 0) {
  console.log("\nevery suite passed");
} else {
  for (const suite of failed) {
    const detail = (suite.failing.length > 0 ? suite.failing.slice(0, 5).join(" | ") : `exit code ${suite.code}`).slice(0, 900);
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::error title=test:all failed in ${escapeAnnotation(suite.name)}::${escapeAnnotation(detail)}`);
    }
    console.error(`FAILED ${suite.name} (${suite.script}): ${detail}`);
  }
  process.exit(1);
}
