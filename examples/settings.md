# Ready-made settings / 现成的配置

`data/settings.json` is written by the UI from the built-in defaults, so you never have to
type one. These are for when you *do* want to start from a file: copy the block into
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

## Small local model: guided mode (the default)

`agentMode` decides how much the agent supervises the model. For a 3B–14B local model
keep the default:

```json
{
  "agentMode": "guided",
  "maxSteps": 16,
  "temperature": 0
}
```

The model gets a numbered operating procedure, sees each tool's required argument
names, and may call only one tool per step. Switch to `"normal"` for a GPT-4-class
endpoint, where batching independent calls is faster. Everything else — tools,
approval prompts, memory, context budget — is identical. See
[modes.md](modes.md).

## The chat log, quiet or loud

`verbosity` is a view setting: it decides how much of the process the chat draws, and
nothing else. `answer` (the default) is just your message and the model's reply;
`thinking` adds the model's reasoning in a block that folds away when the answer starts;
`full` is the machine room — every tool call with its arguments and result, `step n/m`
markers and per-call token counts.

```json
{
  "verbosity": "thinking"
}
```

```powershell
PS> /verbosity full                       # same thing from the terminal
$env:AGENT_VERBOSITY = "full"             # ... or just for this shell
```

Note that this file is a *view* setting: `remember: false` is what decides whether the
conversation is written to `data/history.json` at all. See
[verbosity.md](verbosity.md).

## Windows: English errors and the PowerShell in use

`psEnglishErrors` is on by default so error text is English on a Chinese (or German,
Japanese, …) Windows, whatever the model or the hints expect:

```json
{
  "agentMode": "guided",
  "psEnglishErrors": true,
  "powershell": "powershell.exe"
}
```

Set `"powershell": "pwsh.exe"` to drive PowerShell 7 instead — the binary is resolved
through `PATH`, `PATHEXT` and the usual install folders, so a bare name works.
`/status` and `GET /api/state` (`windows`) report the binary, its version and edition,
whether the agent is elevated, and this flag. See [windows.md](windows.md).

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
      "kind": "api",
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

## One model list for LM Studio *and* Ollama

`syncLocalModels` is on by default: **Refresh models** then asks every `local` profile
*plus* `127.0.0.1:1234` and `127.0.0.1:11434` what they can load, and merges the answers
into one picker, grouped per server. Picking a model that lives on another server
switches the endpoint with it.

```json
{
  "syncLocalModels": true,
  "activeProfile": "local",
  "profiles": [
    { "id": "local", "kind": "local", "model": "glm-4.7-flash", "baseUrl": "http://127.0.0.1:1234/v1", "apiKey": "local" },
    { "id": "ollama", "kind": "local", "model": "qwen2.5:7b", "baseUrl": "http://127.0.0.1:11434/v1", "apiKey": "ollama" }
  ]
}
```

Set it to `false` (Settings → *Local model sync*) if you want the model list to come from
the active endpoint alone — a cloud API, for instance.

## With MCP servers

MCP is off by default. This enables it and adds two servers: a filesystem server started
as a child process, and an HTTP server that is trusted enough not to ask for approval.

```json
{
  "mcpEnabled": true,
  "mcpServers": [
    {
      "id": "fs",
      "name": "fs",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\new"],
      "env": {},
      "url": "",
      "enabled": true,
      "autoApprove": false,
      "tools": []
    },
    {
      "id": "docs",
      "name": "docs",
      "transport": "http",
      "command": "",
      "args": [],
      "env": {},
      "url": "http://127.0.0.1:3001/mcp",
      "enabled": true,
      "autoApprove": true,
      "tools": []
    }
  ]
}
```

Their tools reach the model as `mcp__fs__read_file`, `mcp__docs__search`, ... — so
`enabledTools` can allow or hide them one by one:

```json
{
  "mcpEnabled": true,
  "enabledTools": ["files", "system", "web", "mcp__fs__read_file", "mcp__fs__list_directory"]
}
```

See [mcp.md](mcp.md) for the whole workflow. `mcpEnabled` is the master switch: while it
is off, no server is started and no MCP tool is offered, however many are configured.

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
