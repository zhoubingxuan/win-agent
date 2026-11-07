import fs from "node:fs";
import path from "node:path";
import { arg, argBool, argEnum, argNum, argOpt, type Tool, type ToolResult } from "./registry.js";
import { psQuote, runPs } from "../util/ps.js";
import { dataDir } from "../store.js";
import { readImageFile } from "../images.js";

const ACTIONS = [
  "clipboard_get",
  "clipboard_set",
  "screenshot",
  "open",
  "notify",
  "move",
  "click",
  "type",
  "key",
  "scroll",
  "window_list",
  "window_focus",
  "wait",
] as const;

/** Virtual-key codes used by `ui key`. */
const VK: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  pause: 0x13,
  capslock: 0x14,
  esc: 0x1b,
  escape: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pgup: 0x21,
  pagedown: 0x22,
  pgdn: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  printscreen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  del: 0x2e,
  win: 0x5b,
  meta: 0x5b,
  lwin: 0x5b,
  rwin: 0x5c,
  numlock: 0x90,
  scrolllock: 0x91,
  semicolon: 0xba,
  equals: 0xbb,
  plus: 0xbb,
  comma: 0xbc,
  minus: 0xbd,
  period: 0xbe,
  slash: 0xbf,
  backtick: 0xc0,
  grave: 0xc0,
  bracketleft: 0xdb,
  backslash: 0xdc,
  bracketright: 0xdd,
  quote: 0xde,
  ";": 0xba,
  "=": 0xbb,
  "+": 0xbb,
  ",": 0xbc,
  "-": 0xbd,
  ".": 0xbe,
  "/": 0xbf,
  "`": 0xc0,
  "[": 0xdb,
  "\\": 0xdc,
  "]": 0xdd,
  "'": 0xde,
};

/** Parse "ctrl+shift+s", "alt+tab", "f5" or "enter" into virtual-key codes. */
export function parseKeyCombo(combo: string): number[] {
  const parts = combo
    .trim()
    .toLowerCase()
    .split("+")
    .map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === "")) {
    throw new Error('key must look like "ctrl+s", "alt+tab" or "f5"');
  }

  const codes: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isLast = index === parts.length - 1;
    const modifier = VK[part];
    if (!isLast && modifier !== undefined && [0x10, 0x11, 0x12, 0x5b, 0x5c].includes(modifier)) {
      codes.push(modifier);
      continue;
    }
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(part)) {
      codes.push(0x70 + Number(part.slice(1)) - 1);
      continue;
    }
    if (/^[a-z0-9]$/.test(part)) {
      codes.push(part.toUpperCase().charCodeAt(0));
      continue;
    }
    const code = VK[part];
    if (code === undefined) {
      throw new Error(`unknown key "${part}" in "${combo}"`);
    }
    codes.push(code);
  }
  return codes;
}

