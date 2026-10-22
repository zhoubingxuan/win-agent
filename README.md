# win-agent

⚠️ Ecosystem Notice / 生态声明
win-agent is open-sourced under Apache 2.0. You are highly encouraged to use it for commercial or open-source projects.
However, if you build derivative plugins, forks, or extensions based on this framework, you must explicitly credit the original author: @zhoubingxuan in your README or UI.

A **Windows automation agent** for *local, small LLMs*, with a **fully open local
web control panel**. Everything the agent does — model, endpoint, prompt, tools,
commands, even the server port — can be inspected and changed from the browser.

The idea: a 3B model should not need to remember `netsh`, `schtasks`, `sc.exe`
or `reg.exe` syntax. It just picks a tool and a JSON object, and the agent
translates that into correct, safely-quoted Windows commands.

What that means in practice:

- **Two agent modes** — `guided` (the default) supervises small local models with an
  explicit operating procedure and one tool call per step; `normal` uses the plain
  prompt. One slider in Settings, `/mode` in the terminal.
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
- **MCP support** — borrow tools from other programs (filesystem, git, a database,
  your own service) over `stdio` or Streamable HTTP; they arrive as
  `mcp__server__tool`, with their own schemas and an approval prompt.
- **One model list for every local server** — ask LM Studio (port 1234) *and* Ollama
  (port 11434) what they can load, merged into one picker; picking a model from
  another server switches the endpoint with it.
- **Chat toolbar** — the working directory (with a folder picker), the endpoint and
  the model sit above the composer, one click each.
