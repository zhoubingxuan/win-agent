# win-agent

A **Windows automation agent** for *local, small LLMs*, with a **fully open local
web control panel**. Everything the agent does — model, endpoint, prompt, tools,
commands, even the server port — can be inspected and changed from the browser.

The idea: a 3B model should not need to remember `netsh`, `schtasks`, `sc.exe`
or `reg.exe` syntax. It just picks a tool and a JSON object, and the agent
translates that into correct, safely-quoted Windows commands.

What that means in practice:

- **Switchable endpoints** — flip between a local model server (LM Studio, Ollama,
  llama.cpp) and a cloud API; each keeps its own URL, key and model.
- **Multi-model selection** — the model dropdown is filled from the endpoint's own
  `/models` list, not from you typing names correctly.
- **Context budgeting** — every request is measured before it is sent; when it would
  not fit the model's window the oldest exchanges are dropped *for that request only*
  and huge tool results are squeezed. The stored conversation is never shortened.
- **Built for flaky endpoints** — timeouts, retries with backoff, and an automatic
  fallback for servers that reject `tools`, `tool_choice`, `stream_options` or
  `stream`; `/diagnose` tells you what the endpoint actually supports.
- **Internet access** — a `web` tool searches, reads pages and calls APIs, so the
  agent is not blind to anything outside this machine.
- **Streaming replies you can stop** — answers appear token by token; hit **Stop**
  (or `Esc`, or `/stop`) to abort a runaway task mid-sentence.
- **记忆化 / memory** — the conversation survives page reloads, restarts and model
  switches, tool cards included.
- **Usage accounting** — tokens in/out, reasoning tokens, output speed and cache
  hits, per reply, per conversation and all-time; every conversation is filed away
  in a `data/` folder.
- **Bilingual** — the interface *and* the agent's answers follow one `language`
  setting (English / 简体中文).
- **One place for everything** — settings, tools, custom commands, the web port, and
  a terminal whose `/commands` reconfigure the agent live.
- **Versioned releases** — `npm run release` copies the whole agent into
  `versions/<version>/` (one folder per version) and keeps `CHANGELOG.md` up to date,
  so you can always go back to a known-good build.

```
you> stop the print spooler and disable it from starting automatically
  -> services {"action":"stop","name":"Spooler"}
  <- [services] Service Spooler stopped.
  -> services {"action":"disable","name":"Spooler"}
  <- [services] Service Spooler startup set to Disabled.

Done: the Spooler service is stopped and set to Disabled.
```

---

## Quick start

```powershell
npm install

# 1. start a tool-capable local model (any of these work)
#    LM Studio   -> load a model, start the server on port 1234   (the default)
#    Ollama      -> ollama run qwen2.5:7b
#    llama.cpp server, vLLM ... also fine

# 2. start the web control panel (opens your browser)
npm run web
```

Then use the **Chat**, **Terminal** and **Settings** tabs. The first screen lets
you pick the endpoint and the model from a list — no config file needed.

Prefer a plain terminal? `npm run dev` gives the same agent as a CLI.

Requirements: Windows 10/11, **Node.js 20.3+** (uses `AbortSignal.any`/`timeout`), and
a tool-capable model — local (LM Studio, Ollama, llama.cpp, vLLM) or a cloud API.
No other runtime dependency: the web UI is plain HTML/CSS/JS served by `node:http`.

---

## The web UI

Three tabs, all talking to the same local server over SSE.

### Chat
- Answers **stream in live**; while a reasoning model is still thinking you see a
  `thinking…` line instead of a frozen screen.
- **Stop** (or `Esc`, or `/stop` in the terminal) aborts the task that is running.
- Every tool call is a card you can expand to see its result.
- Destructive actions pop up **Approve / Deny** buttons (see *Safety*).
- Enter sends, Shift+Enter makes a newline; example prompts are one click away.

### Terminal — the agent's own console
This is not just a shell. Each line either runs in PowerShell **or** is an
*internal command* that reconfigures the agent live. Internal commands start with `/`.

```
PS D:\new> Get-Process | Sort-Object WS -Descending | Select-Object -First 3 ProcessName,WS
PS D:\new> cd C:\Windows\Temp
PS C:\Windows\Temp> /model qwen2.5:14b
updated: model
PS C:\Windows\Temp> /tools
```

