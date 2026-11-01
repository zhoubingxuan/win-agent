// The coder tools: apply_patch, git, tests - and the two receipts that stop a model
// from silently destroying a file it never read.
//
// Everything runs in a temp folder with its own data folder; the real settings,
// audit log and files are never touched.
// Run with: npm run test:code
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { updateSettings } from "../src/settings.js";
import { applyPatchTool } from "../src/tools/patch.js";
import { gitTool } from "../src/tools/git.js";
import { testsTool } from "../src/tools/tests.js";
import { filesTool } from "../src/tools/files.js";
import { processesTool } from "../src/tools/processes.js";
import { parsePatch, applyFilePatch } from "../src/patch.js";

const scratch = path.join(os.tmpdir(), `win-agent-code-${process.pid}`);
const work = path.join(scratch, "work");
const originalCwd = process.cwd();
fs.mkdirSync(work, { recursive: true });
process.env.AGENT_DATA_DIR = path.join(scratch, "data");
process.chdir(work);
// The tools follow the working directory; the sandbox is exercised separately below.
updateSettings({ sandbox: false, workdir: work });

let passed = 0;
let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${extra ? ` - ${extra}` : ""}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

function ctxFor(options = {}) {
  const state = { records: [], approvals: [], backups: [] };
  const ctx = {
    dryRun: options.dryRun ?? false,
    guided: options.guided ?? false,
    approve: async (summary) => {
      state.approvals.push(summary);
      return options.approve ?? true;
    },
    backup: async (target) => {
      state.backups.push(target);
      return path.join(scratch, "backups", String(state.backups.length));
    },
    record: (input) => {
      state.records.push(input);
      return input;
    },
  };
  return { ctx, state };
}

async function run(tool, args, options = {}) {
  const { ctx, state } = ctxFor(options);
  const result = await tool.run(args, ctx);
  return { result, state };
}

const file = (name) => path.join(work, name);
const write = (name, text) => {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true });
  fs.writeFileSync(file(name), text);
};
const read = (name) => fs.readFileSync(file(name), "utf8");

const patch = (name, hunk) =>
  `--- a/${name}\n+++ b/${name}\n${hunk}\n`;

