// Windows behaviour checks: the tools are run for real, against this machine.
// Run with: npm run test:windows
//
// These are the regressions that only show up on Windows: PowerShell 5.1 vs 7,
// localized error text, UTF-16 files written by Notepad/PowerShell, cmdlets that
// were renamed, and scripts whose variable order was silently wrong.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { buildTaskScript } from "../src/tools/automation.js";
import { updateSettings } from "../src/settings.js";
import { createWindowsTools } from "../src/tools/index.js";
import {
  configureErrorHints,
  detectElevation,
  explainPowerShellError,
  isElevated,
  powerShellInfo,
  resolvePowerShell,
  runPowerShell,
} from "../src/util/ps.js";

let failures = 0;
let passed = 0;
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

if (process.platform !== "win32") {
  console.log("these checks only run on Windows - skipped");
  process.exit(0);
}

// The sandbox (on by default) would refuse the %TEMP% paths this suite uses and
// would withhold the raw shell it calls on purpose. The registry reads that switch
// when it is built, so it has to be off before the first createWindowsTools call.
// scripts/test-sandbox.mjs is where the fence itself is checked.
updateSettings({ sandbox: false });

const tools = createWindowsTools(async () => true, { dryRun: false });
const call = (name, args) => tools.execute(name, JSON.stringify(args));
const scratch = path.join(os.tmpdir(), `win-agent-test-${process.pid}`);
fs.mkdirSync(scratch, { recursive: true });
// These checks change real files, so keep the audit log they produce out of the
// data folder of the copy you are working in (dataDir() is resolved lazily).
process.env.AGENT_DATA_DIR = path.join(scratch, "data");

