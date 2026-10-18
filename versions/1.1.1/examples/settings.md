# Ready-made settings / 现成的配置

`data/settings.json` is written by the UI from the built-in defaults, so you never have to
type one. These three are for when you *do* want to start from a file: copy the block into
`data/settings.json` (or `%AGENT_SETTINGS_FILE%`), restart, done.

Keys not mentioned keep their defaults — see the
[Settings reference](../README.md#settings-reference). `data/settings.json` **contains
your API key**: it is git-ignored, keep it that way.

> The settings file belongs to the installation folder: `versions\1.1.0\data\settings.json`
> is a *different* file from the one next to this copy. Copy it across when you want a
> new version to start with your setup.

## Local model — LM Studio (default)

`http://127.0.0.1:1234/v1` is the OpenAI-compatible server LM Studio starts. Context
length is discovered from `/api/v0/models`, so `contextLimit: 0` (auto) is right.

```json
{
  "activeProfile": "local",
  "profiles": [
    {
      "id": "local",
      "kind": "local",
      "model": "glm-4.7-flash",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "apiKey": "local"
    }
  ],
  "model": "glm-4.7-flash",
  "baseUrl": "http://127.0.0.1:1234/v1",
  "apiKey": "local",
  "language": "zh",
  "contextLimit": 0,
  "maxSteps": 12,
  "requestTimeoutMs": 180000,
  "maxRetries": 2,
  "remember": true,
  "stream": true
}
```

Load the model in LM Studio **before** starting the agent (or just load it and hit
**Refresh models** in Settings). A reasoning model needs a generous `max_tokens`, which
the agent sets per request.

## Local model — Ollama

```json
{
  "activeProfile": "local",
  "profiles": [
    {
      "id": "local",
      "kind": "local",
      "model": "qwen2.5:7b",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "ollama"
    }
  ],
  "language": "zh",
  "contextLimit": 0,
  "maxSteps": 16,
  "requestTimeoutMs": 240000,
  "remember": true
}
```

`qwen2.5:7b` is the smallest model that reliably drives the tools; anything bigger is
better. Context length comes from `/api/show`.

## A cloud API next to the local one

Two profiles mean you can flip with `/profile use cloud` — the conversation, the data
folder and the tools stay where they are, only the endpoint changes.

```json
{
  "activeProfile": "local",
  "profiles": [
    {
      "id": "local",
      "kind": "local",
      "model": "qwen2.5:7b",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "ollama"
    },
    {
      "id": "cloud",
      "kind": "cloud",
      "model": "gpt-4o-mini",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "REPLACE-WITH-YOUR-KEY"
    }
  ],
  "model": "qwen2.5:7b",
  "baseUrl": "http://127.0.0.1:11434/v1",
  "apiKey": "ollama",
  "maxSteps": 20,
  "maxRetries": 3
}
```

Equivalently, without editing files:

```powershell
PS> /profile create cloud
PS> /profile save cloud baseUrl https://api.openai.com/v1
PS> /profile save cloud model gpt-4o-mini
PS> /profile save cloud apiKey sk-...
PS> /profile use cloud
```

`apiKey` may also come from the environment (`OPENAI_API_KEY`, ...) — the UI never shows
it back, `/status` prints whether one is set, not what it is.

## Safer defaults for a model you do not trust yet

```json
{
  "dryRun": true,
  "autoApprove": false,
  "enabledTools": ["files", "system", "processes", "services", "network", "web"],
  "workdir": "D:\\new\\sandbox",
  "maxSteps": 8,
  "language": "zh"
}
```

- `dryRun` — the agent describes the change instead of making it. Turn it off with
  `/dry-run off` once you have seen a few plans you like.
- `enabledTools` — no `powershell`, no `registry`, no `scheduled_tasks`, no `ui`: the
  model must use the tools shown in the README.
- `workdir` — relative paths resolve here, so "read notes.txt" cannot wander off.

## Where to check what actually loaded

```powershell
PS> /status          # model, endpoint, context, tools, data folder, version
PS> /caps            # what this endpoint does not support, if anything
PS> /context         # is the conversation about to overflow?
PS> /data            # where the settings and conversations are
```

Or `GET /api/settings` — it prints the *effective* settings, including anything that came
from environment variables.