- The working directory is remembered between commands (`cd` works).
- ↑ / ↓ browse the command history.
- The **Internal commands** button (or `/help`) prints the full list in your
  language — see
  [Internal commands](#internal-commands--changing-things-from-the-web-terminal).
- Everything is logged; other open tabs see the same session.

### Settings
A form for **every** setting, plus:
- **Endpoints** — switch the whole agent between a local model server and a cloud
  API with one click, and pick the model from the list the endpoint actually reports.
- **Memory** — keep the conversation across restarts.
- **Stream replies** — off, the answer arrives in one piece; on (default), token by token.
- **Web search page** — the search engine the `web` tool queries.
- **Enabled tools** switches — flip a tool off to hide it from the model.
- **Custom commands** editor — add your own PowerShell one-liners as new tools.
- **Web port** — changing it moves the server to the new port immediately.

Every field here has a matching terminal command (`/model`, `/set`, `/enable`, …):
see [Internal commands](#internal-commands--changing-things-from-the-web-terminal).

---

## Language / 语言

The whole thing is bilingual (**English** and **简体中文**). One setting —
`language` — controls both the interface text and the language the agent answers in.
Change it in any of three places and it takes effect immediately:

1. the **语言 / Language** selector in the top-right corner of the web UI,
2. the **Language** field on the Settings tab,
3. the terminal: `/language zh` or `/language en`.

You can also set the initial value with `AGENT_LANGUAGE=en|zh` (or `language` in
`data/settings.json`). The agent's reply language is added to the system
prompt automatically, so it stays Chinese (or English) even if you switch the
prompt itself.

---

## Endpoints — local server vs. cloud API

You do not have to commit to one provider. The agent keeps a list of **profiles**
(endpoints) and uses exactly one at a time. Each profile stores its own URL, API
key and model, so switching never loses anything.

| Where | What you can do |
| --- | --- |
| Sidebar → **endpoint** | switch profile instantly |
| Sidebar → **model** | switch model instantly |
| Settings → **Endpoints** | add / delete endpoints, refresh the model list |
| Terminal | `/profile`, `/profile use <id>`, `/models` |

Three endpoints are ready out of the box:

| id | kind | Default URL | For |
| --- | --- | --- | --- |
| `local` | local | `http://127.0.0.1:1234/v1` | LM Studio, llama.cpp server, vLLM |
| `ollama` | local | `http://127.0.0.1:11434/v1` | Ollama |
| `cloud` | api | `https://api.openai.com/v1` | any OpenAI-compatible cloud API |

Switching a profile copies its `baseUrl` / `apiKey` / `model` into the live
settings, so it takes effect on the next turn. The sidebar and the Settings tab
are two views of the same switch.

### Multi-model selection

**Refresh models** (Settings) or `/models` asks the endpoint's `/models` route and
remembers the answer, so the **model** dropdowns list the models that really exist
instead of you typing names correctly. The list is stored per profile
(`profiles[].models`), so a flaky endpoint still shows the last known list.

Adding a cloud provider:

```
PS D:\new> /profile new work api https://api.deepseek.com/v1 deepseek-chat
PS D:\new> /profile set work apiKey sk-...
PS D:\new> /profile use work
PS D:\new> /models
```

---

## Web access — the `web` tool

A Windows agent that cannot read the internet is only half useful. The `web` tool
gives the model three actions, each a single JSON object:

| Action | What it does | Key arguments |
| --- | --- | --- |
| `search` | searches the web and returns titles, URLs and snippets | `query`, `count` |
| `fetch` | GETs/POSTs a URL and returns **readable text**, pretty JSON or raw HTML | `url`, `format`, `method`, `body`, `headers`, `maxChars`, `offset` |
| `download` | saves a URL to a local file (asks for approval) | `url`, `path` |

```
you> what is the latest PowerShell release, and give me the link?
  -> web {"action":"search","query":"PowerShell latest release"}
  <- Search results for "PowerShell latest release" (8):
     1. PowerShell/PowerShell releases - GitHub
        https://github.com/PowerShell/PowerShell/releases
     ...
  -> web {"action":"fetch","url":"https://github.com/PowerShell/PowerShell/releases","maxChars":1200}
  <- HTTP 200  text/html; charset=utf-8  https://github.com/PowerShell/PowerShell/releases
     - PowerShell 7.6.0 ...
```

Why `fetch` returns text instead of markup: HTML is mostly noise, and small models
drown in it. The tool strips scripts/styles, turns `<li>` into bullets and collapses
whitespace; `format: "json"` pretty-prints an API response instead.

- **Search engine** — configurable. Settings → **Web search page**, `/set webSearchUrl ...`,
  or `AGENT_WEB_SEARCH_URL`. The default is Bing (`https://www.bing.com/search?q={q}`);
  `{q}` is replaced by the query. Any search page works — DuckDuckGo, a SearXNG
  instance, an internal wiki — the parser understands Bing and DuckDuckGo layouts and
  falls back to "any external link on the page".
- **No API key needed.** If a search page is blocked on your network, point the setting
  at one that is not, or have the agent `fetch` a known URL directly.
- **Limits** — 3 MB per response, `maxChars` (default 6000) and `offset` let the model
  page through a long page without blowing its context.
- `download` writes a file from the network, so it goes through the normal approval
  prompt (`dryRun` / `autoApprove` apply as usual).

---

## Context window

This is the difference between "a demo" and "usable with a 7B model". A tool result
can be huge (a directory tree, a 20 000-character file, a long log) and local models
often run with a small window, so a conversation that worked for ten turns suddenly
starts failing with *"this model's maximum context length is …"*.

win-agent measures **every request before sending it** and keeps it inside the window:

1. **It knows the window.** LM Studio (`/api/v0/models`) and Ollama (`/api/show`)
   report it, and the agent remembers it per model. Press **Refresh models** (or run
   `/models`) once and `modelContext` fills itself in. `contextLimit` overrides it;
   `0` means "use what the endpoint reports".
2. **It squeezes before it drops.** Any tool result longer than a quarter of the
   window (never below 2 000, never above 12 000 characters) is shortened head+tail,
   with a marker saying how much was removed.
3. **Then it drops the oldest exchanges** — a whole user → tools → answer group at a
   time, oldest first, never the system prompt and never the newest request. Tool
   calls and their results always travel together, so the model never sees a
   `tool_calls` without its reply.
4. **The stored conversation is untouched.** Only the copy sent to the model shrinks,
   so the UI, `data/history.json` and the token totals keep everything.

The sidebar shows `used / window` (amber past 75 %), Settings shows the same line with
where the number came from, and `/context` prints it in your language. When a request
had to be trimmed you get a notice in the chat log:

```
context trimmed to fit 2200 tokens: 1 older exchange(s) dropped — the stored conversation is unchanged
```

> Practical advice: set `contextLimit` to your model's *actual* loaded window (LM Studio
> shows it next to the context slider). If it is set too high the model still errors;
> too low and you lose history earlier than necessary. `0` + a discovered window is
> the best default.

---

## Flaky, partial or unusual endpoints

Cloud APIs rate-limit, local servers restart while a model reloads, and plenty of
OpenAI-compatible servers implement only part of the spec. Three settings and one
mechanism cover that:

- **`requestTimeoutMs`** (default 180 000) — one request may take this long. Local
  models are slow, especially the first call after loading a model, so the default is
  generous. A request that overruns is abandoned and reported as
  `the endpoint did not answer within 180s`.
- **`maxRetries`** (default 2) — 408/409/425/429 and 5xx are retried with exponential
  backoff, honouring `Retry-After` when the server sends it. Retries stop the moment a
  token has been shown, so a streamed answer is never duplicated.
- **Automatic field fallback** — if an endpoint rejects `tools`, `tool_choice`,
  `stream_options` or `stream`, the request is retried without that field and the
  endpoint is remembered as not supporting it for the rest of the session. A server
  without function calling still works through the **text protocol** (below), and the
  chat shows a notice telling you what happened.
- A plain 400/404 is *not* retried — that is a real configuration error (wrong model
  name, malformed key) and you get the endpoint's own message.

### Text tool protocol

Models that cannot call functions are told, in the system prompt, to answer with one
fenced JSON block:

```json
{"tool": "system", "arguments": {"action": "info"}}
```

The agent parses that, runs the tool and continues — so "no function calling" is a
speed bump, not a dead end. `/diagnose` tells you whether native tool calling works
for the current model.

### /diagnose — what can this endpoint do?

**Settings → Test this endpoint**, or `/diagnose`, or `POST /api/diagnose`. It sends a
handful of tiny requests and reports one line per check:

```
Endpoint: http://127.0.0.1:1234/v1
Model:    glm-4.7-flash
Verdict:  ok

[ok] Endpoint reachable: http://127.0.0.1:1234/v1/models - 8 model(s)
[ok] Configured model exists: "glm-4.7-flash" is loaded
[ok] Plain chat completion: answered "Ok"
[ok] Reports token usage: usage: {"prompt_tokens":12,"completion_tokens":263,...}
[ok] Native function calling (tools): 1 tool call(s) returned
[ok] Streaming (stream: true): received 1 SSE frame(s)
[ok] Context window known: LM Studio /api/v0/models: glm-4.7-flash = 105472 tokens
```

Nothing in the report touches your conversation, and the discovered context lengths
are saved. `/caps` lists only the compatibility problems, if any were found.

---

## Memory, usage and the data folder

By default the agent **remembers the conversation**. Everything it stores lives in
one visible folder in the project:

```
data/
  README.md            what this folder is
  settings.json        your configuration (contains API keys!)
  history.json         the conversation that is open right now
  usage.json           token totals summed over every conversation
  conversations/
    2026-10-18_10-15-33.json     one file per filed-away conversation
```

Set `AGENT_DATA_DIR` (e.g. `AGENT_DATA_DIR=D:\win-agent-data`) to keep it elsewhere;
`AGENT_SETTINGS_FILE` still overrides just the settings file. If you are upgrading
from an older version, `.win-agent/settings.json` and `.win-agent/history.json` are
copied into `data/` automatically on first start.

### Memory / 记忆化

The conversation is written to `data/history.json` after every turn and read back
when the server starts, so a page refresh, a server restart or a model switch does
not lose the thread — tool cards included.

| Where | What it does |
| --- | --- |
| Settings → **Memory** | turn remembering on/off, see size and path |
| Terminal | `/memory`, `/memory on`, `/memory off`, `/memory clear` |
| `/reset` · **New conversation** | files the open conversation into `data/conversations/` and starts a fresh one |

Only your messages, the agent's answers and the tool calls are stored (never the
system prompt). Turning `remember` off keeps the conversation itself off disk — the
token totals in `usage.json` are still written.

