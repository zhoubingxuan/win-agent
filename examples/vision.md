# Vision — screenshots and attached images / 图片输入

The agent can look at a screenshot instead of guessing what is on screen. Two ways:

1. **You** paste an image (Win+Shift+S, then Ctrl+V), drop it on the composer, or press
   **＋**. Up to four PNG/JPEG/WebP images per message.
2. **The model** calls the `ui` tool with `{"action":"screenshot"}`. The screen is saved
   and attached to the tool result when image input is on.

## The setting

```json
{
  "visionMode": "auto"
}
```

| Value | What happens |
| --- | --- |
| `off` | Images are refused. `ui screenshot` still saves the PNG, but the model is told it was not attached. |
| `auto` | Send images only when the model id looks like a vision model (`vl`, `vision`, `llava`, `minicpm-v`, `pixtral`, `internvl`, `gemma3`, `gpt-4o`, `gpt-4.1`, `gpt-5`, `o3`/`o4`, `claude`, `gemini`, `grok-4`, …). |
| `on` | Always send images. Use this for a local vision model with an unusual name. |

```powershell
PS> /set visionMode on
PS> /config visionMode
visionMode = on
$env:AGENT_VISION_MODE = "auto"
```

`GET /api/settings` and `GET /api/state` also return `visionActive`, the resolved
answer for the current endpoint and model. The Settings tab shows it under **Image
input** as a three-stop slider.

## A screenshot the model takes

```json
{ "action": "screenshot" }
```

The tool saves `data/screenshots/screenshot-<timestamp>.png`, makes a model-sized JPEG
(longest side 1600 px), and attaches it. To only save the file:

```json
{ "action": "screenshot", "send_to_model": false }
```

To choose the path:

```json
{ "action": "screenshot", "path": "D:\\work\\before.png" }
```

The tool result is text; the image follows as a user message. That is the shape every
OpenAI-compatible vision endpoint understands, and it means a model on `off` still
gets a useful sentence instead of a broken request.

## A message with an image over HTTP

```powershell
$img = [Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\work\shot.png"))
$body = @{
  message = "What is wrong with this dialog?"
  images  = @(@{ mimeType = "image/png"; data = $img })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/chat `
  -ContentType application/json -Body $body
```

A full data URL (`data:image/png;base64,...`) is accepted instead of separate
`mimeType` + `data`. The server sniffs the bytes, so a file that claims to be a PNG
but is not is rejected with a 400.

## Local models

LM Studio and llama.cpp expose vision through the same `/v1/chat/completions` shape:

- `qwen/qwen2.5-vl-32b-instruct`
- `qwen/qwen3-vl-...`
- `llava` / `bakllava`
- `minicpm-v`
- `gemma-3-...`
- `pixtral`

Load one, leave `visionMode` on `auto`, and paste a screenshot. If the name does not
advertise vision, set `on`. Ollama's OpenAI compatibility endpoint accepts
`image_url` in recent versions; an older Ollama will return an error — update it, or
use LM Studio.

## Limits and context

- 5 MB per image, 12 MB total per message, four images per message.
- The browser resizes to 1600 px before upload; the screenshot tool does the same on
  the server. The original screenshot stays on disk.
- Images cost roughly 85–1600 tokens each. When a request would not fit, older images
  are dropped first, then the newest, with a note in the text. The stored conversation
  keeps every image.
- MCP image resources and tool images use the same path, so a screenshot from an MCP
  server can be inspected too.
