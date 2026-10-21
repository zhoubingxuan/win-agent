// The audit log and undo: every change is recorded, and everything that can be
// reversed faithfully is reversed for real - against a temp folder and a temp data
// folder, so your own log and files are never touched.
// Run with: npm run test:audit
//
// What it locks down:
//   - a change is recorded with its tool, action, summary and undo steps
//   - /undo really puts files, registry values, environment variables back
//   - what cannot be reversed faithfully is recorded as NOT undoable, and /undo
//     refuses to pretend otherwise
//   - guided mode keeps the raw shell out of the catalogue (and says why if a model
//     calls it anyway)
//   - switching the audit log off records nothing and empties the undo stack
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuditLog, auditLog, configureAudit } from "../src/audit.js";
import { updateSettings } from "../src/settings.js";
import { createWindowsTools, GUIDED_NO_SHELL } from "../src/tools/index.js";
import { runPowerShell } from "../src/util/ps.js";

const scratch = path.join(os.tmpdir(), `win-agent-audit-${process.pid}`);
// The log lives in the data folder; keep this run out of the real one. dataDir() is
// resolved lazily, so setting this before the first tool call is enough.
process.env.AGENT_DATA_DIR = path.join(scratch, "data");
const work = path.join(scratch, "work");
fs.mkdirSync(work, { recursive: true });
// This suite is about the change log and undo, not about the sandbox: it runs raw
// PowerShell and works in %TEMP%, so the fence - on by default - is switched off
// here. scripts/test-sandbox.mjs is where the fence itself is checked.
updateSettings({ sandbox: false });

let passed = 0;
let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

const tools = createWindowsTools(async () => true, { dryRun: false });
const call = (name, args) => tools.execute(name, JSON.stringify(args));
const undo = (count = 1) => auditLog().undo(count);
const at = (name) => path.join(work, name);