/** The C# helpers shared by every desktop action. One PowerShell process per call. */
const WIN_UI_TYPE = String.raw`
using System;
using System.Runtime.InteropServices;
public static class WinAgentUi {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  // INPUT is a tagged union. The explicit size/offset matches 64-bit Windows,
  // where SendInput expects 40 bytes per item. The mouse member makes the union
  // the right size even though this code only sends keyboard events.
  [StructLayout(LayoutKind.Explicit, Size = 40)]
  public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public KEYBDINPUT ki;
    [FieldOffset(8)] public MOUSEINPUT mi;
  }

  public static void Click(int x, int y, bool move, string button, int clicks) {
    if (move) SetCursorPos(x, y);
    uint down = 0x0002;
    uint up = 0x0004;
    if (button == "right") { down = 0x0008; up = 0x0010; }
    else if (button == "middle") { down = 0x0020; up = 0x0040; }
    for (int i = 0; i < clicks; i++) {
      mouse_event(down, 0, 0, 0, UIntPtr.Zero);
      mouse_event(up, 0, 0, 0, UIntPtr.Zero);
      if (i + 1 < clicks) System.Threading.Thread.Sleep(80);
    }
  }

  public static void PressKeys(int[] keys) {
    for (int i = 0; i < keys.Length; i++) keybd_event((byte)keys[i], 0, 0, UIntPtr.Zero);
    for (int i = keys.Length - 1; i >= 0; i--) keybd_event((byte)keys[i], 0, 2, UIntPtr.Zero);
  }

  public static void TypeText(string text) {
    foreach (char c in text) {
      if (c == '\r') continue;
      if (c == '\n') { PressKeys(new int[] { 0x0D }); continue; }
      if (c == '\t') { PressKeys(new int[] { 0x09 }); continue; }
      INPUT down = new INPUT();
      down.type = 1;
      down.ki.wScan = (ushort)c;
      down.ki.dwFlags = 0x0004;
      INPUT up = new INPUT();
      up.type = 1;
      up.ki.wScan = (ushort)c;
      up.ki.dwFlags = 0x0004 | 0x0002;
      INPUT[] inputs = new INPUT[] { down, up };
      uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
      if (sent != 2) throw new Exception("SendInput failed: " + Marshal.GetLastWin32Error());
    }
  }

  public static void Scroll(int amount) {
    mouse_event(0x0800, 0, 0, amount * 120, UIntPtr.Zero);
  }

  public static bool IsForeground(IntPtr hWnd) {
    return GetForegroundWindow() == hWnd;
  }

  public static string Focus(IntPtr hWnd) {
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
    uint pid;
    uint currentThread = GetCurrentThreadId();
    uint targetThread = GetWindowThreadProcessId(hWnd, out pid);
    IntPtr foreground = GetForegroundWindow();
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out pid);
    // SetForegroundWindow is refused when the caller is not the foreground
    // process. Attach this thread to both the old foreground thread and the
    // target thread, then use the synthetic-Alt trick and SwitchToThisWindow.
    bool attachForeground =
      foregroundThread != 0 && foregroundThread != currentThread &&
      AttachThreadInput(currentThread, foregroundThread, true);
    bool attachTarget =
      targetThread != 0 && targetThread != currentThread &&
      AttachThreadInput(currentThread, targetThread, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    BringWindowToTop(hWnd);
    ShowWindow(hWnd, 5);
    SwitchToThisWindow(hWnd, true);
    SetForegroundWindow(hWnd);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (attachTarget) AttachThreadInput(currentThread, targetThread, false);
    if (attachForeground) AttachThreadInput(currentThread, foregroundThread, false);
    return IsForeground(hWnd) ? "focused" : "could not focus (Windows refused the foreground switch)";
  }
}
`;

function winUiScript(body: string): string {
  return [`Add-Type -TypeDefinition @'`, WIN_UI_TYPE, `'@`, body].join("\n");
}

interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function parseScreenBounds(raw: string): ScreenBounds | null {
  const line = raw.trim().split(/\r?\n/).pop() ?? "";
  const match = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(line);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
}