### Usage / 用量统计

Every LLM call is measured. Under each reply (and each group of tool cards) a small
caption shows what that call cost:

```
↑1,204 ↓318 (96 reasoning) · 41.7 tok/s · 7.6s
```

| Value | Meaning |
| --- | --- |
| `↑` input | prompt tokens, as reported by the endpoint |
| `↓` output | completion tokens |
| `reasoning` | hidden thinking tokens (`glm-4.7-flash` and other reasoning models) |
| `tok/s` | output speed — the endpoint's own number when it gives one (LM Studio / llama.cpp `stats`), otherwise completion tokens ÷ the time from the first token to the last, measured live while streaming |
| `s` | how long the call took |
| `cache` | cached prompt tokens, shown only when the endpoint reports them |
| `estimated` | the endpoint sent no `usage` block, so the count is derived from text length |

The sidebar **Usage** panel totals the open conversation (input / output / total /
speed / cache), plus an all-time figure across every conversation ever.

Token counts come from the standard OpenAI `usage` block, so they work with every
provider. Two caveats, because the numbers are only as good as the endpoint:

- **Cache** is only reported by some endpoints (OpenAI, DeepSeek, ...). LM Studio
  and llama.cpp do not report it, so it shows `—` there.
- **Speed** comes from the endpoint's `stats` block when present; otherwise it is
  measured while streaming, so a very short reply (under ~200 ms of generation)
  simply shows `—` rather than a meaningless number.

