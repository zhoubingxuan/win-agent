// Real desktop-control check: start two WinForms windows in one PowerShell
// process, then drive them through the `ui` tool. The process also has a console
// window, and at least one form is not its MainWindowHandle, so window_focus has
// to use the same handle-based lookup as window_list instead of
// Get-Process.MainWindowHandle.
//
// This needs an interactive Windows desktop. Run with: npm run test:ui:real
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uiTool } from "../src/tools/ui.js";
import { psQuote, runPs } from "../src/util/ps.js";

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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  } catch {
    return "";
  }
}
async function waitForText(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = readText(file);
    if (text) return text;
    await sleep(100);
  }
  return "";
}
function parseWindowRows(text) {
  const lines = text.split(/\r?\n/).slice(1);
  return lines
    .map((line) => {
      const [handle, process, title, bounds] = line.split(" | ");
      return { handle, process, title, bounds };
    })
    .filter((row) => row.title?.startsWith("win-agent-ui-real-"));
}
function parseBounds(bounds) {
  const match = /^(-?\d+),(-?\d+) (\d+)x(\d+)$/.exec(bounds ?? "");
  if (!match) return null;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  };
}

const ctx = {
  dryRun: false,
  guided: false,
  approve: async () => true,
  backup: async () => null,
  record: () => null,
};

if (process.platform !== "win32") {
  console.log("SKIP: this test needs Windows.");
  process.exit(0);
}

const id = `${process.pid}-${Date.now().toString(36)}`;
const mainTitle = `win-agent-ui-real-main-${id}`;
const secondTitle = `win-agent-ui-real-second-${id}`;
const temp = os.tmpdir();
const scriptPath = path.join(temp, `win-agent-ui-real-${id}.ps1`);
const outPath = path.join(temp, `win-agent-ui-real-${id}.txt`);
const activePath = path.join(temp, `win-agent-ui-real-${id}.active`);
const mainPointPath = path.join(temp, `win-agent-ui-real-${id}-main.point`);
const secondPointPath = path.join(temp, `win-agent-ui-real-${id}-second.point`);

const formScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:outFile = $env:WIN_AGENT_UI_REAL_OUT
$script:activeFile = $env:WIN_AGENT_UI_REAL_ACTIVE
$script:mainPointFile = $env:WIN_AGENT_UI_REAL_POINT_MAIN
$script:secondPointFile = $env:WIN_AGENT_UI_REAL_POINT_SECOND

$script:main = New-Object System.Windows.Forms.Form
$script:main.Text = ${psQuote(mainTitle)}
$script:main.StartPosition = 'Manual'
$script:main.Left = 100
$script:main.Top = 100
$script:main.Width = 420
$script:main.Height = 240
$script:mainBox = New-Object System.Windows.Forms.TextBox
$script:mainBox.Left = 20
$script:mainBox.Top = 20
$script:mainBox.Width = 360
$script:mainBox.Add_TextChanged({
  try { Set-Content -LiteralPath $script:outFile -Value $this.Text -Encoding UTF8 } catch {}
})
$script:main.Controls.Add($script:mainBox)
$script:main.Add_Shown({
  $script:main.Activate()
  $script:mainBox.Focus()
  try {
    $point = $script:mainBox.PointToScreen([System.Drawing.Point]::new(5, 5))
    Set-Content -LiteralPath $script:mainPointFile -Value "$($point.X),$($point.Y)" -Encoding UTF8
  } catch {}
})
$script:main.Add_Activated({
  try { Set-Content -LiteralPath $script:activeFile -Value 'main' -Encoding UTF8 } catch {}
})