interface WindowRow {
  handle?: string;
  process?: string;
  title?: string;
  minimized?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function parseWindowRows(raw: string): WindowRow[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as WindowRow | WindowRow[] | null;
  if (parsed === null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function formatWindowList(rows: WindowRow[]): string {
  if (rows.length === 0) return "(no visible windows)";
  const lines = ["handle | process | title | x,y widthxheight"];
  for (const row of rows) {
    const bounds = row.minimized
      ? "minimized"
      : row.x === undefined || row.y === undefined || row.width === undefined || row.height === undefined
        ? "?"
        : `${row.x},${row.y} ${row.width}x${row.height}`;
    lines.push(`${row.handle ?? "?"} | ${row.process ?? "?"} | ${row.title ?? ""} | ${bounds}`);
  }
  return lines.join("\n");
}

/** PowerShell that finds a window by handle or title substring. */
function windowTarget(handle?: string, title?: string): string {
  return handle
    ? `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowHandle.ToInt64().ToString() -eq ${psQuote(handle)} } | Select-Object -First 1`
    : `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.IndexOf(${psQuote(title!)}, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1`;
}

/**
 * Focus a named window inside the same PowerShell process that performs the
 * action. A separate `window_focus` call is not enough: starting a new hidden
 * PowerShell can move the foreground back to the previous app, so the click or
 * keystroke would land in the wrong window.
 */
function focusLines(handle?: string, title?: string): string[] {
  if (!handle && !title) return [];
  return [
    `$target = ${windowTarget(handle, title)}`,
    `if (-not $target) { throw ${psQuote(`window not found: ${handle ?? title}`)} }`,
    "$result = [WinAgentUi]::Focus($target.MainWindowHandle)",
    "if ($result -ne 'focused') {",
    "  $shell = New-Object -ComObject WScript.Shell",
    "  [void]$shell.AppActivate($target.Id)",
    "  Start-Sleep -Milliseconds 250",
    "  if ([WinAgentUi]::IsForeground($target.MainWindowHandle)) { $result = 'focused' }",
    "}",
    "if ($result -ne 'focused') { throw 'could not focus window' }",
    "Start-Sleep -Milliseconds 120",
  ];
}

function screenshotText(out: string, screen: ScreenBounds | null, image?: { width?: number; height?: number }): string {
  const screenText = screen ? ` Screen ${screen.width}x${screen.height} at ${screen.x},${screen.y}.` : "";
  if (!image?.width || !image.height) {
    return `Screenshot saved to ${out}.${screenText}`;
  }
  if (!screen) {
    return `Screenshot saved to ${out}. Attached image ${image.width}x${image.height}.`;
  }
  const scale = screen.width / image.width;
  const mapping =
    Math.abs(scale - 1) < 0.01
      ? "The attached image is 1:1 with screen pixels."
      : `The attached image is ${image.width}x${image.height}; multiply image coordinates by ${scale.toFixed(2)} for ui click.`;
  return `Screenshot saved to ${out}.${screenText} ${mapping}`;
}

export const uiTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "ui",
      description:
        "Interact with the Windows desktop. actions: clipboard_get, clipboard_set, " +
        "screenshot (capture the screen and, when the model can see images, attach it), " +
        "open (open a file, folder or URL in the default app), notify (show a popup message), " +
        "move (move the pointer to screen x,y), click (click at screen x,y), type (type text " +
        "into the active window), key (press a key combination), scroll (wheel up/down), " +
        "window_list (visible windows with handles and bounds), window_focus (bring a window " +
        "to the front), wait (pause for ms). click/type/key/scroll accept window or handle to " +
        "focus that app in the same PowerShell call before acting. Screen coordinates are " +
        "pixels; screenshot reports the scale when its image is smaller than the screen.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          text: { type: "string", description: "Text for clipboard_set, notify or type." },
          title: { type: "string", description: "Title for notify, or a window-title substring for window_focus." },
          window: {
            type: "string",
            description:
              "Window-title substring to focus before click, type, key or scroll. Use this instead of a separate window_focus when the next action must land in a specific app.",
          },
          target: { type: "string", description: "File, folder or URL for open." },
          path: {
            type: "string",
            description: "Destination PNG path for screenshot. Omit to save under data/screenshots.",
          },
          send_to_model: {
            type: "boolean",
            description: "For screenshot: attach the image to the conversation (default true).",
          },
          x: { type: "integer", description: "Screen x coordinate for move, click or scroll." },
          y: { type: "integer", description: "Screen y coordinate for move, click or scroll." },
          button: {
            type: "string",
            enum: ["left", "right", "middle"],
            description: "Mouse button for click (default left).",
          },
          clicks: {
            type: "integer",
            description: "Number of clicks, 1-3 (default 1). Use 2 for a double-click.",
          },
          key: {
            type: "string",
            description: 'Key combination for key, e.g. "ctrl+s", "alt+tab", "win+r", "f5" or "enter".',
          },
          amount: {
            type: "integer",
            description: "Scroll notches for scroll; positive is up, negative is down (default 3).",
          },
          handle: {
            type: "string",
            description:
              "Window handle from window_list, for window_focus or to target click, type, key or scroll.",
          },
          ms: {
            type: "integer",
            description: "Milliseconds to wait for wait (0-60000).",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", ACTIONS);

    switch (action) {
      case "clipboard_get": {
        const text = await runPs("Get-Clipboard -Raw");
        return text === "" ? "(clipboard is empty)" : text;
      }

      case "clipboard_set": {
        const text = arg(args, "text");
        if (ctx.dryRun) return `DRY RUN: would copy ${text.length} chars to clipboard.`;
        await runPs(`Set-Clipboard -Value ${psQuote(text)}`);
        return `Copied ${text.length} characters to the clipboard.`;
      }

      case "screenshot": {
        const out =
          argOpt(args, "path")?.trim() ||
          path.join(dataDir(), "screenshots", `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
        if (ctx.dryRun) return `DRY RUN: would save a screenshot to ${out}.`;
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const screenRaw = await runPs(
          [
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
            "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
            "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
            "$g = [System.Drawing.Graphics]::FromImage($bmp)",
            "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
            `$bmp.Save(${psQuote(out)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
            "$g.Dispose(); $bmp.Dispose()",
            'Write-Output "$($b.X),$($b.Y),$($b.Width),$($b.Height)"',
          ].join("\n"),
        );
        const screen = parseScreenBounds(screenRaw);

        if (!argBool(args, "send_to_model", true)) return screenshotText(out, screen);

        // A 4K PNG can be several megabytes and is not what a vision endpoint
        // wants. Make a model-sized JPEG; the original stays on disk for the user.
        const prepared = `${out.replace(/\.png$/i, "")}.model.jpg`;
        try {
          await runPs(
            [
              "Add-Type -AssemblyName System.Drawing",
              `$src = [System.Drawing.Image]::FromFile(${psQuote(out)})`,
              "$scale = [Math]::Min(1.0, [Math]::Min(1600 / $src.Width, 1600 / $src.Height))",
              "$w = [Math]::Max(1, [int]($src.Width * $scale))",
              "$h = [Math]::Max(1, [int]($src.Height * $scale))",
              "$bmp = New-Object System.Drawing.Bitmap $w, $h",
              "$g = [System.Drawing.Graphics]::FromImage($bmp)",
              "$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
              "$g.DrawImage($src, 0, 0, $w, $h)",
              "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
              "$params = New-Object System.Drawing.Imaging.EncoderParameters 1",
              "$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85",
              `$bmp.Save(${psQuote(prepared)}, $codec, $params)`,
              "$g.Dispose(); $bmp.Dispose(); $src.Dispose()",
            ].join("\n"),
          );
          const image = readImageFile(prepared, path.basename(out));
          fs.rmSync(prepared, { force: true });
          return {
            text: screenshotText(out, screen, image),
            images: [image],
          } satisfies ToolResult;
        } catch (error) {
          // Keep the screenshot even when the model-sized copy failed; if the
          // original is small enough, attach that instead.
          try {
            const image = readImageFile(out);
            return {
              text: screenshotText(out, screen, image),
              images: [image],
            } satisfies ToolResult;
          } catch {
            return `${screenshotText(out, screen)} It could not be attached to the conversation (${(error as Error).message}).`;
          }
        }
      }

      case "open": {
        const target = arg(args, "target");
        if (ctx.dryRun) return `DRY RUN: would open ${target}.`;
        await runPs(`Start-Process ${psQuote(target)}`);
        return `Opened ${target}.`;
      }

      case "notify": {
        const text = arg(args, "text");
        const title = args.title === undefined ? "Agent" : arg(args, "title");
        if (ctx.dryRun) return `DRY RUN: would show notification "${text}".`;
        await runPs(
          `(New-Object -ComObject WScript.Shell).Popup(${psQuote(text)}, 8, ${psQuote(title)}, 64) | Out-Null`,
        );
        return "Notification shown.";
      }

      case "move": {
        const x = argNum(args, "x", Number.NaN);
        const y = argNum(args, "y", Number.NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("move needs both x and y");
        if (ctx.dryRun) return `DRY RUN: would move the pointer to ${Math.round(x)},${Math.round(y)}.`;
        await runPs(winUiScript(`[WinAgentUi]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`));
        return `Moved the pointer to ${Math.round(x)},${Math.round(y)}.`;
      }

      case "click": {
        const x = argNum(args, "x", Number.NaN);
        const y = argNum(args, "y", Number.NaN);
        const hasX = Number.isFinite(x);
        const hasY = Number.isFinite(y);
        if (hasX !== hasY) throw new Error("click needs both x and y, or neither to click at the current pointer");
        const button = (argOpt(args, "button")?.trim().toLowerCase() || "left") as "left" | "right" | "middle";
        if (!["left", "right", "middle"].includes(button)) {
          throw new Error(`unknown button "${button}". Valid values: left, right, middle`);
        }
        const clicks = Math.round(argNum(args, "clicks", 1));
        if (clicks < 1 || clicks > 3) throw new Error("clicks must be 1, 2 or 3");
        const handle = argOpt(args, "handle")?.trim();
        const window = argOpt(args, "window")?.trim();
        const target = handle ? ` in window handle ${handle}` : window ? ` in window "${window}"` : "";
        const where = `${hasX ? `${Math.round(x)},${Math.round(y)}` : "the current pointer"}${target}`;
        if (ctx.dryRun) return `DRY RUN: would click ${button} ${clicks} time(s) at ${where}.`;
        if (!(await ctx.approve(`click ${button} ${clicks} time(s) at ${where}`))) return "Cancelled by user.";
        await runPs(
          winUiScript(
            [
              ...focusLines(handle, window),
              `[WinAgentUi]::Click(${hasX ? Math.round(x) : 0}, ${hasY ? Math.round(y) : 0}, ${hasX ? "$true" : "$false"}, ${psQuote(button)}, ${clicks})`,
            ].join("\n"),
          ),
        );
        return `Clicked ${button} ${clicks} time(s) at ${where}.`;
      }

      case "type": {
        const text = arg(args, "text");
        const handle = argOpt(args, "handle")?.trim();
        const window = argOpt(args, "window")?.trim();
        const target = handle ? `window handle ${handle}` : window ? `window "${window}"` : "the active window";
        if (ctx.dryRun) return `DRY RUN: would type ${text.length} characters into ${target}.`;
        if (!(await ctx.approve(`type text into ${target}`))) return "Cancelled by user.";
        await runPs(
          winUiScript(
            [...focusLines(handle, window), `[WinAgentUi]::TypeText(${psQuote(text)})`].join("\n"),
          ),
        );
        return `Typed ${text.length} characters into ${target}.`;
      }

      case "key": {
        const combo = arg(args, "key");
        const keys = parseKeyCombo(combo);
        const handle = argOpt(args, "handle")?.trim();
        const window = argOpt(args, "window")?.trim();
        const target = handle ? `window handle ${handle}` : window ? `window "${window}"` : "the active window";
        if (ctx.dryRun) return `DRY RUN: would press ${combo} in ${target}.`;
        if (!(await ctx.approve(`press ${combo} in ${target}`))) return "Cancelled by user.";
        await runPs(
          winUiScript(
            [...focusLines(handle, window), `[WinAgentUi]::PressKeys([int[]]@(${keys.join(",")}))`].join("\n"),
          ),
        );
        return `Pressed ${combo} in ${target}.`;
      }

      case "scroll": {
        const amount = Math.round(argNum(args, "amount", 3));
        if (amount === 0) return "No scroll: amount was 0.";
        if (amount < -100 || amount > 100) throw new Error("amount must be between -100 and 100");
        const x = argNum(args, "x", Number.NaN);
        const y = argNum(args, "y", Number.NaN);
        const hasX = Number.isFinite(x);
        const hasY = Number.isFinite(y);
        if (hasX !== hasY) throw new Error("scroll needs both x and y, or neither to scroll under the current pointer");
        const direction = amount > 0 ? "up" : "down";
        const handle = argOpt(args, "handle")?.trim();
        const window = argOpt(args, "window")?.trim();
        const target = handle ? ` in window handle ${handle}` : window ? ` in window "${window}"` : "";
        const where = `${hasX ? ` at ${Math.round(x)},${Math.round(y)}` : ""}${target}`;
        if (ctx.dryRun) return `DRY RUN: would scroll ${direction} ${Math.abs(amount)} notch(es)${where}.`;
        if (!(await ctx.approve(`scroll ${direction} ${Math.abs(amount)} notch(es)${where}`))) {
          return "Cancelled by user.";
        }
        const move = hasX ? `[WinAgentUi]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null\n` : "";
        await runPs(
          winUiScript([...focusLines(handle, window), `${move}[WinAgentUi]::Scroll(${amount})`].join("\n")),
        );
        return `Scrolled ${direction} ${Math.abs(amount)} notch(es)${where}.`;
      }

      case "window_list": {
        const raw = await runPs(
          winUiScript(
            [
              "$rows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {",
              "  $r = New-Object WinAgentUi+RECT",
              "  [void][WinAgentUi]::GetWindowRect($_.MainWindowHandle, [ref]$r)",
              "  [pscustomobject]@{ handle = $_.MainWindowHandle.ToInt64().ToString(); process = $_.ProcessName; title = $_.MainWindowTitle; minimized = [WinAgentUi]::IsIconic($_.MainWindowHandle); x = $r.Left; y = $r.Top; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top }",
              "})",
              "ConvertTo-Json -InputObject $rows -Compress",
            ].join("\n"),
          ),
        );
        return formatWindowList(parseWindowRows(raw));
      }

      case "window_focus": {
        const handle = argOpt(args, "handle")?.trim();
        const title = argOpt(args, "title")?.trim();
        if (!handle && !title) throw new Error('window_focus needs "title" or "handle"');
        const target = handle
          ? `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowHandle.ToInt64().ToString() -eq ${psQuote(handle)} } | Select-Object -First 1`
          : `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.IndexOf(${psQuote(title!)}, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1`;
        const label = handle ? `handle ${handle}` : `"${title}"`;
        if (ctx.dryRun) return `DRY RUN: would focus window ${label}.`;
        if (!(await ctx.approve(`focus window ${label}`))) return "Cancelled by user.";
        const raw = await runPs(
          winUiScript(
            [
              `$target = ${target}`,
              `if (-not $target) { throw ${psQuote(`window not found: ${handle ?? title}`)} }`,
              "$result = [WinAgentUi]::Focus($target.MainWindowHandle)",
              "if ($result -ne 'focused') {",
              "  $shell = New-Object -ComObject WScript.Shell",
              "  [void]$shell.AppActivate($target.Id)",
              "  Start-Sleep -Milliseconds 250",
              "  if ([WinAgentUi]::IsForeground($target.MainWindowHandle)) { $result = 'focused' }",
              "}",
              "[pscustomobject]@{ handle = $target.MainWindowHandle.ToInt64().ToString(); process = $target.ProcessName; title = $target.MainWindowTitle; result = $result } | ConvertTo-Json -Compress",
            ].join("\n"),
          ),
        );
        const row = JSON.parse(raw) as WindowRow & { result?: string };
        const focused = row.result === "focused";
        return `${focused ? "Focused" : "Could not focus"} window "${row.title ?? title ?? handle}" (${row.process ?? "?"}, handle ${row.handle ?? "?"}).${
          focused ? "" : " Windows may refuse foreground switches; try again or click the window manually."
        }`;
      }

      case "wait": {
        const ms = Math.round(argNum(args, "ms", 0));
        if (ms < 0 || ms > 60_000) throw new Error("ms must be between 0 and 60000");
        if (ctx.dryRun) return `DRY RUN: would wait ${ms} ms.`;
        await runPs(`Start-Sleep -Milliseconds ${ms}`);
        return `Waited ${ms} ms.`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