| Where | What you get |
| --- | --- |
| Chat | a caption under every reply with that call's tokens, speed and time |
| Sidebar → **Usage** | totals for the open conversation and all-time |
| Settings → **Conversation records** | data folder, open conversation, archived list, **Open data folder** |
| Terminal | `/usage`, `/conversations`, `/data` |

---

## Internal commands — changing things from the web terminal

The **Terminal** tab is the agent's console. Any line starting with `/` is an
*internal command*: it reconfigures the agent live, straight from the browser.

- Click **Internal commands** under the terminal, or type `/help`, to print the
  full list. The help text follows the selected `language`, so it is in Chinese
  when the interface is Chinese.
- Anything **not** starting with `/` is run as a PowerShell command in the
  terminal's current directory (`cd` is remembered).

> Every `/command` below is the same switch as a field on the **Settings** tab.
> Changes are written to `data/settings.json` and take effect immediately —
> normally without a restart. The exception is `/port`, which rebinds the
> listening socket.

### Commands that change something

| Command | What it changes | When it applies |
| --- | --- | --- |
| `/set <key> <value>` | any setting from the table below | immediately + saved |
| `/unset <key>` | restores that setting's default | immediately + saved |
| `/model <name>` | which model is called | next turn |
| `/baseurl <url>` | API endpoint | next turn |
| `/apikey <key>` | API key | next turn |
| `/language <en\|zh>` | interface text **and** reply language | immediately |
| `/maxsteps <n>` | rounds of tool calls per turn | next turn |
| `/temperature <n>` | sampling temperature (0–2) | next turn |
| `/prompt <text>` | the system prompt | next turn |
| `/workdir <path>` | working directory (`chdir` + terminal cwd) | immediately |
| `/powershell <exe>` | `powershell.exe` or `pwsh.exe` | next command |
| `/enable <name...>` · `/disable <name...>` · `/enable all` | which tools the model may use | immediately |
| `/custom add <name> <ps>` | adds a custom command | immediately |
| `/custom remove <name>` | deletes a custom command | immediately |
| `/dry-run <on\|off>` | describe actions instead of doing them | immediately |
| `/auto-approve <on\|off>` | skip approval prompts | immediately |
| `/stream <on\|off>` | stream the reply token by token | next turn |
| `/set contextLimit <tokens>` | the context window to budget against (0 = use what the endpoint reports) | next turn |
| `/set requestTimeoutMs <ms>` | how long one LLM request may take | next call |
| `/set maxRetries <n>` | retries for 429 / 5xx / network errors | next call |
| `/profile use <id>` | switch between the local server and a cloud API | next turn |
| `/profile new <id> [local\|api] <baseUrl> [model]` | add an endpoint | immediately + saved |
| `/profile set <id> <name\|kind\|baseUrl\|apiKey\|model> <value>` | edit one field of an endpoint | next turn |
| `/profile remove <id>` | delete an endpoint | immediately + saved |
| `/memory on` · `/memory off` | remember the conversation across restarts | immediately + saved |
| `/memory clear` | file the open conversation away and start a new one | immediately |
| `/port <n>` | web UI port (rebinds the server) | immediately, then reconnect |
| `/reset` | files the conversation away and starts a new one | immediately |
| `/reload` | re-reads settings from disk | immediately |
| `/save` | writes the current settings to disk | immediately |

