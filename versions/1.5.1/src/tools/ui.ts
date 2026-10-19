import { arg, argEnum, type Tool } from "./registry.js";
import { psQuote, runPs } from "../util/ps.js";

const ACTIONS = ["clipboard_get", "clipboard_set", "screenshot", "open", "notify"] as const;

export const uiTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "ui",
      description:
        "Interact with the Windows desktop. actions: clipboard_get, clipboard_set, " +
        "screenshot (save the screen to a PNG file), open (open a file, folder or URL in the " +
        "default app), notify (show a popup message).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          text: { type: "string", description: "Text for clipboard_set / notify." },
          title: { type: "string", description: "Title for notify." },
          target: { type: "string", description: "File, folder or URL for open." },
          path: { type: "string", description: "Destination PNG path for screenshot." },
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
        const out = arg(args, "path");
        if (ctx.dryRun) return `DRY RUN: would save a screenshot to ${out}.`;
        await runPs(
          [
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
            "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
            "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
            "$g = [System.Drawing.Graphics]::FromImage($bmp)",
            "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
            `$bmp.Save(${psQuote(out)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
            "$g.Dispose(); $bmp.Dispose()",
          ].join("\n"),
        );
        return `Screenshot saved to ${out}.`;
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

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