$script:second = New-Object System.Windows.Forms.Form
$script:second.Text = ${psQuote(secondTitle)}
$script:second.StartPosition = 'Manual'
$script:second.Left = 560
$script:second.Top = 100
$script:second.Width = 420
$script:second.Height = 240
$script:secondBox = New-Object System.Windows.Forms.TextBox
$script:secondBox.Left = 20
$script:secondBox.Top = 20
$script:secondBox.Width = 360
$script:secondBox.Add_TextChanged({
  try { Set-Content -LiteralPath $script:outFile -Value $this.Text -Encoding UTF8 } catch {}
})
$script:second.Controls.Add($script:secondBox)
$script:second.Add_Shown({
  $script:second.Activate()
  $script:secondBox.Focus()
  try {
    $point = $script:secondBox.PointToScreen([System.Drawing.Point]::new(5, 5))
    Set-Content -LiteralPath $script:secondPointFile -Value "$($point.X),$($point.Y)" -Encoding UTF8
  } catch {}
})
$script:second.Add_Activated({
  try { Set-Content -LiteralPath $script:activeFile -Value 'second' -Encoding UTF8 } catch {}
})

$script:second.Show()
[System.Windows.Forms.Application]::Run($script:main)
`;

let pid = 0;
try {
  fs.writeFileSync(scriptPath, formScript, "utf8");
  process.env.WIN_AGENT_UI_REAL_OUT = outPath;
  process.env.WIN_AGENT_UI_REAL_ACTIVE = activePath;
  process.env.WIN_AGENT_UI_REAL_POINT_MAIN = mainPointPath;
  process.env.WIN_AGENT_UI_REAL_POINT_SECOND = secondPointPath;

  section("start");
  const start = await runPs(
    [
      "$p = Start-Process -FilePath 'powershell.exe' " +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', ${psQuote(scriptPath)}) ` +
        "-PassThru",
      "$p.Id",
    ].join("\n"),
  );
  pid = Number(start.trim());
  check("the WinForms process started", Number.isInteger(pid) && pid > 0, start);

  const waited = await uiTool.run(
    { action: "window_wait", title: secondTitle, process: "powershell", exact: true, ms: 10_000 },
    ctx,
  );
  check("window_wait finds the new window", waited.includes("Found") && waited.includes(secondTitle), waited);

  let timedOut = false;
  try {
    await uiTool.run({ action: "window_wait", title: `win-agent-ui-real-missing-${id}`, ms: 500 }, ctx);
  } catch {
    timedOut = true;
  }
  check("window_wait times out for a missing window", timedOut);

  let list = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    list = await uiTool.run({ action: "window_list", filter: "win-agent-ui-real" }, ctx);
    if (list.includes(mainTitle) && list.includes(secondTitle)) break;
    await sleep(250);
  }
  const rows = parseWindowRows(list);
  check(
    "window_list shows both top-level windows",
    rows.some((row) => row.title === mainTitle) && rows.some((row) => row.title === secondTitle),
    list,
  );

  const mainHandle = (
    await runPs(`(Get-Process -Id ${pid} -ErrorAction Stop).MainWindowHandle.ToInt64().ToString()`)
  ).trim();
  const target =
    mainHandle && mainHandle !== "0"
      ? rows.find((row) => row.handle !== mainHandle)
      : rows.find((row) => row.title === secondTitle);
  const other = rows.find((row) => row.title !== target?.title);
  check("found a window that is not the process main window", Boolean(target && other), `main=${mainHandle}\n${list}`);
  if (!target || !other) throw new Error("could not identify the two test windows");
  check("the target is not the process main window", target.handle !== mainHandle, `target=${target.handle} main=${mainHandle}`);

  section("focus");
  const ambiguous = await uiTool.run(
    { action: "window_focus", title: "win-agent-ui-real", process: "powershell" },
    ctx,
  );
  check(
    "window_focus warns when several windows match",
    ambiguous.includes("windows matched") && ambiguous.includes("Use handle"),
    ambiguous,
  );
  const otherFocus = await uiTool.run(
    { action: "window_focus", title: other.title, process: "powershell", exact: true },
    ctx,
  );
  check("window_focus focuses the other test window", otherFocus.includes("Focused"), otherFocus);
  fs.rmSync(activePath, { force: true });
  const targetFocus = await uiTool.run(
    { action: "window_focus", title: target.title, process: "powershell", exact: true },
    ctx,
  );
  check(
    "window_focus focuses a non-main window by title",
    targetFocus.includes("Focused") && targetFocus.includes(target.title),
    targetFocus,
  );
  const active = await waitForText(activePath, 3_000);
  check(
    "the requested non-main window is actually active",
    active === (target.title === mainTitle ? "main" : "second"),
    `active=${active}`,
  );
  const handleFocus = await uiTool.run({ action: "window_focus", handle: target.handle }, ctx);
  check(
    "window_focus focuses by handle",
    handleFocus.includes("Focused") && handleFocus.includes(target.handle),
    handleFocus,
  );

  section("state");
  const maximize = await uiTool.run(
    { action: "window_state", state: "maximize", title: target.title, process: "powershell", exact: true },
    ctx,
  );
  check("window_state maximizes the target", maximize.includes("Maximized"), maximize);
  const restore = await uiTool.run(
    { action: "window_state", state: "restore", title: target.title, process: "powershell", exact: true },
    ctx,
  );
  check("window_state restores the target", restore.includes("Restored"), restore);

  section("typing");
  const pointFile = target.title === mainTitle ? mainPointPath : secondPointPath;
  const point = await waitForText(pointFile, 3_000);
  const pointMatch = /^(-?\d+),(-?\d+)$/.exec(point);
  check("the form reported its text-box position", Boolean(pointMatch), point);
  if (!pointMatch) throw new Error("could not read the text-box position");
  const pointX = Number(pointMatch[1]);
  const pointY = Number(pointMatch[2]);
  const typed = await uiTool.run(
    {
      action: "type",
      text: "hello",
      window: target.title,
      process: "powershell",
      exact: true,
      x: pointX + 10,
      y: pointY + 10,
    },
    ctx,
  );
  check("type reports five characters", typed.includes("5 characters"), typed);
  const typedText = await waitForText(outPath, 3_000);
  check("the target text box received the typed text", typedText.includes("hello"), `text=${JSON.stringify(typedText)}`);

  section("move and resize");
  const move = await uiTool.run(
    {
      action: "window_state",
      state: "move",
      title: target.title,
      process: "powershell",
      exact: true,
      x: 300,
      y: 300,
    },
    ctx,
  );
  check("window_state moves the target", move.includes("Moved") && move.includes("300,300"), move);
  const resize = await uiTool.run(
    {
      action: "window_state",
      state: "resize",
      title: target.title,
      process: "powershell",
      exact: true,
      width: 500,
      height: 320,
    },
    ctx,
  );
  check("window_state resizes the target", resize.includes("Resized") && resize.includes("500x320"), resize);
  const movedList = await uiTool.run({ action: "window_list", filter: target.title }, ctx);
  const movedRow = parseWindowRows(movedList).find((row) => row.title === target.title);
  const movedBounds = parseBounds(movedRow?.bounds);
  check(
    "window_list reports the new bounds",
    Boolean(
      movedBounds &&
        Math.abs(movedBounds.x - 300) <= 2 &&
        Math.abs(movedBounds.y - 300) <= 2 &&
        Math.abs(movedBounds.width - 500) <= 2 &&
        Math.abs(movedBounds.height - 320) <= 2,
    ),
    movedRow?.bounds ?? movedList,
  );

  section("close");
  const closed = await uiTool.run(
    { action: "window_state", state: "close", title: target.title, process: "powershell", exact: true },
    ctx,
  );
  check("window_state closes or requests close", closed.includes("Closed") || closed.includes("Requested close"), closed);
  await sleep(500);
  const after = await uiTool.run({ action: "window_list", filter: target.title }, ctx);
  check("the closed window is gone", after.includes("(no windows match"), after);
} catch (error) {
  check("the real desktop test completed", false, (error instanceof Error ? error.message : String(error)));
} finally {
  if (pid > 0) {
    try {
      await runPs(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
    } catch {
      // The process may already have exited after its main form closed.
    }
  }
  for (const file of [scriptPath, outPath, activePath, mainPointPath, secondPointPath]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