### Commands that only show information or run something

| Command | Shows / does |
| --- | --- |
| `/help` · `/?` | the full command list, in your language |
| `/status` | model, endpoint, flags, tool counts, version, context window |
| `/config [key]` | every setting, or a single one |
| `/get <key>` | one setting |
| `/tools` | tools, with `[x]` = enabled |
| `/custom list` | your custom commands |
| `/profile` | every endpoint, with `*` on the active one |
| `/models [id]` | the models an endpoint reports (default: the active one) |
| `/memory` | whether remembering is on, plus size and path of the file |
| `/usage` | tokens, speed and cache for the open conversation + all-time totals |
| `/conversations` | the conversations filed away in `data/conversations/` |
| `/data` | where the data folder is and what is in it |
| `/stop` | stops the task that is running |
| `/whoami` | where the settings file lives |
| `/public` | exactly what the web UI receives (API key masked) |
| `/context` | how full the model's context window is, and what was trimmed |
| `/diagnose` | probes the endpoint: chat, usage, function calling, streaming, context length |
| `/caps` | what the active endpoint does not support, if anything |
| `/version` | which win-agent version is running |
| `/exec <command>` | runs a raw shell command and prints the output |
| `/open <path>` | opens a file or folder in Explorer |

### Examples

```
PS D:\new> /status                       # what is the agent using right now?
PS D:\new> /profile                      # which endpoints exist, which is active?
PS D:\new> /profile use cloud            # flip from the local server to a cloud API
PS D:\new> /models                       # what does this endpoint actually serve?
PS D:\new> /model qwen2.5:14b            # switch model, keep the conversation
PS D:\new> /disable powershell ui        # hide two dangerous tools from the model
PS D:\new> /language zh                  # Chinese UI + Chinese answers
PS D:\new> /memory                       # is the conversation being remembered?
PS D:\new> /custom add diskfree Get-PSDrive C | Select-Object -ExpandProperty Free
PS D:\new> /dry-run on                   # safely rehearse the next task
PS D:\new> /port 9000                    # move the whole UI to port 9000
PS D:\new> /diagnose                     # what can this endpoint actually do?
PS D:\new> /context                      # is the conversation about to overflow?
```