try {
  /* ---------------------------------------------------------------------- */
  /* PowerShell layer                                                        */
  /* ---------------------------------------------------------------------- */

  section("powershell binary");
  {
    const resolved = resolvePowerShell();
    check("a PowerShell binary is found", resolved.found, resolved.tried.join(", "));
    const info = await powerShellInfo();
    check("the version is reported", /^\d+\.\d+/.test(info.version), info.version);
    check("the edition is Desktop or Core", ["Desktop", "Core"].includes(info.edition), info.edition);
    check("elevation is known or explicitly unknown", info.elevated === null || typeof info.elevated === "boolean");
    check("isElevated() agrees with the probe", isElevated() === info.elevated);
    check("English diagnostics are on by default", info.englishErrors === true);

    // Two callers share one probe. With the elevation probe already cached, the
    // version probe is the only slow part left - and a second caller arriving in
    // that window used to get the half-filled object (elevation known, version
    // empty), which is what the UI panel then showed forever.
    await detectElevation();
    const first = powerShellInfo(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const second = await powerShellInfo();
    check(
      "a second caller during the probe never sees a half-filled answer",
      second.found ? /^\d+\.\d+/.test(second.version) && !!second.edition : true,
      JSON.stringify(second),
    );
    check("both callers end up with the same answer", JSON.stringify(await first) === JSON.stringify(second), JSON.stringify(second));
  }

  section("error messages");
  {
    // A cmdlet error is localized by the OS. The prologue pins the UI culture, so
    // a Chinese/German/Japanese Windows still answers in English - which is what
    // a small model (and the hints below) can actually read.
    const notFound = await call("powershell", {
      script: "Get-Service -Name definitely-not-a-service -ErrorAction Stop",
      readOnly: true,
    });
    check("the error is in English", /Cannot find any service/i.test(notFound), notFound.slice(0, 200));
    check("no CJK characters leak into errors", !/[\u4e00-\u9fff]/.test(notFound), notFound.slice(0, 200));

    // Program Files is the simplest read-only target on a normal install. It is
    // only read-only when this process is *not* elevated, so the check is skipped
    // where it cannot mean anything (and nothing is ever left behind: CI must not
    // leave files on Program Files either).
    const target = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "win-agent-test.txt");
    let blocked = false;
    try {
      if (fs.existsSync(target)) fs.rmSync(target);
    } catch {
      blocked = true;
    }
    if (isElevated() === true || blocked) {
      console.log(`  skip  Program Files is writable here, or holds a file we cannot remove`);
    } else {
      const denied = await call("powershell", {
        script: `New-Item -Path (Join-Path $env:ProgramFiles 'win-agent-test.txt') -ItemType File -Force`,
        readOnly: true,
      });
      check("a permission failure is reported", /denied/i.test(denied), denied.slice(0, 300));
      check("a permission failure says what to do about it", /NOT elevated|administrator rights/i.test(denied));
      try {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      } catch {
        // read-only is the point of the test
      }
    }
  }

  section("error hints and huge output");
  {
    // The hint is the part a small model can act on: "access is denied" on its own
    // sends it back to the same call. Each failure class gets its own sentence.
    const cases = [
      ["a syntax error", "ParserError: At line:1 char:5 + ParserError: Unexpected token '}' in expression or statement.", /syntax error/],
      ["an unknown command", "Get-Thing : The term 'Get-Thing' is not recognized as the name of a cmdlet, function, script file, or operable program.", /does not exist on this machine/],
      ["a locked file", "Copy-Item : The process cannot access the file 'x' because it is being used by another process.", /open in another program/],
      ["an unresolvable host", "Test-Connection : The remote name could not be resolved: 'nope.invalid'", /could not be resolved/],
      ["a missing parameter", "Copy-Item : Cannot bind argument to parameter 'Path' because it is null.", /parameter name or type is wrong/],
      ["a full disk", "Write-Output : There is not enough space on the disk.", /disk is full/],
    ];
    for (const [label, text, pattern] of cases) {
      const hint = explainPowerShellError(text);
      check(`${label} gets its own hint`, pattern.test(hint), hint);
    }
    configureErrorHints("zh");
    check("the hint follows the interface language", /语法错误/.test(explainPowerShellError("ParserError: Unexpected token")));
    configureErrorHints("en");

    // 1.2 million characters: this used to be accumulated into one JS string, so a
    // `Get-Content` of a big log could take the whole agent process with it.
    const big = await runPowerShell("'x' * 1200000", { timeoutMs: 60_000 });
    check("huge output is capped", /characters dropped/.test(big.stdout), String(big.stdout.length));
    check("and the cap is about a megabyte", big.stdout.length < 1_100_000, String(big.stdout.length));
  }

  section("timeouts");
  {
    const started = Date.now();
    const result = await runPowerShell("Start-Sleep -Seconds 30", { timeoutMs: 1_200 });
    const took = Date.now() - started;
    check("a hung script is killed", result.timedOut === true);
    check("it is killed promptly, not waited out", took < 15_000, `${took} ms`);
    check("the result says what happened", /did not finish within/.test(result.stderr), result.stderr.slice(0, 200));
  }

  /* ---------------------------------------------------------------------- */
  /* System                                                                 */
  /* ---------------------------------------------------------------------- */

  section("system");
  {
    const info = JSON.parse(await call("system", { action: "info" }));
    check("the OS is described", typeof info.OS === "string" && info.OS.length > 0, JSON.stringify(info).slice(0, 200));
    check("elevation is part of the info", typeof info.IsAdmin === "boolean");
    check("the PowerShell in use is part of the info", /Desktop|Core/.test(String(info.PowerShell)), String(info.PowerShell));
    check("the time zone is part of the info", typeof info.TimeZone === "string" && info.TimeZone.length > 0);
    const disk = JSON.parse(await call("system", { action: "disk" }));
    check("disks are listed", Array.isArray(disk) && disk.length > 0 && typeof disk[0].Drive === "string");
  }

  section("services");
  {
    // StartType comes from Get-Service only on newer Windows, and this used to
    // throw on older ones. Either source is fine, "unknown" is not.
    const list = JSON.parse(await call("services", { action: "list", filter: "Spooler" }));
    const rows = Array.isArray(list) ? list : [list];
    check("a service is listed", rows.length === 1 && rows[0].Name === "Spooler", JSON.stringify(list));
    check("its status is reported", typeof rows[0].Status === "string" && rows[0].Status.length > 0);
    check("its start type is reported", ["Automatic", "Manual", "Disabled", "Boot", "System"].includes(rows[0].StartType), String(rows[0].StartType));
    const one = JSON.parse(await call("services", { action: "status", name: "Spooler" }));
    check("one service can be read", one.DisplayName.includes("Spooler") || one.Name === "Spooler");
    const missing = await call("services", { action: "status", name: "definitely-not-a-service" });
    check("a missing service fails with advice, not a stack trace", /Error:/.test(missing) && /service name/i.test(missing), missing.slice(0, 200));
  }

  /* ---------------------------------------------------------------------- */
  /* Network                                                                */
  /* ---------------------------------------------------------------------- */

  section("network");
  {
    const ping = JSON.parse(await call("network", { action: "ping", host: "127.0.0.1", count: 2, timeout: 2000 }));
    check("localhost answers both pings", ping.Received === 2 && ping.Lost === 0, JSON.stringify(ping));
    check("the round trip is measured", typeof ping.AvgMs === "number");
    check("no PowerShell interpolation leaked into the output", !JSON.stringify(ping).includes("${"));

    // A real listener on a free port, so "open" is actually verified.
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const openPort = listener.address().port;
    const open = await call("network", { action: "port_check", host: "127.0.0.1", port: openPort, timeout: 4000 });
    check("an open port is detected", open.startsWith("OPEN:"), open.slice(0, 200));
    check("the output names the real port", open.includes(`:${openPort}`), open.slice(0, 80));
    check("no literal ${host} in the port check", !open.includes("${"));
    await new Promise((resolve) => listener.close(resolve));

    const closed = await call("network", {
      action: "port_check",
      host: "127.0.0.1",
      port: openPort,
      timeout: 1_500,
    });
    check("a closed port is detected", closed.startsWith("CLOSED/FILTERED:"), closed.slice(0, 200));

    const conns = JSON.parse(await call("network", { action: "connections" }));
    check("listening ports are listed", Array.isArray(conns) && conns.length > 0 && typeof conns[0].LocalPort === "number");
    check("each listening port names a process or a pid", "Process" in conns[0] && "PID" in conns[0], JSON.stringify(conns[0]));
  }

  /* ---------------------------------------------------------------------- */
  /* Files: the encodings Windows actually writes                           */
  /* ---------------------------------------------------------------------- */

  section("files");
  {
    // What Notepad's "Unicode" and PowerShell 5.1's Out-File produce.
    const utf16File = path.join(scratch, "utf16.txt");
    fs.writeFileSync(utf16File, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("第一行\r\nsecond\r\n", "utf16le")]));

    const read = await call("files", { action: "read", path: utf16File });
    check("a UTF-16 file reads as text", read.includes("第一行") && read.includes("second"), JSON.stringify(read.slice(0, 60)));
    check("no NUL bytes survive the decode", !read.includes("\u0000"));

    const edited = await call("files", {
      action: "edit",
      path: utf16File,
      find: "second",
      replace: "SECOND",
    });
    check("a UTF-16 file can be edited", edited.includes("replaced 1 occurrence"), edited.slice(0, 200));
    const raw = fs.readFileSync(utf16File);
    check("editing keeps the UTF-16 encoding", raw[0] === 0xff && raw[1] === 0xfe, raw.subarray(0, 4).toString("hex"));
    check("the edited text is still UTF-16", raw.toString("utf16le").includes("SECOND"));

    const appended = await call("files", { action: "append", path: utf16File, content: "第三行\n" });
    check("appending to a UTF-16 file works", appended.includes("Appended"), appended);
    const rawAfter = fs.readFileSync(utf16File);
    check("appending did not corrupt the encoding", rawAfter[0] === 0xff && rawAfter[1] === 0xfe);
    check("the appended text is readable", rawAfter.toString("utf16le").includes("第三行"));

    const utf8File = path.join(scratch, "utf8.txt");
    await call("files", { action: "write", path: utf8File, content: "plain utf-8\n" });
    const utf8Raw = fs.readFileSync(utf8File);
    check("a new file is written as UTF-8 without a BOM", utf8Raw[0] === 0x70, utf8Raw.subarray(0, 4).toString("hex"));

    const binaryFile = path.join(scratch, "image.png");
    fs.writeFileSync(binaryFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x01]));
    const binaryRead = await call("files", { action: "read", path: binaryFile });
    check("a binary file is refused instead of dumped", binaryRead.startsWith("Refused:") && binaryRead.includes("binary"), binaryRead.slice(0, 200));

    const grep = await call("files", { action: "grep", path: scratch, pattern: "SECOND", depth: 2, max: 10 });
    check("grep matches inside a UTF-16 file", grep.includes("utf16.txt:2:"), grep.slice(0, 200));
    check("grep skips the binary file", !grep.includes("image.png"), grep.slice(0, 200));
  }

  section("registry");
  {
    const key = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
    const values = JSON.parse(await call("registry", { action: "get", path: key }));
    check("a registry key reads", values.ProductName || values.CurrentVersion, JSON.stringify(values).slice(0, 200));
    const missing = await call("registry", { action: "get", path: "HKLM:\\SOFTWARE\\NoSuchKey-win-agent" });
    check("a missing key is a clear message", missing.includes("does not exist"), missing.slice(0, 120));
  }

  /* ---------------------------------------------------------------------- */
  /* Scheduled tasks: the script is checked, nothing is registered          */
  /* ---------------------------------------------------------------------- */

  section("scheduled tasks (script only)");
  {
    const { script, when } = buildTaskScript({
      name: "win-agent-test",
      program: "C:\\Windows\\System32\\cmd.exe",
      args: "/c echo hi",
      schedule: "DAILY",
      time: "23:30",
    });
    const assignAt = script.indexOf("$gwStart = (Get-Date).AddMinutes(5)");
    const parseAt = script.indexOf("$gwRaw = '23:30'");
    const useAt = script.indexOf("-At $gwStart");
    check("the requested time is in the script", script.includes("'23:30'"), script);
    check("the time is parsed before the trigger uses it", assignAt >= 0 && parseAt > assignAt && useAt > parseAt, script);
    check("the result message names the schedule", /daily starting 23:30/.test(when), when);
    check("the program and its arguments are quoted", script.includes("-Execute 'C:\\Windows\\System32\\cmd.exe'") && script.includes("-Argument '/c echo hi'"));

    const logon = buildTaskScript({ name: "t", program: "cmd.exe", args: "", schedule: "ONLOGON", time: "" });
    check("an at-logon task needs no time", logon.script.includes("-AtLogOn") && logon.when === "at logon");
    const startup = buildTaskScript({ name: "t", program: "cmd.exe", args: "", schedule: "ONSTART", time: "" });
    check("an at-startup task needs no time", startup.script.includes("-AtStartup"));
    const hourly = buildTaskScript({ name: "t", program: "cmd.exe", args: "", schedule: "HOURLY", time: "08:00" });
    check("an hourly task repeats every hour", hourly.script.includes("-RepetitionInterval (New-TimeSpan -Hours 1)"));
    const noTime = buildTaskScript({ name: "t", program: "cmd.exe", args: "", schedule: "DAILY", time: "" });
    check("a missing time falls back to five minutes from now", noTime.script.includes("AddMinutes(5)") && noTime.when.includes("5 minutes"));

    const list = await call("scheduled_tasks", { action: "list" });
    check("scheduled tasks can be listed", /^\[|No user scheduled tasks/.test(list.trim()), list.slice(0, 120));
  }
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows can hold a handle briefly (an antivirus scan, a PowerShell that has
    // just exited): a temp folder left behind must not turn the whole suite red.
  }
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