- **Output detail** — another slider decides how much of the *process* the chat log
  shows: just the answers (the default — a 7B model's dozen tool calls stay out of the
  way), the answers plus the model's reasoning, or the whole machine room with every
  tool call and its token count. From the toolbar, Settings, `/verbosity` or
  `AGENT_VERBOSITY` — see [Output detail](#output-detail).
- **A sandbox** — every file path stays inside the working directory, and a PowerShell
  script is read before it runs (it is on by default). One switch in the chat sidebar,
  in Settings, or `/sandbox off` — see [Sandbox](#sandbox).
- **Windows-hardened** — PowerShell 5.1 *and* 7, errors always in English, editors
  that wrote UTF-16 files still read correctly, hung commands are killed with their
  whole process tree, and "access denied" becomes a sentence that says what to do.
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

> Those `-> tool` / `<- result` lines are the terminal at `verbosity=full`. The default
> `answer` prints the task and the last line, and nothing else.

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

### Examples / 示例

[`examples/`](examples/) has copy-paste material for everything:
[one worked tool call per tool](examples/tool-calls.md),
[ready-to-send tasks](examples/prompts.md) (English + 中文),
[the two agent modes](examples/modes.md),
[Windows compatibility notes](examples/windows.md),
[custom commands](examples/custom-commands.md),
[MCP servers](examples/mcp.md),
[win-agent as an MCP server](examples/mcp-server.md),
[HTTP API scripts](examples/api.md),
[staying on the rails](examples/stability.md),
[skills](examples/skills.md) and
[ready-made `settings.json` files](examples/settings.md).
Every one of them is written against the code in this repository.

---

## The web UI

Three tabs, all talking to the same local server over SSE.

### Chat
- A **toolbar above the composer** picks the three things a run depends on:
  the **working directory** (a dropdown of recent folders + **Browse…** for a
  folder picker over your drives), the **endpoint**, and the **model**. All three
  apply instantly and are the same settings as everywhere else.
- **Refresh models** (or the button in Settings) asks every local server which
  models it can load — see [Local model sync](#local-model-sync--lm-studio--ollama).
- Answers **stream in live**; while a reasoning model is still thinking you see a
  `thinking…` line instead of a frozen screen. If the model then produces no text at
  all, it is asked once more; if that fails too, the answer says so instead of leaving
  a blank bubble (see [Troubleshooting](#troubleshooting)).
- The conversation scrolls **inside its own pane**: new output follows only while you
  are at the bottom, so scrolling up to read history is not interrupted. A reload, and
  sending your own message, always jump to the newest output.
- **Stop** (or `Esc`, or `/stop` in the terminal) aborts the task that is running.
- **Line up the next jobs while one runs.** Sending a message during a turn does not
  fail with "busy": it goes into a **queue** shown above the composer (up to 20
  messages, each with × to drop it, plus **Clear**), and the next one starts by itself
  the moment the current turn ends. Three jobs in a row, then walk away. The queue
  survives a restart (`data/queue.json`): a job that was still waiting is waiting
  again, and the first one starts as the server comes up. `GET /api/queue` and
  `POST /api/queue` expose the same thing to scripts.
- A **detail** slider in the toolbar (the same one sits in Settings) decides how much
  of the process the log shows — see [Output detail](#output-detail). It is a view
  setting: the agent does exactly the same work at every level.
- Every tool call is a card you can expand to see its result (at the `+ tools & usage`
  level).
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
- **Agent mode** — the local ↔ guided slider for small models (see
  [Agent modes](#agent-modes--guided-vs-normal)).
- **Output detail** — how much of the process the chat log shows (see
  [Output detail](#output-detail)).
- **Sandbox** — the folder fence and the command fence, on by default: file paths stay
  inside the working directory and a script is read before it runs (see
  [Sandbox](#sandbox)).
- **Endpoints** — switch the whole agent between a local model server and a cloud
  API with one click (a local ↔ API slider when adding one), and pick the model
  from the list the endpoint actually reports.
- **Local model sync** — one switch that merges the model lists of LM Studio and
  Ollama (see [below](#local-model-sync--lm-studio--ollama)).
- **MCP** — a master switch, one switch per server, and a form to add more
  (see [MCP](#mcp--tools-from-other-programs)).
- **Windows** — which PowerShell is being driven, whether the agent is elevated, and
  the switch that keeps PowerShell errors in English.
- **Memory** — keep the conversation across restarts.
- **Stream replies** — off, the answer arrives in one piece; on (default), token by token.
- **Web search page** — the search engine the `web` tool queries.
- **Enabled tools** switches — flip a tool off to hide it from the model.
- **Custom commands** editor — add your own PowerShell one-liners as new tools.
- **Skills** — the list of installed procedures, with an editor (name, one line, when,
  steps) and a delete button (see [Skills](#skills)).
- **Change log and undo** — the audit log file, how many changes can be undone, and one
  button (see [Audit log and undo](#audit-log-and-undo)).
- **Web port** — changing it moves the server to the new port immediately.

Every field here has a matching terminal command (`/model`, `/set`, `/enable`, …):
see [Internal commands](#internal-commands--changing-things-from-the-web-terminal).

---

## Agent modes — guided vs. normal

A 7B model and a GPT-4-class model need different amounts of hand-holding, so the
agent has **two modes**. One slider (normal ↔ guided) on the Settings tab, or
`/mode guided` / `/mode normal` in the terminal, or the `agentMode` setting.

| | `guided` (default) | `normal` |
| --- | --- | --- |
| System prompt | your prompt, the language rule, **plus a numbered operating procedure** | your prompt and the language rule |
| Tool catalogue | every tool also lists its **required arguments** | tool names, actions and descriptions |
| Tool calls per step | **exactly one** — extra calls are skipped and answered with a note | as many as the model emits |
| Raw `powershell` tool | **not offered at all** — the model must use the structured actions | offered |
| Best for | LM Studio / Ollama 3B–14B models | cloud models (GPT-4 class, Claude, DeepSeek) |

What the guided procedure actually says (English and Chinese versions ship in the
box — the language follows the `language` setting):

1. Call **one** tool per step, with a single JSON object of arguments.
2. Wait for the result and read it before deciding the next step.
3. Only use the listed tool names; if none fits, say so in plain text.
4. Use exactly the documented argument names.
5. On `Error:`, fix the arguments and retry the **same** tool — twice, then explain
   the problem and stop.
6. Write paths exactly as the user gave them; never guess.
7. Announce a destructive step in one sentence before doing it.
8. When the task is done, answer in plain text without calling a tool.
9. There is no shell in this mode: never write command lines or scripts.

Why it helps: small models are excellent at "one tool, one result" and poor at
planning six calls ahead. Forcing one call per step keeps every decision anchored to
a real tool result instead of a guessed one, and the explicit rules remove the
"invent a tool that does not exist" and "answer as if the command succeeded"
failure modes.

Guided mode also **withholds the `powershell` tool**: the model is not told it exists,
and if it calls it anyway the answer is
`Error: the raw shell is switched off in guided mode. do not write commands or scripts…`
plus the list of structured tools to use instead. A 7B model that is asked to compute
free space with `Get-CimInstance` will write five broken scripts; asked for
`system { action: "disk" }` it succeeds. Use `normal` mode (slider, `/mode normal`)
when you want the shell back — it also comes back in the **Tools** panel note and in
`/tools` output.

Switch to `normal` when you are driving a big model and want it to batch
independent calls; nothing else changes — same tools, same approvals, same memory.

`examples/modes.md` shows both prompts side by side and how to measure which one
your model prefers.

---

## Sandbox

A local model that misreads a path can delete the wrong folder, so the agent is
confined to one folder by default.

**`sandbox` is on out of the box.** While it is on:

- every path a tool is handed has to land inside the **working directory** — the
  folder shown next to `cwd` in the web UI, and the folder `files`, `web download`
  and the audit backups work in. `..\..\Windows\System32`, another drive, an
  absolute path somewhere else: all refused *before anything is touched*, with a
  message that says what to do instead;
- junctions and symlinks are resolved first, so a link inside the folder that
  points outside is not a way out;
- a **PowerShell script is read before it runs** (the *command fence*, new in 1.6.0).
  A literal path out of the folder, a `..`, a `$env:` that resolves outside it, a
  path built from a variable that is not set, a download piped into
  `Invoke-Expression`, or one of the commands that destroy a volume, a partition
  table or the boot configuration (`Format-Volume`, `Clear-Disk`,
  `Initialize-Disk`, `Remove-Partition`, `diskpart`, `bcdedit`) is **refused
  instead of approved**. Everything else goes to the normal approval prompt.

A refused path reads like this in the chat:

```text
Refused: C:\Windows\System32\drivers\etc\hosts is outside the sandbox (D:\projects\site),
so nothing was touched. Work inside D:\projects\site, change the working directory,
or switch the sandbox off in Settings.
```

and a refused script, where the fence has to read the text to see the path:

```text
Refused: "C:\Windows\System32\drivers\etc\hosts" is outside the sandbox (D:\projects\site),
so the script was not run. The sandbox is on (D:\projects\site): work inside that folder,
change the working directory, or switch the sandbox off in Settings.
```

> **A guard, not a jail — and worth saying plainly.** The command fence reads the
> script as text, so it catches the escapes that are *written down*: a literal path, a
> `..`, a `$env:` value, a quoted path with spaces, a known destructive command, a
> download-and-run. A path the script only learns while it runs — `Join-Path $root $sub`
> where `$sub` came out of a file — cannot be checked by anything that reads text. What
> the fence buys is that the obvious, and by far the most common, escape is a clear
> refusal *before* anything runs, not a post-mortem in the audit log. An OS-level
> sandbox (restricted token, job object, AppContainer) is a different piece of work and
> is not what this is.

**Switch it off** when the job really is outside the folder (installing into
`C:\Program Files`, editing something in `%APPDATA%`): the switch is in the chat
sidebar *and* in Settings and applies at once, `/sandbox off` does it from the
terminal, and `"sandbox": false` or `AGENT_SANDBOX=false` does it before the first
start.

What the sandbox deliberately does **not** cover, because none of it is a file path:
services, processes, the registry, scheduled tasks, environment variables — each has
its own tool and its own approval prompt. Your own `custom` commands are code you wrote
and approved, and **MCP servers** are separate programs you configured yourself: both
run with your rights and are not confined.

`examples/sandbox.md` shows a refused path, a refused script, the same task with the
sandbox off, and what the model is told instead.

---

## Staying on the rails

A small model's two failure modes are not "it cannot do the task" — they are **it
burns the whole turn repeating itself** and **one tool result eats the window**. Both
are handled, and both are switchable.

By default there is **no step limit** (`maxSteps: 0`): a long task is allowed to take
as many rounds as it needs. What still ends a turn is repeated work — the same call
returning the same answer twice is refused on the third try, and five refused calls in
a row end the turn with `(stopped after 5 blocked repeats: …)`, because another round
cannot help. A finite `maxSteps` (1–1000) puts the old cap back.

| What happens | What the agent does |
| --- | --- |
| The model asks for the *same call* and gets the *same answer* twice | the third one is answered, not run: `Blocked: this exact call (files read {"path":"C:\\a.txt"}) has already returned the same result twice…`. A call whose answer changed (a poll) and a call with a different argument are never blocked — only a genuine dead end is. |
| The step limit is reached | with `maxSteps` set above 0, the turn ends with `(stopped after 12 steps without finishing: the "Max steps" limit was reached. Send "continue" and I will carry on; …)` — the limit, the number, and the way on, in the interface language. At the default `0` there is no step limit. |
| A tool returns more than the window allows | the result is trimmed to the head and the tail with `... (N characters trimmed; use a narrower call if you need the middle) ...`, and *that* is what is stored in the conversation — not the 200 KB. |
| PowerShell output is enormous | the stream itself is capped at ~1 MB (600 KB head + 400 KB tail) while it is being read, so `Get-Content` on a 2 GB log cannot take the process down. |
| A command fails | one hint after the error, in the interface language: a syntax error is `the script itself has a syntax error`, an unknown cmdlet is `that command does not exist on this machine`, a locked file is `the file is open in another program`, plus permission (which says whether win-agent is elevated), service, path, parameter, DNS and disk-full cases. The PowerShell text above the hint stays English. |

| Switch | Default | What it does |
| --- | --- | --- |
| `loopGuard` | `true` | the repeated-call block above; switch it off for plain step-by-step execution |
| `maxSteps` | `0` | how many tool rounds one turn may take (0 = no limit, 1–1000) |
| `psEnglishErrors` | `true` | force PowerShell error text to English (the hint still follows the interface) |

`examples/stability.md` shows a blocked call, a run that hits the step limit, and a
trimmed result.

---

## Skills

A small model is good at following a procedure and bad at remembering one. So the
procedure lives outside the prompt: a **skill** is a folder with a `SKILL.md` in it,
and the model loads it *only when a task matches*.

```text
data/skills/
  clean-temp/
    SKILL.md          the procedure (header + steps)
    examples.txt      optional: anything the steps point at
  firewall-rule/
    SKILL.md
```

```markdown
---
name: clean-temp
description: Find old files in %TEMP% and remove them safely
when: The user asks to free up disk space or clean temporary files
---
# Clean the temp folder

1. `files list` in `%TEMP%` sorted by size — never delete anything first.
2. Report the ten largest items and their total size.
3. Ask the user which ones to remove (approval is required anyway).
4. Remove only files older than 7 days, one folder at a time, and check the free
   space afterwards.
```

**What the model sees.** The system prompt carries one line per skill — the name, the
description and the `when` — and the instruction to load the one that fits. The body is
fetched with the `skills` tool when the model decides it needs it:

| Action | Returns |
| --- | --- |
| `list` | every skill, with its files and any problem (`the body is empty`) |
| `load` | the steps of one skill, plus the names of the files next to it |
| `read` | one of those files, confined to the skill's own folder |

Ten skills therefore cost ten lines of context, not ten thousand characters, and the
chat log shows exactly which procedure the model chose to follow — `skills load
clean-temp` is a tool call like any other.

**Editing them.** The same folder is in Settings → **Skills**: a list, an editor
(name, one line, *when*, steps) and a delete button. Writing the file by hand with any
editor is equally valid — there is no database to sync, the folder *is* the record. In
the terminal, `/skills` lists them and `/skills show <name>` prints one exactly as the
model receives it.

**What a skill cannot do.** A skill is text, not code. It cannot grant itself tools,
paths or approvals; every action it leads to still goes through the same sandbox,
approval prompt and audit log as if you had asked for it yourself. Treat a skill from
someone else like a note from someone else: read it before you use it.

`examples/skills.md` has three complete skills (temp cleanup, a service restart
checklist, a weekly report) and shows the prompt line each one adds.

---

## Output detail

A small model chatters: a single question about free disk space can turn into a dozen
tool calls before it answers. So how much of that process the chat log *draws* is a
slider with three stops — in the chat toolbar, in Settings, or `/verbosity <level>` in
the terminal:

| Level | The chat log shows |
| --- | --- |
| `answer` *(default)* | your message and the model's answer. Tool calls, reasoning and token counts stay out of the log. A **waiting** turn still shows *Working…* in the title bar, and errors and approval prompts always appear. |
| `thinking` | the above, plus the model's **reasoning** as it arrives, in a block that folds away the moment the answer starts. Reasoned-out history replays folded. |
| `full` | the machine room: reasoning, every tool call with its arguments and result, step markers (`step 3/12`) and the token count of every call. |

Three things worth knowing:

- **It changes nothing about the work.** The agent calls the same tools with the same
  arguments; only the drawing changes. The full process is always broadcast, so moving
  the slider re-draws the conversation you are looking at.
- **The record is complete at every level.** The reasoning is stored with the
  conversation (per assistant message, capped at 20 000 characters per message) so
  switching to `thinking` later still shows what past turns were thinking. It is
  never sent back to the model — it is stripped from every request, because an
  endpoint that rejects unknown fields would choke on it, and a model that reads its
  own thinking back starts arguing with itself.
- **The terminal follows the same setting** at its two ends: on `answer` it prints
  just the answers (plus approvals), on `full` it prints its `-> tool` / `<- result`
  lines. It has nowhere to fold a reasoning block, so the reasoning itself is a
  chat-view thing.

`examples/verbosity.md` shows one turn at all three levels.

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

### Local model sync — LM Studio + Ollama

`syncLocalModels` (default **on**; the switch is in Settings → *Local model sync*)
makes one model list out of every local server. **Refresh models** (or `/models`)
asks them in parallel:

| Endpoint | Route tried first | What it gives |
| --- | --- | --- |
| LM Studio | `GET /api/v0/models` | the model ids **and** each model's context window |
| any local profile | `GET /v1/models` | the ids (the OpenAI-compatible route) |
| Ollama | `GET /api/tags` | the ids when the OpenAI bridge is switched off |

`http://127.0.0.1:1234/v1` (LM Studio) and `http://127.0.0.1:11434/v1` (Ollama)
are probed even when no profile points at them. A server that is not running is
reported as *no answer* and simply contributes nothing — the others still answer.

The picker is then grouped by server:

```
[local — current]  glm-4.7-flash, qwen/qwen3.5-9b, …
[Ollama]           qwen2.5:7b, llama3.2:3b
```

Picking a model that lives on another local server **switches the endpoint with
it** (one settings update: `activeProfile` + `model`), so "run this on the Ollama
model" is one click instead of a configuration detour. The context lengths found
this way land in `modelContext` and are used by the context planner. Only
`127.0.0.1` is contacted.

---

## MCP — tools from other programs

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) lets the agent use
tools that live in other programs: a filesystem server, git, a database, an
internal HTTP service. win-agent is the **client** — you point it at servers.

The feature is off until you switch it on (**Settings → MCP → master switch**, or
`/mcp on`), because an MCP server is a program that runs with your rights.

### Two transports

| Transport | What you give it | How it runs |
| --- | --- | --- |
| `stdio` | a command line, e.g. `npx -y @modelcontextprotocol/server-filesystem D:\` | the agent starts it as a child process and speaks newline-delimited JSON-RPC over its stdin/stdout |
| `http` | a URL, e.g. `http://127.0.0.1:3001/mcp` | *Streamable HTTP*: one POST per request, and the answer may come back as JSON or as an `text/event-stream` body |

On Windows the command is resolved through `PATHEXT`, so `npx`, `uvx` and friends
work without you writing `npx.cmd`; a `.cmd`/`.bat` server is started through
`cmd.exe`. A legacy SSE-only server is not spoken to directly — put an HTTP bridge
such as `mcp-proxy` in front of it and add that URL.

### Adding one

Settings → *MCP*: fill in an `id`, slide **stdio ↔ HTTP** to the transport you
need, paste the command line or the URL, optionally flip **auto-approve**, press
**Add server**. The same from the terminal:

```
PS D:\new> /mcp add fs stdio npx -y @modelcontextprotocol/server-filesystem D:\
PS D:\new> /mcp add docs http http://127.0.0.1:3001/mcp
PS D:\new> /mcp                     # master switch, servers, connection, tool counts
PS D:\new> /mcp tools               # every MCP tool the model can call
PS D:\new> /mcp refresh             # reconnect and re-read the tool lists
PS D:\new> /mcp disable fs          # switch one server off (its tools disappear)
PS D:\new> /mcp remove fs
```

### What the model sees

Every tool a server offers becomes a normal tool called
`mcp__<server>__<tool>` — so `read_file` on the server `fs` is
`mcp__fs__read_file` — with the server's own JSON Schema passed through:

```json
{
  "name": "mcp__fs__read_file",
  "parameters": { "type": "object", "properties": { "path": { "type": "string" } } }
}
```

The name is sanitized to `[A-Za-z0-9_-]` and capped at 64 characters, which is what
OpenAI-compatible endpoints accept. MCP tools show up in the model's catalog (the
system prompt), in the **Tools** chips in the sidebar and in the *Enabled tools*
grid, so `enabledTools` / the switches can hide them individually.

### Approval

MCP tools can do anything their server can, so every call asks for **Approve /
Deny** unless that server is marked **auto-approve** (or the global `autoApprove`
is on). With `dryRun` on they are never called at all.

### When a server is down

The agent still starts. The *MCP* panel marks that server **not connected**, prints
the reason, and keeps showing the tools it offered last time. The tool list is
refreshed at boot, whenever MCP settings change, before every turn (cached for two
minutes) and on **Reconnect & refresh tools** — so a server you start later is
picked up without restarting the agent.

---

## MCP server mode — win-agent as the toolset

The other direction: another agent can start **win-agent** and use its Windows tools.
That is one flag — the protocol runs on stdin/stdout, so the client only needs a
command line:

```json
{
  "mcpServers": {
    "windows": {
      "command": "node",
      "args": ["D:/new/dist/index.js", "--mcp-server"],
      "env": { "AGENT_WORKDIR": "D:/work" }
    }
  }
}
```

Any MCP client that speaks stdio works (Claude Desktop's `mcpServers` block looks
exactly like that; so does `mcp-cli`). From a checkout, use
`npx tsx src/index.ts --mcp-server` and point `cwd` at the repository.

What the client can do:

| Request | Answer |
| --- | --- |
| `initialize` | echoes the protocol version the client asked for, announces the `tools` capability, and names itself `win-agent` with its version |
| `tools/list` | every tool the model would get here (`files`, `system`, `processes`, `services`, `network`, `registry`, `scheduled_tasks`, `ui`, `skills`, `powershell`, custom commands, MCP tools), with the same JSON Schema |
| `tools/call` | runs the tool and returns its text; a tool error comes back as `isError: true`, not a broken connection |
| `ping` | `{}` |

Two rules make it safe to hand to another agent:

- **Nothing but protocol frames on stdout.** Everything meant for a human goes to
  stderr (`win-agent mcp: ready: 11 tools`), so a stray log line can never be read
  as a malformed message. A test checks exactly that.
- **There is nobody to press Approve.** Destructive actions are refused (the tool
  answers `Cancelled by user.`) unless **Settings → MCP → MCP server mode:
  auto-approve** is on, or `AGENT_MCP_SERVE_AUTO_APPROVE=true`. Every refusal and
  every auto-approval is printed on stderr, so the operator can see what the other
  agent tried. `dryRun` still applies if it is set here.

The panel on `/` → **Settings → Capabilities** shows the same surface from the
other side: every tool the model can call right now, the ones held back and why, the
skills that can be loaded, and how many MCP servers are up. `GET /api/capabilities`
returns it as JSON.

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
  audit.jsonl          the change log (also the undo stack)
  undo/                the copies made before a change, kept for undoRetentionDays
  versions/            a copy of what each change produced, so a file can be put back to that version
  skills/
    <name>/SKILL.md    a procedure the model can load (see [Skills](#skills))
  queue.json           messages waiting for the running turn (survives a restart)
```

The folder always belongs to the **installation**, not to the folder you happen to start
the agent from: `data/` sits next to the `src/`/`dist/` you launched, so two copies of
the agent (two folders under `versions/`, say) each keep their own settings,
conversations and totals and can never read or overwrite each other's.

Set `AGENT_DATA_DIR` (e.g. `AGENT_DATA_DIR=D:\win-agent-data`) to keep it somewhere
else, or to make two copies deliberately share one folder; `AGENT_SETTINGS_FILE` still
overrides just the settings file. If you are upgrading from an older version,
`.win-agent/settings.json` and `.win-agent/history.json` are copied into `data/`
automatically on first start.

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

### Audit log and undo

Every change a tool makes is appended to `data/audit.jsonl` — one JSON object per
line, append-only, so `Get-Content data\audit.jsonl -Tail 20` works and nothing is
lost if the server is killed. Changes that can be *faithfully* reversed carry the
steps that put the machine back, and **those steps are the undo stack**: `/undo` (or
**Undo the last change**, or the **Roll back** button next to any row in Settings →
*Change log and undo*) runs them in reverse order.

The log is also the stack, so a change made last Tuesday can still be rolled back
today, and a restart loses nothing:

```
3. 2026-10-18 12:04:11  files edit: replaced 1 occurrence(s) in D:\app\config.json  (undoable)  [Roll back]
2. 2026-10-18 12:03:58  registry set: set HKCU:\Software\MyApp\theme (DWord)
1. 2026-10-18 12:03:41  files mkdir: created folder D:\app\logs  (undoable)  [Roll back]
```

| Where | What it does |
| --- | --- |
| Settings → **Change log and undo** | the log file, how many changes can be undone, **Undo the last change**, and a **Roll back** button on every row that can still be reversed |
| Chat, detail mode | under each answer: the files that turn changed. Right-click one for **Undo this change** (back to before it) or **Restore this version** (exactly what it produced) |
| Terminal | `/audit [n]`, `/undo`, `/undo <n>`, `/undo list` |
| API | `GET /api/audit`, `GET /api/undo`, `POST /api/undo` with `{ count }` or `{ seq }`, `GET /api/turns`, `POST /api/versions/restore` with `{ seq }` |
| Settings | `auditLog` (default `true`) — switch it off and nothing new is recorded and nothing can be undone |
| Setting | `undoRetentionDays` (default `7`, 1–365) — how long the copies in `data/undo/` and `data/versions/` are kept |

**Two verbs per file, not one.** *Undo this change* is the stack above: the file goes
back to how it was *before* that change. *Restore this version* is the other
direction: every change that leaves one file behind also saves a copy of the result
in `data/versions/`, so a file that was later overwritten can be put back to exactly
what that change produced. The restore is itself a recorded change, so a wrong click
costs one more click. A row that deleted the file (or touched several) has no single
"version", and the menu says so instead of guessing.

The card is drawn in detail mode (`verbosity: full`) right after the answer, and it
is saved with the conversation: it comes back after a reload, in the same place.
Changes the agent makes are grouped by turn, so "what did that step actually touch?"
has an answer that does not depend on reading the whole log.

What `/undo` puts back, and how:

| Tool | Action | Reversed by |
| --- | --- | --- |
| `files` | `write` · `append` · `edit` on an existing file | the file is copied into `data/undo/` first, then put back byte for byte |
| `files` | `write` · `append` of a new file | deleting the file |
| `files` | `delete` | the file **or the whole folder tree** is copied aside first, then restored |
| `files` | `move` | moving it back — and, if the move replaced an existing file, restoring that file from a copy taken before the move |
| `files` | `mkdir` | removing the folder — but only while it is still empty |
| `files` | `copy` that created something new | deleting the copy |
| `registry` | `set` | the previous value written back **with its original type** (`DWord`, `MultiString`, `ExpandString`, …); a value that did not exist is removed again |
| `registry` | `delete` | the value written back with its original type |
| `system` | `env_set` | the previous value restored — or the variable removed again if there was none |
| `scheduled_tasks` | `create` of a task that did not exist | unregistering it |
| `scheduled_tasks` | `delete` | the task definition is exported to XML before deleting, and re-registered on undo |

Everything else is recorded but **not** undoable, and the log entry says so:

- `copy` and `unzip` that overwrote existing files (the only way back would be a copy
  of what was there — extract into a new folder instead),
- a registry value or task whose previous state could not be read,
- anything bigger than 64 MB, where the copy would cost more than the change,
- the actions with no inverse at all: starting/stopping a service or process,
  `shutdown`, `ui`, the clipboard, firewall and network changes, `zip`,
  `scheduled_tasks run`.

The two raw-script escape hatches — `powershell` and your own `custom` commands — are
recorded too, with the script (or the command and its argument) quoted in the summary.
They are never undoable, because what a script did cannot be described, only quoted.
MCP tool calls are recorded the same way: server, tool and arguments.

Undo itself asks for no approval — you asked for it explicitly — but it **is** refused
while a turn is running (the API answers `409`), because the agent may be about to
write the very file being restored. There is no undo of an undo (that is just a redo,
and the log has the whole story).

What is kept, and for how long:

- the copies in `data/undo/` are kept for `undoRetentionDays` (7 by default, at least
  1). They are swept by age — at start and before a new copy is taken — so nothing
  younger than the window is ever deleted;
- when a copy does expire (or you delete it by hand), its entry simply stops being
  undoable. A `restore` with no copy would delete the current file and put nothing
  back, so the panel drops the button and `/undo` skips that entry instead;
- an undo is itself an entry in the log (`tool: "undo"`, `ref: <the change it
  reversed>`), so the same change cannot be reversed twice and the history stays
  readable.

A practical limit worth knowing: an undo restores what the *tool* changed. If you (or
another program) edited the file after the agent did, rolling back replaces your edit
with the copy — that is what "put it back the way it was" means.

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
| `/maxsteps <n>` | rounds of tool calls per turn (`0` = no limit) | next turn |
| `/temperature <n>` | sampling temperature (0–2) | next turn |
| `/prompt <text>` | the system prompt | next turn |
| `/workdir <path>` | working directory (`chdir` + terminal cwd) | immediately |
| `/powershell <exe>` | `powershell.exe` or `pwsh.exe` | next command |
| `/mode <guided\|normal>` · `/mode` | supervision level for the model; bare `/mode` prints the current one | next turn |
| `/verbosity <answer\|thinking\|full>` · `/verbosity` | how much of the process the chat shows; bare `/verbosity` prints the current level | immediately + saved |
| `/enable <name...>` · `/disable <name...>` · `/enable all` | which tools the model may use | immediately |
| `/custom add <name> <ps>` | adds a custom command | immediately |
| `/custom remove <name>` | deletes a custom command | immediately |
| `/dry-run <on\|off>` | describe actions instead of doing them | immediately |
| `/auto-approve <on\|off>` | skip approval prompts | immediately |
| `/sandbox <on\|off>` | keep file paths inside the working directory, and read a script before it runs | immediately |
| `/stream <on\|off>` | stream the reply token by token | next turn |
| `/set contextLimit <tokens>` | the context window to budget against (0 = use what the endpoint reports) | next turn |
| `/set requestTimeoutMs <ms>` | how long one LLM request may take | next call |
| `/set maxRetries <n>` | retries for 429 / 5xx / network errors | next call |
| `/profile use <id>` | switch between the local server and a cloud API | next turn |
| `/profile new <id> [local\|api] <baseUrl> [model]` | add an endpoint | immediately + saved |
| `/profile set <id> <name\|kind\|baseUrl\|apiKey\|model> <value>` | edit one field of an endpoint | next turn |
| `/profile remove <id>` | delete an endpoint | immediately + saved |
| `/mcp on` · `/mcp off` | the MCP master switch (off = no server is started) | immediately + saved |
| `/mcp add <id> stdio <command> [args...]` | add an MCP server started as a child process | immediately + saved |
| `/mcp add <id> http <url>` | add an MCP server reached over Streamable HTTP | immediately + saved |
| `/mcp enable <id>` · `/mcp disable <id>` | switch one MCP server on or off | immediately + saved |
| `/mcp remove <id>` | delete an MCP server | immediately + saved |
| `/memory on` · `/memory off` | remember the conversation across restarts | immediately + saved |
| `/memory clear` | file the open conversation away and start a new one | immediately |
| `/undo` · `/undo <n>` | reverse the last change (or the last `n`) — see [Audit log and undo](#audit-log-and-undo) | immediately |
| `/set auditLog <on\|off>` | write the change log and keep the undo stack | immediately + saved |
| `/port <n>` | web UI port (rebinds the server) | immediately, then reconnect |
| `/reset` | files the conversation away and starts a new one | immediately |
| `/reload` | re-reads settings from disk | immediately |
| `/save` | writes the current settings to disk | immediately |

### Commands that only show information or run something

| Command | Shows / does |
| --- | --- |
| `/help` · `/?` | the full command list, in your language |
| `/status` | model, endpoint, flags, tool counts, version, context window, the PowerShell binary in use, elevation, agent mode |
| `/config [key]` | every setting, or a single one |
| `/get <key>` | one setting |
| `/tools` | tools, with `[x]` = enabled, plus the ones not offered right now (guided mode hides `powershell`) |
| `/audit [n]` | the last `n` changes (default 15), newest first, with what can still be undone |
| `/undo list` | what `/undo` would reverse, newest first |
| `/custom list` | your custom commands |
| `/skills` | every skill in `data/skills/`, with its description and when to use it |
| `/skills show <name>` | one skill, exactly as the model receives it |
| `/skills path` | the skills folder |
| `/profile` | every endpoint, with `*` on the active one |
| `/models [id]` | the models an endpoint reports (default: the active one); with `syncLocalModels` on, every local server is listed too |
| `/mcp` | the MCP master switch and every server, with its connection state and tool count |
| `/mcp tools` | every `mcp__server__tool` name the model can call |
| `/mcp refresh` | reconnect to the MCP servers and re-read their tool lists |
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
PS D:\new> /mcp add fs stdio npx -y @modelcontextprotocol/server-filesystem D:\
PS D:\new> /mcp tools                    # which MCP tools did the model get?
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
| `maxSteps` | number | `0` | tool-calling rounds per user turn; `0` = no limit, otherwise 1–1000 |
| `temperature` | number | `0` | 0–2 |
| `loopGuard` | boolean | `true` | refuse a third identical call that already returned the same answer twice (see [Staying on the rails](#staying-on-the-rails)) |
| `agentMode` | `"guided"` \| `"normal"` | `guided` | supervision for small local models (see [Agent modes](#agent-modes--guided-vs-normal)) |
| `verbosity` | `"answer"` \| `"thinking"` \| `"full"` | `answer` | how much of the process the chat log shows (see [Output detail](#output-detail)) |
| `auditLog` | boolean | `true` | append every change to `data/audit.jsonl` and keep the undo stack (see [Audit log and undo](#audit-log-and-undo)) |
| `undoRetentionDays` | number | `7` | how long the copies in `data/undo/` are kept, 1–365 (see [Audit log and undo](#audit-log-and-undo)) |
| `language` | `"en"` \| `"zh"` | `zh` | interface text **and** the language the agent replies in |
| `systemPrompt` | string | *(built-in)* | the agent's instructions |
| `workdir` | string | process cwd | relative paths resolve here; applied via `chdir` |
| `powershell` | string | `powershell.exe` | use `pwsh.exe` for PowerShell 7 |
| `psEnglishErrors` | boolean | `true` | pin PowerShell's UI culture to en-US so error *text* is always English (dates and numbers keep your format) |
| `webPort` | number | `8787` | changing it rebinds the server live (1–65535) |
| `autoOpenBrowser` | boolean | `true` | open the browser on start |
| `dryRun` | boolean | `false` | describe actions instead of doing them |
| `autoApprove` | boolean | `false` | skip approval prompts |
| `sandbox` | boolean | `true` | keep every file path inside the working directory, and read every PowerShell script before it runs (see [Sandbox](#sandbox)) |
| `remember` | boolean | `true` | keep the conversation in `data/history.json` |
| `stream` | boolean | `true` | stream replies token by token |
| `contextLimit` | number | `0` | tokens to budget against; `0` = use what the endpoint reports (see [Context window](#context-window)) |
| `modelContext` | object | `{}` | model id → context length, discovered from LM Studio / Ollama (`/models`, Refresh models) |
| `requestTimeoutMs` | number | `180000` | how long one LLM request may take before it is abandoned (5 000–3 600 000) |
| `maxRetries` | number | `2` | retries for 429 / 5xx / network errors (0–10), with backoff |
| `webSearchUrl` | string | `https://www.bing.com/search?q={q}` | search page for the `web` tool; `{q}` = the query |
| `syncLocalModels` | boolean | `true` | also ask LM Studio (1234) and Ollama (11434) for their models and merge them into the model picker |
| `mcpEnabled` | boolean | `false` | the MCP master switch; while off no MCP server is started and no MCP tool is offered |
| `mcpServers` | object[] | `[]` | MCP servers: `id`, `name`, `transport` (`stdio`\|`http`), `command`, `args`, `env`, `url`, `enabled`, `autoApprove`, `tools` |
| `mcpServeAutoApprove` | boolean | `false` | MCP **server** mode only: answer destructive actions on another agent's behalf instead of refusing them (see [MCP server mode](#mcp-server-mode--win-agent-as-the-toolset)) |
| `recentWorkdirs` | string[] | `[]` | the working directories offered by the chat picker (last 10) |
| `enabledTools` | string[] \| `null` | `null` | `null` = all tools enabled |
| `customTools` | object[] | `[]` | your own commands (see below) |

`model`, `baseUrl` and `apiKey` are a mirror of the active profile: editing them
from the UI/terminal updates that profile, and switching profile rewrites them.

**Where settings come from (in order):** built-in defaults → the settings file →
environment variables. Runtime changes from the UI/terminal are written to the
settings file and take effect immediately.

Environment variables are for the *first* start (a shortcut, a container, a second
copy): they are read before the file, so saving anything from the UI wins from then
on. Every variable is the upper-case setting name with an `AGENT_` prefix:

| Variable | Setting | Notes |
| --- | --- | --- |
| `AGENT_MODEL` | `model` | |
| `AGENT_BASE_URL` | `baseUrl` | `OPENAI_BASE_URL` is accepted too |
| `AGENT_API_KEY` | `apiKey` | `OPENAI_API_KEY` is accepted too |
| `AGENT_MAX_STEPS` | `maxSteps` | |
| `AGENT_LOOP_GUARD` | `loopGuard` | `true` / `false` |
| `AGENT_LANGUAGE` | `language` | `en` / `zh` |
| `AGENT_SYSTEM_PROMPT` | `systemPrompt` | |
| `AGENT_WORKDIR` | `workdir` | |
| `AGENT_POWERSHELL` | `powershell` | `pwsh.exe` for PowerShell 7 |
| `AGENT_MODE` | `agentMode` | `guided` / `normal` |
| `AGENT_SANDBOX` | `sandbox` | `true` / `false` |
| `AGENT_VERBOSITY` | `verbosity` | `answer` / `thinking` / `full` |
| `AGENT_AUDIT_LOG` | `auditLog` | `true` / `false` |
| `AGENT_MCP_SERVE_AUTO_APPROVE` | `mcpServeAutoApprove` | `true` / `false` (MCP server mode) |
| `AGENT_UNDO_RETENTION_DAYS` | `undoRetentionDays` | a number of days, 1–365 |
| `AGENT_PS_ENGLISH_ERRORS` | `psEnglishErrors` | `true` / `false` |
| `AGENT_WEB_PORT` | `webPort` | |
| `AGENT_STREAM` | `stream` | `true` / `false` |
| `AGENT_CONTEXT_LIMIT` | `contextLimit` | tokens; `0` = auto |
| `AGENT_REQUEST_TIMEOUT_MS` | `requestTimeoutMs` | |
| `AGENT_MAX_RETRIES` | `maxRetries` | |
| `AGENT_WEB_SEARCH_URL` | `webSearchUrl` | the `{q}` search template |
| `AGENT_SETTINGS_FILE` | — | where `settings.json` lives |
| `AGENT_DATA_DIR` | — | the whole data folder (settings + history) |

**Settings file:** `data/settings.json` in the installation folder (override with
`AGENT_SETTINGS_FILE`, or move the whole folder with `AGENT_DATA_DIR`). It contains
your API key — keep it out of git. A byte-order mark or a syntax error in it is
**reported at startup** (`warning: ... is not valid JSON`) instead of being ignored
silently; the BOM itself is harmless.

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
| `skills` | list, load, read — procedures from `data/skills/`, loaded only when a task matches (see [Skills](#skills)) |
| `powershell` | raw script escape hatch (always confirmed; with the sandbox on the script is read first and refused if a path leaves the folder) |
| `custom` | your own commands (only present when you add some; not confined — they are code you wrote and approved) |

Any tool can be hidden from the model with `enabledTools` / the switches on the
Settings tab.

**MCP tools** are added to the same list at runtime, one per tool the server
offers, named `mcp__<server>__<tool>` (see
[MCP](#mcp--tools-from-other-programs)). They behave like any other tool: they are
in the catalog, they can be switched off, and they ask for approval before they
run.

---

## Windows compatibility

The agent is meant to survive a *real* Windows machine, not a clean one. Every item
below was a bug that showed up on an ordinary Windows 11 box and is covered by
`npm run test:windows` (57 checks that run against the machine you are on).

### PowerShell 5.1 and PowerShell 7

`powershell.exe` (Windows PowerShell 5.1) ships with Windows; `pwsh.exe`
(PowerShell 7) does not. The agent works with either — set it in Settings →
**PowerShell binary** (or `/powershell pwsh.exe`).

- The binary is resolved through `PATH` and `PATHEXT`, then through the well-known
  install locations, so a bare `pwsh.exe` works even when it is not on `PATH`.
  `/status` and Settings → **Windows** show the binary *and version* actually used.
- If no binary exists at all, the failure says so (instead of `spawn ENOENT`).
- Cmdlets that were **renamed or removed** between the two are not used:
  `ping` asks .NET's `Ping` class (5.1's `-ComputerName` does not exist on 7, and
  7's `-TargetName` does not exist on 5.1), `port_check` uses a `TcpClient` with an
  explicit timeout, `connections` falls back to `netstat -ano` when the `NetTCPIP`
  module is missing, and `services` falls back to the `Win32_Service` CIM class when
  `Get-Service` has no `StartType` (pre-Windows 10 1709).

### Errors you can read

Two Windows quirks made every failure look like a broken tool:

- **Errors were localized.** A Chinese Windows answers `Access is denied` in
  Chinese. A small model cannot use that, and neither could the agent's own hints.
  The launcher pins PowerShell's *UI* culture to English (`psEnglishErrors`, on by
  default), so error **text** is always English while dates and numbers keep your
  format. Turn it off in Settings → **Windows** if you prefer your own language.
- **PowerShell 5.1 wrapped redirected errors in CLIXML** — the error arrived as
  `#< CLIXML <Objs ...><S S="Error">...</S>`. That is now decoded back to plain
  text, and the console-only filler (the localized location line, the source echo,
  `CategoryInfo`) is dropped, leaving the message and *then* one actionable hint:

  ```
  Error: Access to the path 'C:\Program Files\app' is denied.
  (this needs administrator rights and win-agent is NOT elevated - restart
  win-agent from an elevated PowerShell, or ask the user to do it)
  ```

  The three common cases get a hint: permission denied (with your elevation state),
  "not recognized"/"cannot find the path" (check the path), and unknown service
  names (use the short name).

### Elevation

Whether the agent is elevated decides what it *can* do: starting services, adding
firewall rules, machine-wide environment variables and registry keys all need
administrator rights. `/status`, `system info` (`IsAdmin`) and Settings → **Windows**
report it, and the boot banner says it out loud. Run the agent from an elevated
terminal when you want those, and remember that the approval prompt still keeps the
model from doing it on its own.

### Encodings: UTF-16 files are normal here

Notepad's "Unicode" and Windows PowerShell 5.1's `Out-File` both write **UTF-16**,
and plenty of tools write a **UTF-8 BOM**. Reading those as UTF-8 gives
`h\0e\0l\0l\0o` — the classic "the file tool is broken" report. `files read`,
`grep`, `edit` and `write` now detect the encoding (BOM or the NUL pattern):

- `read` returns clean text, and refuses binary files with a message instead of
  dumping NULs into the conversation.
- `edit` and `append` write the file back in **its own** encoding, so editing a
  UTF-16 file does not silently convert it to UTF-8.
- `grep` skips binary files and searches UTF-16 files correctly.
- `data/settings.json` written as UTF-16 by Notepad is read too.

### Hung commands, killed properly

`child.kill()` on Windows kills `powershell.exe` but not what it started, so a stuck
`robocopy` or `Test-Connection` kept running after a timeout. A timeout now kills the
whole process tree (`taskkill /T /F`), and the result says the command was killed.

### Fixed along the way

- `scheduled_tasks create` ignored the `time` argument (the start time was computed
  from `$t` one line *before* `$t` was set), so every task started five minutes from
  now. The script is now built by a tested function, and the reply reports the next
  run time Task Scheduler computed.
- `network port_check` printed the literal string `OPEN: ${host}:${port}`
  (PowerShell does not interpolate inside single quotes) and took seconds through
  `Test-NetConnection`.
- `system info` now reports the PowerShell version/edition/path, elevation, time zone
  and current time.

---

## CLI

```powershell
npm run dev                              # interactive
npm run dev -- "<task>"                  # one task, then exit
npm run dev -- --list-tools              # print the tool catalog
npm run dev -- --mcp-server              # serve the tools over MCP on stdio
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
| `GET` | `/api/state` | running flag, cwd, enabled tools, all tool names, catalog, version, settings, chat history, context budget, endpoint capabilities, memory info, usage totals, data folder, `windows` (PowerShell binary, version, edition, elevation, English-errors flag) |
| `GET` | `/api/usage` | token totals of the open conversation, all-time totals, per-call list |
| `GET` | `/api/data` | data folder paths, open conversation, usage, archived conversation list |
| `GET` | `/api/audit` | `?n=<count>` — the newest `n` audit records plus `pending` (what can still be reversed), the log file, whether logging is on, and `retentionDays` |
| `GET` | `/api/undo` | `{ pending, enabled }` — what can be reversed right now |
| `POST` | `/api/undo` | `{ count }` — reverse the newest `count` changes; `{ seq }` — roll back one entry by its number (what the **Roll back** button sends); returns `{ ok, undone, failures, entries, pending }` |
| `GET` | `/api/conversations` | `{ conversations: [...], current }` |
| `POST` | `/api/conversations` | `{ action: "new" }` files the open conversation away; `{ action: "load", id }` reopens an archived one |
| `GET` | `/api/settings` | public settings + settings file path |
| `POST` | `/api/settings` | partial update; returns `{ settings, changed, notices }` |
| `POST` | `/api/settings/reload` | reload from disk |
| `GET` | `/api/models` | `?profile=<id>` — ask that endpoint which models it serves (remembers the list **and** the context lengths it reports). With `syncLocalModels` on, the answer also carries `endpoints` (every local server, with its route and error), `merged` (all models, each with its `endpointId`) and `context` |
| `GET` | `/api/mcp` | the MCP master switch and every server, with connection state, self-reported name and live tool list |
| `POST` | `/api/mcp` | `{ action: "refresh" }` · `{ action: "add", id, server }` · `{ action: "update", id, server }` · `{ action: "remove", id }` · `{ action: "toggle", id, enabled }` |
| `GET` | `/api/skills` | `{ dir, skills }` — every skill in the folder (name, description, when, files, problem); `?name=<id>` returns that one with its `body` |
| `POST` | `/api/skills` | `{ name, description, when, body }` — create or replace a skill; 400 with the reason when the name or the body is missing |
| `POST` | `/api/skills/delete` | `{ name }` — remove the skill folder (404 when it does not exist) |
| `GET` | `/api/capabilities` | what the model is offered right now: `{ tools, withheld, skills, mcp, agentMode, contextLimit }` |
| `GET` | `/api/fs/list` | `?path=<dir>` — sub-folders (and `parent`) for the chat folder picker; an empty `path` lists the drives. Directories only, no files |
| `POST` | `/api/diagnose` | probe the endpoint and return `{ checks, context, verdict, text }` |
| `POST` | `/api/profiles` | `{ action: "use"\|"save"\|"create"\|"remove", id, ... }` — manage endpoints |
| `POST` | `/api/chat` | `{ message }` — start a task (results arrive on the event stream); while a turn is running the message is **queued** and answered with `{ ok, queued: true, position, id }` |
| `GET` | `/api/queue` | `{ items, running, limit }` — messages waiting for the running turn |
| `POST` | `/api/queue` | `{ action: "remove", id }` or `{ action: "clear" }` — drop one or all queued messages |
| `GET` | `/api/turns` | the last few turns with the files each changed (`{ turns: [{ id, time, at, files: [{ path, seq, action, tool, summary, undoable, restorable }] }] }`) |
| `POST` | `/api/versions/restore` | `{ seq }` — put that file back to what change `#seq` produced (the "Restore this version" item); 400 with the reason when there is no saved version |
| `POST` | `/api/abort` | stop the task that is running |
| `POST` | `/api/terminal` | `{ input }` — run a shell line or an internal `/command` |
| `POST` | `/api/approve` | `{ id, approved }` — answer an approval prompt |
| `POST` | `/api/reset` | file the conversation away and start a new one |
| `POST` | `/api/port` | `{ port }` — move the web UI to another port |
| `GET` | `/api/events` | Server-Sent Events stream |

Event types on `/api/events`: `user`, `assistant`, `delta`, `thinking`, `step`,
`tool_call`, `tool_result`, `usage`, `context`, `approval`, `approval_result`, `done`,
`stopping`, `stopped`, `error`, `status`, `settings`, `terminal`, `reset`,
`reload_history`, `archived`, `server_restart`, `notice`, `queue`, `turn`.

`delta` carries one live piece of the answer (`{ text }`), `thinking` reports how much
a reasoning model has thought so far (`{ chars }`), `stopped` means the user cancelled
the turn, `context` reports the budget of a request that had to be trimmed
(`{ estimatedTokens, limit, budget, droppedMessages, truncatedToolResults }`), and
`turn` is sent when a turn ends with `{ turn }` — the files it changed, ready for the
card under the answer.

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
  audit.ts        the change log (data/audit.jsonl) — which is also the undo stack — plus the copies kept in data/undo/
  sandbox.ts      the folder fence and the command fence: the working-directory root, jailPath(), scanScript(), refusals
  skills.ts       data/skills/<name>/SKILL.md: the header block, the one-line prompt index, and reading a skill's files
  version.ts      reads the version from package.json (one source of truth)
  context.ts      token estimation + context budgeting (what to send, what to trim)
  providers.ts    endpoint compatibility memory + context-length discovery
  mcp.ts          MCP client: stdio + Streamable HTTP, tool discovery, call routing
  mcp-server.ts   MCP server: the same tools over stdio, for another agent (--mcp-server)
  diagnose.ts     the /diagnose probes (chat, usage, tools, streaming, context)
  commands.ts     internal "/command" dispatcher
  terminal.ts     terminal runner with a remembered working directory
  agent.ts        agent loop + text tool-call fallback + abort/stream plumbing
  llm.ts          OpenAI-compatible client: tool calling, SSE streaming, retries, usage
  web/            browser UI (index.html, styles.css, app.js)
  tools/
    registry.ts   Tool/ToolContext types, argument validation, catalog
    files.ts system.ts processes.ts services.ts network.ts web.ts
    automation.ts ui.ts powershell.ts custom.ts skills.ts
    index.ts      assembles the tool set from settings
  util/ps.ts      PowerShell runner (-EncodedCommand) + JSON helpers, culture pin,
                  CLIXML decoding, elevation probe, process-tree timeouts
  util/json.ts    reads JSON files the way Windows writes them (BOM-tolerant)
  util/text.ts    text encodings the way Windows writes them (UTF-8/UTF-16 BOM,
                  BOM-less UTF-16, binary detection)
  util/exec.ts    resolving an executable through PATH + PATHEXT + known locations
scripts/
  clean.mjs       empties dist/ before a build
  copy-assets.mjs copies the web UI into dist/
  version.mjs     version: show / bump / back up one folder per version
  test-context.mjs    model-free checks for the context planner (npm test)
  test-providers.mjs  endpoint-compatibility checks against a mock server
  test-mcp.mjs        MCP client checks (stdio + HTTP) against a mock MCP server
test-mcp-server.mjs the other direction: JSON-RPC over stdio, tool calls, the approval rule
  test-models.mjs     local model discovery: LM Studio / Ollama routes, merging
  test-isolation.mjs  two copies never share data or a version number
  test-mode.mjs       agent modes + JSON repair + encodings (model-free, any platform)
  test-sandbox.mjs    the folder fence and the command fence (model-free, Windows paths)
  test-agent.mjs      the agent loop: loop guard, step limit, result trimming (mock model)
  test-skills.mjs     the skills folder: header block, prompt index, the tool, containment
  test-i18n.mjs       the en/zh dictionaries, the HTML attributes and the help text
  test-docs.mjs       the docs against the code: routes, settings, commands, links
  test-api.mjs        the real HTTP server + a mock model, on a temp data folder
  test-audit.mjs      the change log and undo, against a temp folder (live on Windows)
  test-windows.mjs    live Windows checks: PowerShell, elevation, files, services
  test-all.mjs        runs the suites in order (npm run test:all), one annotation on failure
  fixtures/
    mock-mcp-server.mjs  a tiny MCP server used by test-mcp.mjs
.github/workflows/
  ci.yml          typecheck + build + the whole suite on windows-latest (node 20 & 22)
examples/         copy-paste examples: tool calls, prompts, custom commands,
                  MCP servers, HTTP API scripts, ready-made settings.json files
versions/
  INDEX.md        index of the backups (written by npm run release)
  1.1.0/          one folder per version: the complete agent at that version
  1.1.1/
  1.2.0/
  1.3.0/
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
npm run test:mcp            # MCP client checks against a mock MCP server (stdio + HTTP)
npm run test:mcp-server     # MCP server mode: the handshake, tools/list, calls, approvals
npm run test:models         # local model sync: LM Studio / Ollama discovery + merging
npm run test:isolation      # two copies never share data or a version number
npm run test:mode           # agent modes, JSON repair, encodings (no model needed)
npm run test:sandbox        # the folder fence and the command fence (no model needed)
npm run test:agent          # the agent loop: guard, step limit, trimming (mock model)
npm run test:skills         # the skills folder, the header block and the skills tool
npm run test:i18n           # both dictionaries, the HTML keys and the help text
npm run test:docs           # the docs against the code: routes, settings, links
npm run test:api            # the whole HTTP API, against a mock model
npm run test:audit          # the audit log and undo, against a temp folder
npm run test:windows        # live Windows checks: PowerShell, elevation, files, services
npm run test:all            # all of the above, in order (scripts/test-all.mjs)
```

**One version = one folder.** `npm run release` copies the complete agent into
`versions/<version>/` — `src/`, `scripts/`, `examples/`, `.github/`, the configs and
the docs, plus a `version.json` manifest — and refreshes `versions/INDEX.md`.
`node_modules`, `dist`, `data` and the other versions are never copied, so a folder is
a clean, standalone copy of that release. Add `--tar` to also get a portable
`versions/<version>.tar.gz` (`node scripts/version.mjs --snapshot --tar`, e.g. to carry
it to another machine).

Two guards keep a version from going missing: `npm run version:set` refuses to bump
the version while the current one has no backup (`--force` overrides), and
`npm run version:show` reports how many files have drifted from the newest backup
(`npm run version:diff` lists them).

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main`,
every tag and every pull request — no model, no LM Studio/Ollama, no network beyond
`npm ci`:

| Job | Runs | What it proves |
| --- | --- | --- |
| `windows-latest · node 20.x` and `· node 22.x` | `npm ci` → `typecheck` → `build` → `test:all` | the documented minimum Node version works, the build is clean, and every suite passes on a machine that is not yours |
| `docs and examples` (ubuntu) | `typecheck`, the platform-independent suites, `test:docs` | nothing in the pure code accidentally depends on Windows, and `test:windows` **skips cleanly** off Windows |

The Windows job runs the *live* checks too (`test:windows`): a real PowerShell, real
UTF-16 files, the real registry. Nothing is mocked there except the model endpoint,
which is a throwaway HTTP server built into the suite.

`npm run test:all` runs the suites one after another (`scripts/test-all.mjs`) and stops
at the first failure. A failing check is echoed as a GitHub **annotation** as well as a
plain log line: a job's log needs an authenticated request to read, while annotations are
public — so a red run says *which* check broke without anyone having to open it.

Four suites exist specifically to keep this repository honest as it grows:

- **`test:api`** starts the real server (`src/server.ts`, temp data folder) and a mock
  model, then drives every route the browser UI uses: settings round-trips, a refused
  value changing nothing, profile add/use/remove, the terminal (`/status`, `/mode`,
  a failing shell command), conversations, usage, abort/approve, port validation — and
  one complete model turn, checked all the way into `data/history.json`.
- **`test:i18n`** reads both dictionaries out of `src/web/app.js` and compares them key
  by key: nothing missing in `zh`, no placeholder added or dropped, every
  `data-i18n` attribute and every `t()` call resolvable, no unused string — then does
  the same for the terminal messages and checks that `/help` only advertises commands
  that really exist.
- **`test:docs`** reads the README, the CHANGELOG and `examples/` against the source:
  every route the server answers is documented (and vice versa), every settings key in
  the reference table is a real setting **with the documented default**, every
  `/command` in the tables is implemented, every `AGENT_*` variable exists, every
  relative link and every `#anchor` resolves, and every example file is indexed.
- **`test:agent`** drives the real agent loop against a mock model and a fake tool:
  the same call answered with the same result twice is not run a third time, a poll
  whose answer changes never is, the step limit ends the turn with a message that
  names the limit and the way on (in both languages), and a 200 000-character tool
  result is trimmed with a note before it is stored.
- **`test:skills`** writes real skills into a temp data folder: the header block is
  parsed (quotes, a BOM, CRLF, `when_to_use`, and a file with no header at all), the
  prompt index carries one line per skill and never the body, a broken `SKILL.md` is
  reported instead of hidden, the `skills` tool lists/loads/reads, `../` and absolute
  paths out of a skill folder are refused, and a delete really removes the folder.
- **`test:audit`** records real changes in a temp folder and then reverses them for
  real: a file is written, appended to, edited, moved, copied and deleted (a folder
  tree included), registry values are set and removed, an environment variable is
  created and restored, and after every one of them `/undo` is asked to put the
  machine back — byte for byte, type for type. It also pins the cases that must *not*
  claim to be undoable, and that guided mode never offers the raw shell. A second
  `AuditLog` over the same folder stands in for a restart and proves the stack comes
  back — and that a copy aged past the retention window is swept away *and* its entry
  stops offering a rollback.

Run them locally the same way CI does:

```powershell
npm run test:i18n && npm run test:docs && npm run test:api && npm run test:audit
```

A bug that `test:api` caught on its first run is worth knowing about, because it is the
kind only an end-to-end test finds: `GET /api/state` could answer while the PowerShell
probe was still running, and that early reply carried a half-filled `windows` object
(elevation known, version and edition still empty) — which the Settings panel then
cached. The probe is now published in one piece, and `test:windows` pins it.

### Version isolation / 版本隔离

Copies must never share anything by accident. Everything the agent resolves for itself
is anchored to the folder it was **installed** in — the one above its own
`src/`/`dist/` — not to the working folder:

| Resolved | Anchored to | Why it matters |
| --- | --- | --- |
| data folder | the installation | `versions\1.1.0` and the working copy keep separate settings, conversations and totals |
| version number | that folder's own `package.json` | the banner, the sidebar and `/version` report *their* version, not the neighbour's |
| web UI files | `src\web` / `dist\web` of that copy | a copy can never serve another copy's UI |
| legacy `.win-agent/` | the installation first, then the working folder | old data is picked up once, never stolen from a sibling copy |

`AGENT_DATA_DIR` is the one deliberate exception: point two copies at the same folder
and they share *on purpose* — that is how you carry your settings to a new version.

`npm run test:isolation` proves the rule: it builds three throwaway installations in a
temp folder, asks one of them for its folders while standing in another, and checks that
each reports its own installation, its own `data/` and its own version.

Restoring a version is just running it:

```powershell
cd versions\1.1.0
npm install
npm run web        # or: npm run build && node dist/server.js --no-open
```

Settings and conversations live in that folder's own `data/` (or `AGENT_DATA_DIR`), so a
restored copy starts clean and cannot disturb the copy you are already using — copy
`data/settings.json` across if you want it to start with your API keys.

### 版本库 / git

A folder copy shows you *what* a version looked like; git remembers *why* it changed.
`D:\new` is a git repository (branch `main`) and every release gets a tag, so the two
together mean no version can be lost again.

Git is **PortableGit 2.56** in `%LOCALAPPDATA%\Programs\PortableGit` (installed
per-user, no admin rights needed) and its `cmd\` folder is on your user `PATH`, so a
freshly opened terminal can just run `git`. To move it elsewhere, install the full
build with `winget install --id Git.Git -e` (that one asks for admin) or extract a
newer [PortableGit](https://github.com/git-for-windows/git/releases) yourself.

```powershell
git log --oneline --decorate     # the history, with the version tags on it
git show v1.1.0 --stat           # what 1.1.0 contained
git diff                         # what you changed since the last commit
git checkout v1.1.0              # look at an old version (git switch main to come back)
```

The release routine is four steps — **bump, commit, back up, tag**:

```powershell
npm run version:set 1.2.0                  # 1. package.json + a CHANGELOG section
# ... describe the change under [1.2.0] in CHANGELOG.md ...
git add -A && git commit -m "1.2.0: ..."   # 2. record the change
npm run release                            # 3. build + versions/1.2.0/ + INDEX.md
git add -A && git commit -m "1.2.0: snapshot"   # 4. the new folder is part of the release
npm run version:tag                        #    -> tag v1.2.0 on that commit
```

`npm run release` tags by itself when the tree is already clean; because `versions/` is
committed, the freshly written folder makes step 4 necessary and the script says so
(`tag: skipped - 1 uncommitted change(s); commit first, then npm run tag`). Either way a
tag ends up pointing at exactly the code that is in `versions/<version>/`. `versions/`
**is** committed, so GitHub shows one folder per version next to the working copy;
`data/` (it holds your API keys), `dist/` and `node_modules/` stay local (`.gitignore`)
because they are either secret or reproducible. History starts at **v1.1.0**: the 1.0.0
source only ever existed
in the working folder before the backup and git tooling existed, so it is not
recoverable, and the `CHANGELOG.md` entry is all that remains of it.

---

## Measuring a model — `npm run eval`

The test suites answer *"is the code right?"*. They cannot answer *"can this model
actually do the job?"* — that depends on the model, and on the day. `npm run eval` is
the other half: 26 small Windows jobs, run through the **real** HTTP server, the real
tools and the real prompts, then checked by **looking at the disk** — never at what the
model said it did.

```powershell
npm run eval                                  # the model in settings.json
npm run eval -- --model qwen/qwen3.8-27b      # a specific one
npm run eval -- --only write_exact,multi_mixed --verbose
npm run eval -- --mode normal                 # full toolset instead of guided
```

Each task gets a fresh conversation and its own folder inside a temp workdir; the
sandbox is on and approvals are automatic *inside that folder only*, so a model that
wanders is refused instead of touching your files. A task is a pass only if the result
is on disk (or, for reading tasks, in the final answer).

The first 20 are the floor — single file operations, an edit, a JSON field, a zip
round-trip, a UTF-16 edit, plus `whoami` and free space. The last 6 are the interesting
ones: compute a column total, find the one config with `mode=dev`, rename four files by
a pattern, move three files into a new folder tree, find the line two files share, and
edit a UTF-16 file without turning it into UTF-8.

Baseline, guided mode, one run each (`data/eval/*.json` keeps every result):

| Model | Loaded as | Result | Time | Tokens |
| --- | --- | --- | --- | --- |
| `qwen/qwen3.8-27b` | Q6_K | **26/26** | 2.1 min | 510 282 |
| `qwen3.6-35b-a3b` | Q6_K | 24/26 | 3.8 min | 570 729 |

The two failures of the second model were *empty replies* (the UI shows “模型没有给出回复”),
not wrong files — which is exactly the kind of thing a benchmark should catch and a
test suite never will. Re-run before believing a number: a local model is not
deterministic.

`npm run test:eval` runs the same 26 checks **without a model**: every check must reject
an untouched folder and accept the result a correct agent would produce, so a check that
is always green (or always red) fails CI. That suite is part of `npm run test:all`.

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
- `sandbox` is on by default: every file path stays inside the working directory, and a
  PowerShell script is read before it runs (see [Sandbox](#sandbox)).
- The raw `powershell` tool and all `custom` commands are always confirmed.
- **MCP tools** are confirmed on every call unless you mark that server
  **auto-approve** — remember an MCP server is a program that runs with *your*
  rights, over a command line you typed.
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
| Wrong working directory | set `workdir` in Settings (the terminal cwd follows it), or pick one in the chat toolbar |
| A chat model is missing from the picker | press **Refresh models** — the list is what the servers report. `syncLocalModels` merges LM Studio and Ollama; a server that is not running shows *no answer* |
| An MCP server never connects | the *MCP* panel shows the reason: a typo in the command line, `npx` not installed, a URL that is not listening. `node`/`npx` are resolved through `PATHEXT`, so you do not write `.cmd` yourself |
| MCP tools are not offered to the model | the master switch is off, that server's switch is off, or the tools are switched off in *Enabled tools*. `/mcp` and `/mcp tools` say exactly what is live |
| An MCP tool fails without a reason | open the tool card in the chat log (or the server's own output) — MCP errors are passed through verbatim |
| Web search returns nothing | the search page may have changed or be blocked — set **Web search page** to one that works (try `https://html.duckduckgo.com/html/?q={q}` or your own SearXNG) |
| Reply appears all at once | `stream` is off, or the endpoint ignores `stream: true`; turn **Stream replies** on |
| The reply is empty — `(no answer: the model returned an empty reply after N characters of thinking…)` | `glm-4.7-flash` sends the whole completion back in its reasoning channel: LM Studio logs `↓94 (88 reasoning)` and no text. The agent asks once more automatically; if it is still empty, send the message again, raise the model's output limit in LM Studio, or lower `contextLimit` — a very long prompt makes this more likely. `/diagnose` shows whether the endpoint can return text at all |
| `this model's maximum context length is N tokens` | the endpoint reported a window bigger than the model really has — set `contextLimit` to the real one (LM Studio shows it next to the context slider), or run `/context` to see what the agent thinks it is |
| The agent "forgets" the beginning of a long task | expected: the request was trimmed to fit. Raise `contextLimit` (if the model can take it) or start a new conversation — the old one is archived, not lost |
| Endpoint errors about `tools` / `stream` | `/diagnose` shows which field it rejects; the agent already retries without it and remembers. `/caps` lists what was dropped |
| Requests time out on the first call | a local server is loading the model — raise `requestTimeoutMs`, or warm the model up with `/diagnose` first |
| `429` from a cloud API | raise `maxRetries`; the agent waits the `Retry-After` the API asked for |
| My settings are ignored | `data/settings.json` had a BOM (harmless, it is reported) or a syntax error (not harmless) — the startup line / Settings tab says which. Fix the file or delete it |
| A restored version "has no settings" | by design: each folder has its own `data/`. Copy `data/settings.json` into it, or set `AGENT_DATA_DIR` so both copies share one folder |
| Reset everything | delete the `data/` folder |

---

## License & attribution

**Apache License 2.0** — the full text is in [LICENSE](LICENSE). win-agent is
open-sourced under it, and you are explicitly encouraged to use it for commercial or
open-source projects, forks, plugins and extensions. The copyright notice and the
attribution requirement live in [NOTICE](NOTICE), which travels with every released copy
(each folder under `versions/` contains both).

To help build a thriving ecosystem, there is one simple request: **if you build
derivative plugins, forks, or projects based on this work, credit the original author**
in your project's README, documentation or user interface.

👉 Author: **zhoubingxuan** / win-agent

Apache 2.0 §4(d) is what makes that stick: a redistribution has to carry the contents of
the `NOTICE` file, so keep it (and this attribution) with whatever you build on top of
win-agent.