The keys accepted by `/set`, `/get` and `/unset` are exactly the ones in the
[Settings reference](#settings-reference) below — for example `/set maxSteps 20`,
`/set language zh`, or `/set enabledTools ["files","system"]`.


---

## Settings reference

Every key below is editable from the **Settings tab**, the terminal (`/set key value`),
or the HTTP API (`POST /api/settings`). Values are validated; bad input is rejected
with a message and nothing changes.

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `model` | string | *(active endpoint)* | model name sent to the API |
| `baseUrl` | string | *(active endpoint)* | any OpenAI-compatible endpoint |
| `apiKey` | string | *(active endpoint)* | never returned by the API (only `apiKeySet: true`) |
| `profiles` | object[] | 3 built-ins | switchable endpoints: `id`, `name`, `kind` (`local`\|`api`), `baseUrl`, `apiKey`, `model`, `models` |
| `activeProfile` | string | `local` | which endpoint is in use |
| `maxSteps` | number | `12` | tool-calling rounds per user turn (1–100) |
| `temperature` | number | `0` | 0–2 |
| `language` | `"en"` \| `"zh"` | `zh` | interface text **and** the language the agent replies in |
| `systemPrompt` | string | *(built-in)* | the agent's instructions |
| `workdir` | string | process cwd | relative paths resolve here; applied via `chdir` |
| `powershell` | string | `powershell.exe` | use `pwsh.exe` for PowerShell 7 |
| `webPort` | number | `8787` | changing it rebinds the server live (1–65535) |
| `autoOpenBrowser` | boolean | `true` | open the browser on start |
| `dryRun` | boolean | `false` | describe actions instead of doing them |
| `autoApprove` | boolean | `false` | skip approval prompts |
| `remember` | boolean | `true` | keep the conversation in `data/history.json` |
| `stream` | boolean | `true` | stream replies token by token |
| `contextLimit` | number | `0` | tokens to budget against; `0` = use what the endpoint reports (see [Context window](#context-window)) |
| `modelContext` | object | `{}` | model id → context length, discovered from LM Studio / Ollama (`/models`, Refresh models) |
| `requestTimeoutMs` | number | `180000` | how long one LLM request may take before it is abandoned (5 000–3 600 000) |
| `maxRetries` | number | `2` | retries for 429 / 5xx / network errors (0–10), with backoff |
| `webSearchUrl` | string | `https://www.bing.com/search?q={q}` | search page for the `web` tool; `{q}` = the query |
| `enabledTools` | string[] \| `null` | `null` | `null` = all tools enabled |
| `customTools` | object[] | `[]` | your own commands (see below) |

`model`, `baseUrl` and `apiKey` are a mirror of the active profile: editing them
from the UI/terminal updates that profile, and switching profile rewrites them.

**Where settings come from (in order):** built-in defaults → the settings file →
environment variables. Runtime changes from the UI/terminal are written to the
settings file and take effect immediately.

**Settings file:** `data/settings.json` in the working directory (override with
`AGENT_SETTINGS_FILE`, or move the whole folder with `AGENT_DATA_DIR`). It contains
your API key — keep it out of git.

**Data folder:** `data/` holds the settings, the open conversation
(`history.json`), the all-time token totals (`usage.json`) and the filed-away
conversations (`conversations/`). See
[Memory, usage and the data folder](#memory-usage-and-the-data-folder).

---

## Custom commands

Turn any PowerShell one-liner into a tool the model can call.

From the **Settings tab** → *Custom commands*, or from the terminal:

```
PS> /custom add diskfree Get-PSDrive C | Select-Object -ExpandProperty Free
```

This adds an action `diskfree` to a tool called `custom`. The model can then call:

```json
{ "action": "diskfree" }
```

An optional `arg` string is available to the script as `$arg`:

```
PS> /custom add greet Write-Output "hello $arg"
```

```json
{ "action": "greet", "arg": "world" }
```

Custom commands run arbitrary PowerShell, so they always require approval
(unless `autoApprove` / `dryRun` is on).

---

## Built-in tools

| Tool | Actions |
| --- | --- |
| `files` | list, tree, read, write, append, **edit** (replace exact text, with a diff), copy, move, delete, mkdir, search, grep, hash, zip, unzip |
| `system` | info, cpu, memory, disk, uptime, battery, whoami, env_get/set/list, installed_apps, lock_screen, sleep, shutdown, restart, hibernate |
| `processes` | list, find, kill, start |
| `services` | list, status, start, stop, restart, enable, disable |
| `network` | ipconfig, ping, dns_lookup, port_check, connections, firewall_list/add/remove, wifi_profiles |
| `web` | search, fetch, download — internet access (see [Web access](#web-access--the-web-tool)) |
| `scheduled_tasks` | list, info, create, delete, run |
| `registry` | get, list, set, delete |
| `ui` | clipboard_get, clipboard_set, screenshot, open, notify |
| `powershell` | raw script escape hatch (always confirmed) |
| `custom` | your own commands (only present when you add some) |

Any tool can be hidden from the model with `enabledTools` / the switches on the
Settings tab.

---

## CLI

```powershell
npm run dev                              # interactive
npm run dev -- "<task>"                  # one task, then exit
npm run dev -- --list-tools              # print the tool catalog
npm run dev -- --dry-run "<task>"        # preview only
npm run dev -- --yes "<task>"            # auto-approve
npm run dev -- --help
```

The CLI reads the **same** settings file as the web UI, so changes made in the
browser show up on the next CLI start.

---

## HTTP API

All endpoints are local-only (`127.0.0.1`). Useful for scripting your own front end.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | running flag, cwd, enabled tools, all tool names, catalog, version, settings, chat history, context budget, endpoint capabilities, memory info, usage totals, data folder |
| `GET` | `/api/usage` | token totals of the open conversation, all-time totals, per-call list |
| `GET` | `/api/data` | data folder paths, open conversation, usage, archived conversation list |
| `GET` | `/api/conversations` | `{ conversations: [...], current }` |
| `POST` | `/api/conversations` | `{ action: "new" }` files the open conversation away; `{ action: "load", id }` reopens an archived one |
| `GET` | `/api/settings` | public settings + settings file path |
| `POST` | `/api/settings` | partial update; returns `{ settings, changed, notices }` |
| `POST` | `/api/settings/reload` | reload from disk |
| `GET` | `/api/models` | `?profile=<id>` — ask that endpoint which models it serves (remembers the list **and** the context lengths it reports) |
| `POST` | `/api/diagnose` | probe the endpoint and return `{ checks, context, verdict, text }` |
| `POST` | `/api/profiles` | `{ action: "use"\|"save"\|"create"\|"remove", id, ... }` — manage endpoints |
| `POST` | `/api/chat` | `{ message }` — start a task (results arrive on the event stream) |
| `POST` | `/api/abort` | stop the task that is running |
| `POST` | `/api/terminal` | `{ input }` — run a shell line or an internal `/command` |
| `POST` | `/api/approve` | `{ id, approved }` — answer an approval prompt |
| `POST` | `/api/reset` | file the conversation away and start a new one |
| `POST` | `/api/port` | `{ port }` — move the web UI to another port |
| `GET` | `/api/events` | Server-Sent Events stream |

Event types on `/api/events`: `user`, `assistant`, `delta`, `thinking`, `step`,
`tool_call`, `tool_result`, `usage`, `context`, `approval`, `approval_result`, `done`,
`stopping`, `stopped`, `error`, `status`, `settings`, `terminal`, `reset`,
`reload_history`, `archived`, `server_restart`, `notice`.

`delta` carries one live piece of the answer (`{ text }`), `thinking` reports how much
a reasoning model has thought so far (`{ chars }`), `stopped` means the user cancelled
the turn, and `context` reports the budget of a request that had to be trimmed
(`{ estimatedTokens, limit, budget, droppedMessages, truncatedToolResults }`).

Example:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/terminal `
  -ContentType application/json -Body '{"input":"/model qwen2.5:14b"}'
```

---

## Architecture

```
src/
  index.ts        CLI entry (flags, approval prompt, REPL)
  server.ts       local web server: static UI + SSE + settings/terminal/port APIs
  settings.ts     the settings store: defaults, validation, persistence, env merge
  store.ts        the data folder: open conversation, archives, token totals
  version.ts      reads the version from package.json (one source of truth)
  context.ts      token estimation + context budgeting (what to send, what to trim)
  providers.ts    endpoint compatibility memory + context-length discovery
  diagnose.ts     the /diagnose probes (chat, usage, tools, streaming, context)
  commands.ts     internal "/command" dispatcher
  terminal.ts     terminal runner with a remembered working directory
  agent.ts        agent loop + text tool-call fallback + abort/stream plumbing
  llm.ts          OpenAI-compatible client: tool calling, SSE streaming, retries, usage
  web/            browser UI (index.html, styles.css, app.js)
  tools/
    registry.ts   Tool/ToolContext types, argument validation, catalog
    files.ts system.ts processes.ts services.ts network.ts web.ts
    automation.ts ui.ts powershell.ts custom.ts
    index.ts      assembles the tool set from settings
  util/ps.ts      PowerShell runner (-EncodedCommand) + JSON helpers
scripts/
  clean.mjs       empties dist/ before a build
  copy-assets.mjs copies the web UI into dist/
  version.mjs     version: show / bump / back up one folder per version
  test-context.mjs    model-free checks for the context planner (npm test)
  test-providers.mjs  endpoint-compatibility checks against a mock server
versions/
  INDEX.md        index of the backups (written by npm run release)
  1.1.0/          one folder per version: the complete agent at that version
data/             settings, conversation records and token totals
.git/             git history (branch main, one tag per version)
```

The agent loop: send conversation + tool schemas → run requested tools → feed
results back → repeat until a plain-text answer or `maxSteps` is reached. The
conversation itself is never modified by the context planner; only the copy handed to
`chat()` is.

### Versioning and releases

`package.json` is the single source of truth: `src/version.ts` reads it, and it is shown
by the CLI banner, the sidebar, `/version`, `/status` and the startup log.

```powershell
npm run version:show        # version, backups, drift, git state
npm run version:list        # list the backed-up versions
npm run version:diff        # what changed since the newest backup?
npm run version:set 1.2.0   # bump package.json + open a CHANGELOG section
npm run release             # build, back up to versions/1.2.0/, tag v1.2.0
npm run version:tag         # create the v<version> tag (needs a clean tree)
npm test                    # context planner checks (no model needed)
npm run test:providers      # endpoint compatibility checks against a mock server
```

**One version = one folder.** `npm run release` copies the complete agent into
`versions/<version>/` — `src/`, `scripts/`, the configs and the docs, plus a
`version.json` manifest — and refreshes `versions/INDEX.md`. `node_modules`, `dist`,
`data` and the other versions are never copied, so a folder is a clean, standalone
copy of that release. Add `--tar` to also get a portable `versions/<version>.tar.gz`
(`node scripts/version.mjs --snapshot --tar`, e.g. to carry it to another machine).

Two guards keep a version from going missing: `npm run version:set` refuses to bump
the version while the current one has no backup (`--force` overrides), and
`npm run version:show` reports how many files have drifted from the newest backup
(`npm run version:diff` lists them).

Restoring a version is just running it:

```powershell
cd versions\1.1.0
npm install
npm run web        # or: npm run build && node dist/server.js --no-open
```

Settings and conversations live in the working folder's `data/` (or `AGENT_DATA_DIR`),
so a restored copy starts clean unless you copy `data/settings.json` across to it — it
holds your API keys.

### 版本库 / git

A folder copy shows you *what* a version looked like; git remembers *why* it changed.
`D:\new` is a git repository (branch `main`) and every release gets a tag, so the two
together mean no version can be lost again.

Git is **PortableGit 2.56** in `C:\Users\admin\AppData\Local\Programs\PortableGit`
(installed per-user, no admin rights needed) and its `cmd\` folder is on your user
`PATH`, so a freshly opened terminal can just run `git`. To move it elsewhere, install
the full build with `winget install --id Git.Git -e` (that one asks for admin) or
extract a newer
[PortableGit](https://github.com/git-for-windows/git/releases) yourself.

```powershell
git log --oneline --decorate     # the history, with the version tags on it
git show v1.1.0 --stat           # what 1.1.0 contained
git diff                         # what you changed since the last commit
git checkout v1.1.0              # look at an old version (git switch main to come back)
```

The release routine is three steps — **bump, commit, release**:

```powershell
npm run version:set 1.2.0        # 1. package.json + a new CHANGELOG section
git add -A && git commit -m "1.2.0: ..."   # 2. record the change
npm run release                  # 3. build + versions/1.2.0/ + tag v1.2.0
```

`npm run release` only tags when the working tree is clean, so a tag always points at
exactly the code that is in `versions/<version>/`. `data/`, `versions/`, `dist/` and
`node_modules/` stay out of the repository (`.gitignore`) — `data/` holds your API
keys. History starts at **v1.1.0**: the 1.0.0 source only ever existed in the working
folder before the backup and git tooling existed, so it is not recoverable, and the
`CHANGELOG.md` entry is all that remains of it.

---

## Why small local models work here

| Problem | Solution |
| --- | --- |
| Don't remember Windows syntax | high-level tools with an `action` enum |
| Fragile command-line quoting | everything runs via PowerShell `-EncodedCommand` (base64 UTF-16LE) |
| Free-form JSON is hard | flat, validated argument objects |
| Forget which tools exist | the catalog is injected into the system prompt |
| No native function-calling | text fallback parses `{"tool": ..., "arguments": {...}}` |
| Destructive mistakes | approval prompts, `dryRun`, non-interactive deny-by-default |
| Enum values unreadable | `Status: "Running"` instead of `Status: 4` |
| Drowns in raw HTML | the `web` tool returns extracted text, not markup |
| Long wait with nothing on screen | token-by-token streaming plus a `thinking…` line |
| A runaway answer | **Stop** / `Esc` / `/stop` cancels the request |
| Small context window overflows after a few turns | the request is measured and the oldest exchanges are dropped (stored history intact) |
| One giant tool result eats the window | tool results are squeezed head+tail with a marker |
| Server rejects `tools` / `stream` / `stream_options` | the field is dropped automatically and remembered |
| Rate limits and server restarts | retries with backoff, honouring `Retry-After` |
| Silently wrong endpoint setup | `/diagnose` reports exactly what works |

---

## Safety

- Destructive actions call the approval hook: a `y/N` prompt in the CLI, or
  Approve/Deny buttons in the browser.
- `dryRun` makes the agent report what it *would* do and change nothing.
- Non-interactive runs deny destructive actions unless `--yes` (CLI) or
  `autoApprove` is set.
- The raw `powershell` tool and all `custom` commands are always confirmed.
- Some actions need an **elevated** (Administrator) terminal: firewall rules,
  starting/stopping services, `Machine` environment variables, writes to `HKLM`.
- The server binds to `127.0.0.1` only.

---

## Adding a tool (for developers)

```ts
registry.register({
  schema: {
    type: "function",
    function: {
      name: "demo",
      description: "Do something. actions: ping.",
      parameters: {
        type: "object",
        properties: { action: { type: "string", enum: ["ping"] } },
        required: ["action"],
      },
    },
  },
  async run(args, ctx) {
    const action = argEnum(args, "action", ["ping"]);
    if (action === "ping") return "pong";
    return "?";
  },
});
```

Then register it in `src/tools/index.ts`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing API key` / connection refused | start your local server (e.g. `ollama run qwen2.5:7b`) and check `baseUrl` in Settings |
| Model ignores tools | use a tool-capable model (`qwen2.5`, `llama3.1`, `mistral-nemo`); raise `maxSteps` |
| Command needs admin | restart your terminal / the app as Administrator |
| Port already in use | change **Web port** in Settings, or `AGENT_WEB_PORT=9000 npm run web` |
| Wrong working directory | set `workdir` in Settings (the terminal cwd follows it) |
| Web search returns nothing | the search page may have changed or be blocked — set **Web search page** to one that works (try `https://html.duckduckgo.com/html/?q={q}` or your own SearXNG) |
| Reply appears all at once | `stream` is off, or the endpoint ignores `stream: true`; turn **Stream replies** on |
| `this model's maximum context length is N tokens` | the endpoint reported a window bigger than the model really has — set `contextLimit` to the real one (LM Studio shows it next to the context slider), or run `/context` to see what the agent thinks it is |
| The agent "forgets" the beginning of a long task | expected: the request was trimmed to fit. Raise `contextLimit` (if the model can take it) or start a new conversation — the old one is archived, not lost |
| Endpoint errors about `tools` / `stream` | `/diagnose` shows which field it rejects; the agent already retries without it and remembers. `/caps` lists what was dropped |
| Requests time out on the first call | a local server is loading the model — raise `requestTimeoutMs`, or warm the model up with `/diagnose` first |
| `429` from a cloud API | raise `maxRetries`; the agent waits the `Retry-After` the API asked for |
| Reset everything | delete the `data/` folder |
