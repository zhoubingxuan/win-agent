import fs from "node:fs";
import path from "node:path";
import { arg, argBool, argEnum, argOpt, type Tool, type ToolResult } from "./registry.js";
import { psQuote, runPs } from "../util/ps.js";
import { dataDir } from "../store.js";
import { readImageFile } from "../images.js";

const ACTIONS = ["clipboard_get", "clipboard_set", "screenshot", "open", "notify"] as const;

export const uiTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "ui",
      description:
        "Interact with the Windows desktop. actions: clipboard_get, clipboard_set, " +
        "screenshot (capture the screen and, when the model can see images, attach it), " +
        "open (open a file, folder or URL in the default app), notify (show a popup message).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          text: { type: "string", description: "Text for clipboard_set / notify." },
          title: { type: "string", description: "Title for notify." },
          target: { type: "string", description: "File, folder or URL for open." },
          path: {
            type: "string",
            description: "Destination PNG path for screenshot. Omit to save under data/screenshots.",
          },
          send_to_model: {
            type: "boolean",
            description: "For screenshot: attach the image to the conversation (default true).",
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

        if (!argBool(args, "send_to_model", true)) return `Screenshot saved to ${out}.`;

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
            text: `Screenshot saved to ${out}. The screen image is attached for you to inspect.`,
            images: [image],
          } satisfies ToolResult;
        } catch (error) {
          // Keep the screenshot even when the model-sized copy failed; if the
          // original is small enough, attach that instead.
          try {
            const image = readImageFile(out);
            return {
              text: `Screenshot saved to ${out}. The screen image is attached for you to inspect.`,
              images: [image],
            } satisfies ToolResult;
          } catch {
            return `Screenshot saved to ${out}, but it could not be attached to the conversation (${(error as Error).message}).`;
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

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