try {
  /* ---------------------------------------------------------------------- */
  /* The patch engine                                                       */
  /* ---------------------------------------------------------------------- */

  section("patch parsing and matching");
  {
    const parsed = parsePatch(
      "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n",
    );
    check("one file, one hunk", parsed.files.length === 1 && parsed.files[0].hunks.length === 1);
    check("the a/ prefix is stripped", parsed.files[0].path === "x.ts", parsed.files[0].path);
    check("the hunk has three lines", parsed.files[0].hunks[0].lines.length === 3, String(parsed.files[0].hunks[0].lines.length));
    check("no errors", parsed.errors.length === 0, parsed.errors.join("; "));

    const bare = parsePatch("@@ -1 +1 @@\n-a\n+b\n");
    check("a hunk without a file header is an error", bare.files.length === 0 && bare.errors.length > 0);

    const create = parsePatch(
      "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n",
    );
    check("a /dev/null header means create", create.files[0]?.create === true);
  }

  {
    const before = "function add(a, b) {\n  return a - b;\n}\n";
    const parsed = parsePatch("--- a/c.js\n+++ b/c.js\n@@ -1,3 +1,3 @@\n function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n");
    const applied = applyFilePatch(before, parsed.files[0]);
    check("an exact hunk applies", applied.ok && applied.text === "function add(a, b) {\n  return a + b;\n}\n", applied.error);
    check("counts are +1 -1", applied.added === 1 && applied.removed === 1);
  }

  {
    const before = "x = 1\ny = 2\nz = 3\n";
    const stale = parsePatch("--- a/s.js\n+++ b/s.js\n@@ -5,1 +5,1 @@\n-x = 1\n+x = 9\n");
    const applied = applyFilePatch(before, stale.files[0]);
    check("a stale line number still finds the only match", applied.ok && applied.text.startsWith("x = 9"), applied.error);
  }

  {
    const before = "a\nb\nc\nd\ne\nf\n";
    const parsed = parsePatch(
      "--- a/s.js\n+++ b/s.js\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -5,2 +5,2 @@\n e\n-f\n+F\n",
    );
    const applied = applyFilePatch(before, parsed.files[0]);
    check("two hunks both apply", applied.ok && applied.text === "a\nB\nc\nd\ne\nF\n", applied.error);
    check("both hunks are counted", applied.applied === 2, String(applied.applied));
  }

  {
    const before = "line1\nline2\nline3\n";
    const wrong = parsePatch("--- a/s.js\n+++ b/s.js\n@@ -2,1 +2,1 @@\n-nope\n+yes\n");
    const applied = applyFilePatch(before, wrong.files[0]);
    check("a context mismatch is refused", applied.ok === false && /context does not match/.test(applied.error), applied.error);
    check("a refused patch returns no text", applied.text === undefined);
  }

  {
    const before = "same\nsame\n";
    const ambiguous = parsePatch("--- a/s.js\n+++ b/s.js\n@@ -1000,1 +1000,1 @@\n-same\n+other\n");
    const applied = applyFilePatch(before, ambiguous.files[0]);
    check("an ambiguous context is refused", applied.ok === false && /appears 2 times/.test(applied.error), applied.error);
  }

  {
    const before = "a\r\nb\r\n";
    const parsed = parsePatch("--- a/s.js\n+++ b/s.js\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
    const applied = applyFilePatch(before, parsed.files[0]);
    check("CRLF is preserved", applied.ok && applied.text === "a\r\nc\r\n", JSON.stringify(applied.text));
  }

  {
    const parsed = parsePatch("--- a/s.js\n+++ b/s.js\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
    const applied = applyFilePatch("a\nb", parsed.files[0]);
    check("a missing final newline stays missing", applied.ok && applied.text === "a\nc", JSON.stringify(applied.text));
  }

  {
    const parsed = parsePatch("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n");
    const applied = applyFilePatch("", parsed.files[0]);
    check("a new file gets its lines and a final newline", applied.ok && applied.text === "hello\nworld\n", JSON.stringify(applied.text));
  }

  /* ---------------------------------------------------------------------- */
  /* apply_patch                                                            */
  /* ---------------------------------------------------------------------- */

  section("apply_patch tool");
  {
    write("calc.js", "function add(a, b) {\n  return a - b;\n}\n");
    const diff = patch("calc.js", "@@ -1,3 +1,3 @@\n function add(a, b) {\n-  return a - b;\n+  return a + b;\n }");
    const preview = await run(applyPatchTool, { action: "preview", patch: diff });
    check("preview says nothing was written", preview.result.startsWith("Preview only"), preview.result);
    check("preview does not change the file", read("calc.js").includes("a - b"));
    check("preview takes no backup", preview.state.backups.length === 0);

    const applied = await run(applyPatchTool, { action: "apply", patch: diff });
    check("apply changes the file", read("calc.js").includes("a + b"));
    check("apply reports the file and counts", /Patched calc\.js/.test(applied.result) && /\+1 -1/.test(applied.result), applied.result);
    check("apply backs the file up", applied.state.backups.length === 1 && applied.state.backups[0] === file("calc.js"));
    check("apply records an undo step", applied.state.records[0]?.steps?.[0]?.kind === "restore");
    check("apply returns a preview of the changed lines", applied.result.includes("+   return a + b;"), applied.result);
  }

  {
    write("one.txt", "one\n");
    write("two.txt", "two\n");
    const atomic = patch("one.txt", "@@ -1 +1 @@\n-one\n+ONE\n") + patch("two.txt", "@@ -1 +1 @@\n-nope\n+NOPE\n");
    const applied = await run(applyPatchTool, { patch: atomic });
    check("a patch touching two files fails as a whole", applied.result.startsWith("Error: hunk 1"), applied.result);
    check("the first file was not written", read("one.txt") === "one\n");
    check("the second file was not written", read("two.txt") === "two\n");
    check("a failed patch records nothing", applied.state.records.length === 0 && applied.state.backups.length === 0);
  }

  {
    const created = await run(applyPatchTool, {
      patch: "--- /dev/null\n+++ b/created.txt\n@@ -0,0 +1,1 @@\n+hello\n",
    });
    check("a create patch writes a new file", created.result.startsWith("Patched created.txt") && read("created.txt") === "hello\n", created.result);
    check("a created file can be undone by removing it", created.state.records[0]?.steps?.[0]?.kind === "remove");

    const again = await run(applyPatchTool, {
      patch: "--- /dev/null\n+++ b/created.txt\n@@ -0,0 +1,1 @@\n+hello\n",
    });
    check("creating an existing file is refused", again.result.startsWith("Error:") && /already exists/.test(again.result), again.result);
  }

  {
    write("bare.js", "old\n");
    const result = await run(applyPatchTool, { path: "bare.js", patch: "@@ -1 +1 @@\n-old\n+new\n" });
    check("a headerless patch uses the path argument", result.result.startsWith("Patched bare.js") && read("bare.js") === "new\n", result.result);
  }

  {
    write("keep.js", "keep\n");
    const result = await run(applyPatchTool, {
      patch: "--- a/keep.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-keep\n",
    });
    check("deleting through a patch is refused", result.result.startsWith("Error:") && /delete/.test(result.result), result.result);
    check("a refused delete leaves the file alone", read("keep.js") === "keep\n");
  }

  {
    const empty = await run(applyPatchTool, { patch: "   " });
    check("an empty patch is refused", empty.result.startsWith("Error:") && /empty/.test(empty.result));
    const headerless = await run(applyPatchTool, { patch: "@@ -1 +1 @@\n-a\n+b\n" });
    check("a patch without headers or a path is refused", headerless.result.startsWith("Error:") && /could not be read/.test(headerless.result), headerless.result);
  }

  {
    updateSettings({ sandbox: true, workdir: work });
    const outside = path.join(scratch, "escape.txt");
    const refused = await run(applyPatchTool, {
      path: outside,
      patch: "@@ -1 +1 @@\n-a\n+b\n",
    }).catch((error) => ({ error }));
    const text = refused.error?.message ?? refused.result ?? "";
    check("a patch outside the sandbox is refused", refused.error?.name === "SandboxRefusal" || /outside the sandbox/.test(text), text);
    check("nothing outside the sandbox was written", !fs.existsSync(outside));
    updateSettings({ sandbox: false, workdir: work });
  }

  /* ---------------------------------------------------------------------- */
  /* git                                                                    */
  /* ---------------------------------------------------------------------- */

  section("git tool");
  {
    const repo = path.join(work, "repo");
    fs.mkdirSync(repo, { recursive: true });
    const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    check("the test repository initialises", git("init", "-q").status === 0);
    git("config", "user.email", "code@example.test");
    git("config", "user.name", "Code Tool Test");
    git("config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(repo, "a.txt"), "first\n");

    const status = await run(gitTool, { action: "status", path: repo });
    check("status shows an untracked file", /^\?\? a\.txt$/m.test(status.result), status.result);

    const added = await run(gitTool, { action: "add", path: repo, files: ["a.txt"] });
    check("add stages the file", added.result.includes("Staged a.txt"), added.result);
    check("add needs no approval", added.state.approvals.length === 0);

    const staged = await run(gitTool, { action: "status", path: repo });
    check("the index shows the file as added", /^A  a\.txt$/m.test(staged.result), staged.result);

    const committed = await run(gitTool, { action: "commit", path: repo, message: "first commit" }, { approve: true });
    check("commit asks first", committed.state.approvals.length === 1 && /commit changes/.test(committed.state.approvals[0]));
    check("commit reports the hash and subject", /Committed [0-9a-f]+ first commit/.test(committed.result), committed.result);

    const log = await run(gitTool, { action: "log", path: repo });
    check("log shows the commit", log.result.includes("first commit"), log.result);

    const nothing = await run(gitTool, { action: "commit", path: repo, message: "empty" }, { approve: true });
    check("a clean tree says there is nothing to commit", /Nothing to commit/.test(nothing.result), nothing.result);

    fs.writeFileSync(path.join(repo, "a.txt"), "second\n");
    const diff = await run(gitTool, { action: "diff", path: repo });
    check("diff shows the edited line", diff.result.includes("+second") && diff.result.includes("-first"), diff.result);

    const cancelled = await run(gitTool, { action: "commit", path: repo, message: "second" }, { approve: false });
    check("a denied commit changes nothing", cancelled.result === "Cancelled by user.");
    const after = await run(gitTool, { action: "status", path: repo });
    check("the denied commit is still uncommitted", /^ M a\.txt$/m.test(after.result), after.result);

    const dry = await run(gitTool, { action: "commit", path: repo, message: "second" }, { dryRun: true });
    check("a dry run does not commit", dry.result.startsWith("DRY RUN:") && dry.state.approvals.length === 0);

    const plain = path.join(work, "plain");
    fs.mkdirSync(plain, { recursive: true });
    const outside = await run(gitTool, { action: "status", path: plain });
    check("a folder outside a repository says so", /not inside a git repository/.test(outside.result), outside.result);
  }

  /* ---------------------------------------------------------------------- */
  /* tests                                                                  */
  /* ---------------------------------------------------------------------- */

  section("tests tool");
  {
    const project = path.join(work, "project");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "t", private: true, scripts: { test: "node check.js" } }, null, 2),
    );
    fs.writeFileSync(path.join(project, "check.js"), 'console.log("ok 1 - the test ran");\n');

    const detected = await run(testsTool, { action: "detect", path: project });
    check("npm test is detected from scripts.test", detected.result.includes("npm test") && detected.result.includes("package.json"), detected.result);

    const ran = await run(testsTool, { action: "run", path: project }, { approve: true });
    check("the tests run and pass", /exit 0/.test(ran.result) && ran.result.includes("ok 1 - the test ran"), ran.result);
    check("running tests asks first", ran.state.approvals.length === 1 && /run the project's tests/.test(ran.state.approvals[0]));

    const dry = await run(testsTool, { action: "run", path: project }, { dryRun: true });
    check("a dry run only prints the command", dry.result.startsWith("DRY RUN:") && dry.state.approvals.length === 0, dry.result);

    const denied = await run(testsTool, { action: "run", path: project }, { approve: false });
    check("a denied test run does not start", denied.result === "Cancelled by user.");
  }

  {
    const failing = path.join(work, "failing");
    fs.mkdirSync(failing, { recursive: true });
    fs.writeFileSync(
      path.join(failing, "package.json"),
      JSON.stringify({ name: "f", private: true, scripts: { test: "node fail.js" } }, null, 2),
    );
    fs.writeFileSync(path.join(failing, "fail.js"), 'console.error("boom: 1 failing");\nprocess.exit(3);\n');

    const ran = await run(testsTool, { action: "run", path: failing }, { approve: true });
    check("a failing suite reports its exit code", /exit 3/.test(ran.result), ran.result);
    check("a failing suite keeps the failure text", ran.result.includes("boom: 1 failing"), ran.result);
  }

  {
    const empty = path.join(work, "nothing");
    fs.mkdirSync(empty, { recursive: true });
    const detected = await run(testsTool, { action: "detect", path: empty });
    check("no test command is explained", /No test command found/.test(detected.result) && /package\.json/.test(detected.result), detected.result);
  }

  {
    const py = path.join(work, "pyproject");
    fs.mkdirSync(path.join(py, "tests"), { recursive: true });
    fs.writeFileSync(path.join(py, "tests", "test_one.py"), "def test_one():\n    assert True\n");
    const detected = await run(testsTool, { action: "detect", path: py });
    check("pytest is detected from a tests folder", detected.result.includes("pytest") && detected.result.includes("python -m pytest"), detected.result);
  }

  /* ---------------------------------------------------------------------- */
  /* Guided mode: no interpreters                                           */
  /* ---------------------------------------------------------------------- */

  section("guided mode");
  {
    const blocked = await run(processesTool, { action: "start", name: "python", args: "build.py" }, { guided: true });
    check("guided mode refuses to start an interpreter", /does not run interpreters or scripts/.test(blocked.result), blocked.result);
    check("the refusal points at the tests tool", /tests tool/.test(blocked.result), blocked.result);
    check("a refused start asks for no approval", blocked.state.approvals.length === 0);

    const exe = await run(processesTool, { action: "start", name: "C:\\\\Windows\\\\notepad.exe" }, { guided: true, dryRun: true });
    check("an ordinary program is still allowed in guided mode", exe.result.startsWith("DRY RUN:"), exe.result);

    const cwd = await run(processesTool, { action: "start", name: "notepad.exe", cwd: "sub" }, { dryRun: true });
    check("start reports its working folder", cwd.result.includes(path.join(work, "sub")), cwd.result);
  }

  /* ---------------------------------------------------------------------- */
  /* Receipts                                                               */
  /* ---------------------------------------------------------------------- */

  section("file receipts");
  {
    write("notes.txt", "zipped\n");
    const refused = await run(filesTool, { action: "write", path: "notes.txt", content: "other\n" });
    check("writing over a file needs overwrite=true", refused.result.startsWith("Refused:"), refused.result);

    const noProof = await run(filesTool, { action: "write", path: "notes.txt", content: "other\n", overwrite: true });
    check("an overwrite without proof is refused", /Read it first/.test(noProof.result), noProof.result);

    const wrongProof = await run(filesTool, {
      action: "write",
      path: "notes.txt",
      content: "other\n",
      overwrite: true,
      expected: "something-else",
    });
    check("a wrong expected text is refused", /is not in/.test(wrongProof.result), wrongProof.result);
    check("neither refusal changed the file", read("notes.txt") === "zipped\n");

    const replaced = await run(filesTool, {
      action: "write",
      path: "notes.txt",
      content: "other\n",
      overwrite: true,
      expected: "zipped",
    });
    check("an overwrite says what it replaced", /replaced 7 characters/.test(replaced.result), replaced.result);
    check("an overwrite shows the old first line", replaced.result.includes("zipped"), replaced.result);

    const created = await run(filesTool, { action: "write", path: "fresh.txt", content: "new\n" });
    check("a new file is labelled as new", created.result.includes("(new file)"), created.result);

    write("grow.txt", "old\n");
    const appended = await run(filesTool, { action: "append", path: "grow.txt", content: "more\n" });
    check("append says how much was already there", /the file had 4/.test(appended.result), appended.result);
  }

  {
    const badZip = await run(filesTool, { action: "zip", path: "only", destination: "only.zip" });
    check("zip says source, destination - not path", /source = the folder/.test(badZip.result) && /"path" is not used/.test(badZip.result), badZip.result);

    const badUnzip = await run(filesTool, { action: "unzip", path: "only.zip", destination: "out" });
    check("unzip names its source argument", /source = the \.zip/.test(badUnzip.result), badUnzip.result);

    write("only/a.txt", "hello\n");
    const names = await run(filesTool, { action: "search", path: "only", pattern: "*.js" });
    check("a name search with no hits says it searches names", /names/.test(names.result) && /grep/.test(names.result), names.result);

    const contents = await run(filesTool, { action: "grep", path: "only", pattern: "not-there" });
    check("a content search with no hits counts the files", /1 text file/.test(contents.result), contents.result);
  }

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try {
    process.chdir(originalCwd);
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // A locked file in %TEMP% is not a test failure.
  }
}