try {
  /* ---------------------------------------------------------------------- */
  /* Files                                                                   */
  /* ---------------------------------------------------------------------- */

  section("a new file is removed again");
  {
    const target = at("new.txt");
    const wrote = await call("files", { action: "write", path: target, content: "hello" });
    check("the write happened", /Wrote 5 characters/.test(wrote), wrote);
    check("the file is there", fs.existsSync(target));

    const result = await undo();
    check("undo reverses that one change", result.ok && result.undone.length === 1, result.message);
    check("the file is gone again", !fs.existsSync(target));
    check("the entry names the tool and the action", result.undone[0].tool === "files" && result.undone[0].action === "write");
    check("undoing again has nothing to do", (await undo()).undone.length === 0);
  }

  section("an overwritten file comes back byte for byte");
  {
    const target = at("utf16.txt");
    // What Notepad or PowerShell 5.1 leaves behind: UTF-16LE with a BOM.
    const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("记得写测试\n", "utf16le")]);
    fs.writeFileSync(target, original);

    await call("files", { action: "write", path: target, content: "plain utf-8 now", overwrite: true });
    check("the file really changed", !fs.readFileSync(target).equals(original));
    await undo();
    check("the old bytes, BOM and encoding are back", fs.readFileSync(target).equals(original));
  }

  section("append and edit");
  {
    const target = at("grow.txt");
    fs.writeFileSync(target, "one\n", "utf8");

    await call("files", { action: "append", path: target, content: "two\n" });
    check("the append landed", fs.readFileSync(target, "utf8") === "one\ntwo\n");
    await undo();
    check("the append is undone", fs.readFileSync(target, "utf8") === "one\n");

    const edited = await call("files", { action: "edit", path: target, find: "one", replace: "1" });
    check("the edit happened", /replaced 1 occurrence/.test(edited), edited);
    await undo();
    check("the edit is undone", fs.readFileSync(target, "utf8") === "one\n");
  }

  section("delete, move, copy");
  {
    const target = at("gone.txt");
    fs.writeFileSync(target, "keep me", "utf8");
    await call("files", { action: "delete", path: target });
    check("the file is gone", !fs.existsSync(target));
    await undo();
    check("the deleted file is back with its bytes",
      fs.existsSync(target) && fs.readFileSync(target, "utf8") === "keep me");

    const tree = at("tree");
    fs.mkdirSync(path.join(tree, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(tree, "a", "b", "deep.txt"), "deep", "utf8");
    await call("files", { action: "delete", path: tree, recursive: true });
    check("the folder tree is gone", !fs.existsSync(tree));
    await undo();
    check("the whole folder tree is back",
      fs.existsSync(path.join(tree, "a", "b", "deep.txt")) &&
        fs.readFileSync(path.join(tree, "a", "b", "deep.txt"), "utf8") === "deep");

    const source = at("move-me.txt");
    const destination = at("moved", "moved.txt");
    fs.writeFileSync(source, "x", "utf8");
    await call("files", { action: "move", source, destination });
    check("the move landed", !fs.existsSync(source) && fs.existsSync(destination));
    await undo();
    check("the move is undone", fs.existsSync(source) && !fs.existsSync(destination));

    // A move onto an existing file replaces it without a word: undo has to put the
    // moved file back *and* restore what the move destroyed.
    const mover = at("onto.txt");
    const replaced = at("replace-me.txt");
    fs.writeFileSync(mover, "the mover", "utf8");
    fs.writeFileSync(replaced, "the replaced", "utf8");
    await call("files", { action: "move", source: mover, destination: replaced });
    check("the destination now holds the moved file", fs.readFileSync(replaced, "utf8") === "the mover");
    await undo();
    check("undo puts the moved file back", fs.existsSync(mover) && fs.readFileSync(mover, "utf8") === "the mover");
    check("and restores what the move replaced", fs.readFileSync(replaced, "utf8") === "the replaced");

    const copyFrom = at("src.txt");
    fs.writeFileSync(copyFrom, "copy me", "utf8");
    const copyTo = at("copy.txt");
    await call("files", { action: "copy", source: copyFrom, destination: copyTo });
    check("the copy is there", fs.existsSync(copyTo));
    await undo();
    check("the copy is removed", !fs.existsSync(copyTo));
  }

  section("folders");
  {
    const fresh = at("fresh-dir");
    await call("files", { action: "mkdir", path: fresh });
    check("the folder exists", fs.existsSync(fresh));
    await undo();
    check("the empty folder is removed", !fs.existsSync(fresh));

    // A folder that was already there is not ours to delete.
    const used = at("used-dir");
    fs.mkdirSync(used, { recursive: true });
    fs.writeFileSync(path.join(used, "keep.txt"), "1", "utf8");
    await call("files", { action: "mkdir", path: used });
    const notOurs = await undo();
    check("mkdir on an existing folder is not undoable", notOurs.undone.length === 0, notOurs.message);
    check("the folder and its content are untouched", fs.existsSync(path.join(used, "keep.txt")));

    // A folder that gained content afterwards must not be thrown away.
    const filled = at("filled-dir");
    await call("files", { action: "mkdir", path: filled });
    fs.writeFileSync(path.join(filled, "later.txt"), "1", "utf8");
    const partial = await undo();
    check("undo reports the folder it could not remove",
      partial.undone.length === 1 && partial.failures.length === 1, JSON.stringify(partial));
    check("what arrived later is still there", fs.existsSync(path.join(filled, "later.txt")));
  }

  section("overwrites that cannot be reversed say so");
  {
    const source = at("src2.txt");
    fs.writeFileSync(source, "new content", "utf8");
    const over = at("over.txt");
    fs.writeFileSync(over, "old content", "utf8");
    await call("files", { action: "copy", source, destination: over, overwrite: true });
    const result = await undo();
    check("copying over an existing file is recorded, not undoable", result.undone.length === 0, result.message);
    check("the overwrite stays", fs.readFileSync(over, "utf8") === "new content");

    const target = at("big.txt");
    await call("files", { action: "write", path: target, content: "x" });
    await undo();
    const entries = auditLog().list(5);
    check("the log still records it", entries.some((entry) => entry.action === "write" && entry.paths.includes(target)));
  }

  /* ---------------------------------------------------------------------- */
  /* The log itself                                                          */
  /* ---------------------------------------------------------------------- */

  section("the log file");
  {
    const file = auditLog().file();
    check("the log lives in the data folder", file.startsWith(path.join(scratch, "data")), file);
    check("the log file exists", fs.existsSync(file), file);

    const lines = fs
      .readFileSync(file, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    check(`every change was recorded (${lines.length})`, lines.length >= 10, String(lines.length));
    check("each line carries the tool, the action and a summary",
      lines.every((line) => line.tool && line.action && line.summary), JSON.stringify(lines[0]));
    check("undo appends its own record, pointing at what it reversed",
      lines.some((line) => line.action === "undo" && typeof line.ref === "number"));
    check("a reversed change is not on the stack again", auditLog().pending().length === 0,
      JSON.stringify(auditLog().pending().map((entry) => entry.seq)));

    const newest = auditLog().list(3);
    check("the newest entries are listed first", newest.length === 3 && newest[0].seq > newest[1].seq,
      newest.map((entry) => entry.seq).join(", "));
  }

  /* ---------------------------------------------------------------------- */
  /* Registry, environment, guided mode                                      */
  /* ---------------------------------------------------------------------- */

  if (process.platform === "win32") {
    section("registry values");
    const KEY = "HKCU:\\Software\\win-agent-audit-test";
    await runPowerShell(
      `Remove-Item -Path '${KEY}' -Recurse -Force -ErrorAction SilentlyContinue; ` +
        `New-Item -Path '${KEY}' -Force | Out-Null`,
    );

    const fresh = await call("registry", { action: "set", path: KEY, name: "Fresh", value: "42", type: "DWord" });
    check("the value was set", /Set HKCU/.test(fresh), fresh);
    await undo();
    const gone = await runPowerShell(
      `[bool](Get-ItemProperty -Path '${KEY}' -Name Fresh -ErrorAction SilentlyContinue)`,
    );
    check("a value that did not exist is removed again", /False/.test(gone.stdout), gone.stdout);

    await call("registry", { action: "set", path: KEY, name: "Keep", value: "first", type: "String" });
    await call("registry", { action: "set", path: KEY, name: "Keep", value: "second", type: "String" });
    await undo();
    const restored = await runPowerShell(`(Get-ItemProperty -Path '${KEY}' -Name Keep).Keep`);
    check("only the last change is undone", /first/.test(restored.stdout) && !/second/.test(restored.stdout), restored.stdout);

    await call("registry", { action: "set", path: KEY, name: "List", value: "b", type: "MultiString" });
    await call("registry", { action: "set", path: KEY, name: "List", value: "a;c", type: "MultiString" });
    await undo();
    const kind = await runPowerShell(
      `$wg = Get-Item -Path '${KEY}'; ` +
        `"$($wg.GetValue('List') -join ',')|$($wg.GetValueKind('List'))"`,
    );
    check("a multi-string keeps its type and its items", kind.stdout.includes("b") && kind.stdout.includes("MultiString"), kind.stdout);

    await call("registry", { action: "delete", path: KEY, name: "Keep" });
    await undo();
    const back = await runPowerShell(`(Get-ItemProperty -Path '${KEY}' -Name Keep).Keep`);
    check("a deleted value is written back", /first/.test(back.stdout), back.stdout);

    await runPowerShell(`Remove-Item -Path '${KEY}' -Recurse -Force -ErrorAction SilentlyContinue`);

    section("environment variables");
    const NAME = "WIN_AGENT_AUDIT_TEST";
    const before = (await runPowerShell(`[Environment]::GetEnvironmentVariable('${NAME}','User')`)).stdout.trim();

    await call("system", { action: "env_set", name: NAME, value: "one", scope: "User" });
    await undo();
    const removed = (await runPowerShell(`[Environment]::GetEnvironmentVariable('${NAME}','User')`)).stdout.trim();
    check("a variable that did not exist is removed again", removed === before, `"${removed}"`);

    await call("system", { action: "env_set", name: NAME, value: "one", scope: "User" });
    await call("system", { action: "env_set", name: NAME, value: "two", scope: "User" });
    await undo();
    const restoredEnv = (await runPowerShell(`[Environment]::GetEnvironmentVariable('${NAME}','User')`)).stdout.trim();
    check("the previous value is restored", restoredEnv === "one", restoredEnv);
    await undo();
    const cleaned = (await runPowerShell(`[Environment]::GetEnvironmentVariable('${NAME}','User')`)).stdout.trim();
    check("the test variable is gone again", cleaned === before, `"${cleaned}"`);
  } else {
    console.log("\nregistry and environment checks only run on Windows - skipped");
  }

  section("draining the stack");
  {
    // The sections above deliberately left a few reversible changes behind (the
    // earlier registry values, for instance); drain them, and prove that a
    // reversed change never comes back.
    let rounds = 0;
    while ((await undo()).undone.length > 0 && rounds++ < 20) {
      // undo one at a time, and never more than the changes that were recorded
    }
    check("everything reversible really was reversed", auditLog().pending().length === 0,
      JSON.stringify(auditLog().pending().map((entry) => [entry.seq, entry.tool, entry.action])));
  }

  section("the log is the stack: it survives a restart");
  {
    const first = at("persisted.txt");
    await call("files", { action: "write", path: first, content: "one" });
    const second = at("persisted-2.txt");
    await call("files", { action: "write", path: second, content: "two" });

    // A second AuditLog over the same data folder is what a restart looks like: the
    // old code kept the stack in memory and would come back empty.
    const reopened = new AuditLog(path.join(scratch, "data"), true);
    check("what can be undone is read back from the log", reopened.pending().length === 2,
      JSON.stringify(reopened.pending().map((entry) => entry.seq)));
    check("the default retention is a week", reopened.retentionDays() === 7, String(reopened.retentionDays()));

    const older = reopened.pending().at(-1);
    const result = await reopened.undoEntry(older.seq);
    check("one specific change can be rolled back", result.ok && result.undone[0]?.seq === older.seq, result.message);
    check("that file is gone", !fs.existsSync(first));
    check("the other file is untouched", fs.existsSync(second));
    check("rolling the same one back again is refused", !(await reopened.undoEntry(older.seq)).ok);
    check("the singleton sees the same stack", auditLog().pending().length === 1,
      JSON.stringify(auditLog().pending().map((entry) => entry.seq)));
    await undo();
    check("and it drains", auditLog().pending().length === 0);
  }

  section("two processes never share a copy name");
  {
    // The web UI and an `--mcp-server` run (or a restart) are separate processes, each
    // with its own counter. A copy name that only counts from zero would let the
    // second write over the first one's snapshot - the older entry would then restore
    // the *newer* content, or refuse to undo at all.
    const target = at("shared.txt");
    fs.writeFileSync(target, "one", "utf8");
    const processA = new AuditLog(path.join(scratch, "data"), true);
    const copyA = await processA.backup(target);
    const entryA = processA.record({
      tool: "files",
      action: "write",
      summary: "wrote one",
      paths: [target],
      steps: [{ kind: "restore", path: target, backup: copyA }],
    });
    fs.writeFileSync(target, "two", "utf8");
    const processB = new AuditLog(path.join(scratch, "data"), true);
    const copyB = await processB.backup(target);
    const entryB = processB.record({
      tool: "files",
      action: "edit",
      summary: "wrote two",
      paths: [target],
      steps: [{ kind: "restore", path: target, backup: copyB }],
    });
    fs.writeFileSync(target, "three", "utf8");

    check("the copies are two different files", copyA !== copyB && fs.existsSync(copyA) && fs.existsSync(copyB), `${copyA} / ${copyB}`);
    check(
      "each copy holds the content of its own moment",
      fs.readFileSync(copyA, "utf8") === "one" && fs.readFileSync(copyB, "utf8") === "two",
      `${fs.readFileSync(copyA, "utf8")} / ${fs.readFileSync(copyB, "utf8")}`,
    );

    const reopened = new AuditLog(path.join(scratch, "data"), true);
    const pending = reopened.pending().map((entry) => entry.seq);
    check("both changes can still be undone", pending.includes(entryA.seq) && pending.includes(entryB.seq), JSON.stringify(pending));
    await reopened.undoEntry(entryB.seq);
    check("undoing the newer change restores its own copy", fs.readFileSync(target, "utf8") === "two", fs.readFileSync(target, "utf8"));
    await reopened.undoEntry(entryA.seq);
    check("and the older one still gets its own content back", fs.readFileSync(target, "utf8") === "one", fs.readFileSync(target, "utf8"));
  }

  /* ---------------------------------------------------------------------- */

  section("copies outlive the server, but not the retention window");
  {
    const target = at("aged.txt");
    fs.writeFileSync(target, "original", "utf8");
    await call("files", { action: "write", path: target, content: "changed", overwrite: true });

    const entry = auditLog().pending().at(-1);
    const backup = entry?.steps.find((step) => step.kind === "restore")?.backup;
    check("the change is undoable and has a copy", Boolean(backup) && fs.existsSync(backup), String(backup));

    // Age the copy past the window, then let a fresh server sweep it.
    const old = new Date(Date.now() - 30 * 86_400_000);
    fs.utimesSync(backup, old, old);
    const fresh = new AuditLog(path.join(scratch, "data"), true);
    await fresh.sweep();
    check("a copy past the window is deleted", !fs.existsSync(backup));
    check("its entry stops pretending it can be undone",
      !auditLog().pending().some((item) => item.seq === entry.seq));
    check("the file is left exactly as it was", fs.readFileSync(target, "utf8") === "changed");
    await undo();
    check("nothing is left on the stack", auditLog().pending().length === 0);
  }

  section("guided mode keeps the raw shell away from the model");
  {
    const guided = createWindowsTools(async () => true, { agentMode: "guided" });
    const normal = createWindowsTools(async () => true, { agentMode: "normal" });

    check("the shell is not offered in guided mode", !guided.names().includes("powershell"), guided.names().join(", "));
    check("it is not sent as a schema either", !guided.schemas().some((tool) => tool.function.name === "powershell"));
    check("the catalogue does not mention it", !/^- powershell:/m.test(guided.describe()), "");
    check("nothing else was taken away", guided.names().length === normal.names().length - 1,
      `${guided.names().length} vs ${normal.names().length}`);
    check("the withheld list names it and says why",
      guided.withheld().some((item) => item.name === "powershell" && item.reason));
    check("normal mode still offers it", normal.names().includes("powershell"));

    const refused = await guided.execute("powershell", JSON.stringify({ script: "Get-Date" }));
    check("calling it anyway answers with the reason and the way out",
      refused.startsWith("Error:") && refused.includes(GUIDED_NO_SHELL) && /system/.test(refused), refused);
    if (process.platform === "win32") {
      check("normal mode would have run it",
        (await normal.execute("powershell", JSON.stringify({ script: "'ok'" }))).includes("ok"));
    }
  }

  section("raw scripts are recorded, never undone");
  if (process.platform === "win32") {
    const tools = createWindowsTools(async () => true, { agentMode: "normal" });
    const before = auditLog().pending().length;
    const output = await tools.execute("powershell", JSON.stringify({ script: "'recorded-marker'" }));
    check("the script ran", output.includes("recorded-marker"), output);
    const newest = auditLog().list(1)[0];
    check("the log keeps the script itself",
      newest?.tool === "powershell" && /recorded-marker/.test(newest.summary) && newest.undoable === false,
      JSON.stringify(newest));
    check("and it never reaches the undo stack", auditLog().pending().length === before);
  }

  section("switched off");
  {
    configureAudit(false);
    check("nothing is recorded while it is off",
      auditLog().record({ tool: "x", action: "y", summary: "z" }) === null);
    const off = await undo();
    check("undo explains that logging is off", !off.ok && /switched off/.test(off.message), off.message);

    const target = at("off.txt");
    await call("files", { action: "write", path: target, content: "x" });
    check("the change itself still happens", fs.existsSync(target));
    check("but it is not on the stack", auditLog().pending().length === 0);

    configureAudit(true);
    await call("files", { action: "write", path: target, content: "y", overwrite: true });
    check("turning it back on records again", auditLog().pending().length === 1);
    await undo();
    check("and that change can be undone", fs.readFileSync(target, "utf8") === "x");
  }
} finally {
  configureAudit(true);
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows can hold a handle briefly; the temp folder is not important.
  }
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
