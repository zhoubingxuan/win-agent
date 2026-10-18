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
import { createWindowsTools } from "../src/tools/index.js";
import { isElevated, powerShellInfo, resolvePowerShell, runPowerShell } from "../src/util/ps.js";

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

const tools = createWindowsTools(async () => true, { dryRun: false });
const call = (name, args) => tools.execute(name, JSON.stringify(args));
const scratch = path.join(os.tmpdir(), `win-agent-test-${process.pid}`);
fs.mkdirSync(scratch, { recursive: true });

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

    const denied = await call("powershell", {
      script: `New-Item -Path (Join-Path $env:ProgramFiles 'win-agent-test.txt') -ItemType File -Force`,
      readOnly: true,
    });
    check("a permission failure is reported", /denied|already exists|administrator/i.test(denied), denied.slice(0, 300));
    if (isElevated() === false) {
      check("a permission failure says what to do about it", /NOT elevated|administrator rights/i.test(denied));
    }
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
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
