# Agent modes — `guided` vs. `normal` / 智能体模式

win-agent drives a 3B–14B model well *and* a cloud model well, and those two need
different amounts of hand-holding. `agentMode` is that one switch.

| Mode | Default for | What the model is given |
| --- | --- | --- |
| `guided` | **small local models** | prompt + numbered operating procedure, required arguments spelled out, one tool call per step, **no raw shell tool** |
| `normal` | large / cloud models | prompt + tool catalogue (shell included), any number of tool calls per step |

## Switching / 切换

Three identical ways — all three write the same setting to `data/settings.json`:

```powershell
# 1. Settings tab -> "Agent mode": the normal <-> guided slider
# 2. terminal:
PS> /mode                 # print the current mode
PS> /mode guided          # high supervision
PS> /mode normal          # plain prompt
# 3. any setting surface:
PS> /set agentMode guided
PS> /unset agentMode      # back to the default (guided)
```

```jsonc
// data/settings.json
{ "agentMode": "guided" }
```

```powershell
# or per shell, no file change:
$env:AGENT_MODE = "normal"; npm run web
```

`normalizeAgentMode` accepts aliases: `guided`, `guide`, `supervised`,
`supervision`, `strict`, `监督`, `高监督`, `严格` → `guided`; `normal`, `plain`,
`standard`, `off`, `普通`, `正常` → `normal`. Anything else, or no `agentMode` at
all, means `guided`.

## What `guided` actually adds to the prompt

Appended *after* your `systemPrompt`, in the configured `language` (this is the
English version; a Chinese one ships too):

```
Operating procedure (follow it exactly):
1. Call ONE tool per step, with a single JSON object of arguments. Never call two tools at once.
2. Wait for the tool result and read it before deciding the next step. Never assume a call worked.
3. Only use the tool names listed above. If none fits, say so in plain text - do not invent a tool.
4. Use exactly the argument names documented above; do not add other keys.
5. If a result starts with 'Error:' or 'Refused:', fix the arguments and call the SAME tool again. After two failures, explain the problem in plain text and stop.
6. Write paths exactly as the user gave them (C:\Users\Name\file.txt); never guess a path.
7. Before a destructive step (delete, move, kill, stop a service, change the registry, shut down), say in one short sentence what you are about to do.
8. When the task is done, answer in plain text with a short summary of what you did, and do not call a tool.
9. There is no shell in this mode: never write command lines, scripts or registry paths. Every step is one of the tool actions listed above.
```

## The raw shell is withheld in `guided` mode

`guided` mode exists for models that cannot write PowerShell. So it does not offer the
`powershell` tool at all: the tool is still registered (the **Tools** panel and
`/tools` show it, marked `not offered`), but it is taken out of the schemas sent to the
endpoint and out of the catalogue in the system prompt. The model cannot imitate what
it cannot see.

If a model calls it anyway — small models do re-use names they learned in training —
the answer is not `unknown tool`, it is the way out:

```
Error: the raw shell is switched off in guided mode. do not write commands or scripts.
Use the structured tools instead: system (action "disk" for free space), files,
services, processes, network, registry, scheduled_tasks
```

Every action a small model needs already exists as a structured tool:

| Instead of this script | It calls |
| --- | --- |
| `Get-CimInstance Win32_LogicalDisk …` | `system { action: "disk" }` |
| `Get-Service`, `sc.exe query` | `services { action: "status", name: "Spooler" }` |
| `Get-Process`, `Stop-Process` | `processes { action: "list" }` |
| `Get-Process -Id … \| Select-Object` | `processes { action: "info", name: "chrome" }` |
| `Get-NetIPAddress`, `ipconfig` | `network { action: "ip" }` |
| `Get-ChildItem … -Recurse` | `files { action: "tree", path: "D:\logs" }` |
| `Get-ItemProperty HKCU:\…` | `registry { action: "get", path: "HKCU:\…" }` |

Your own `custom` commands (see [custom-commands.md](custom-commands.md)) and the
terminal (`/exec`, the Terminal tab) are *not* affected — they are yours, not the
model's. Switch to `normal` (`/mode normal`) when a large model should have the shell
back; nothing else changes.

## What `guided` adds to the tool catalogue

The catalogue in the system prompt is the same list of tools in both modes; in
`guided` mode every tool **also** lists its argument names, and marks the required
ones. A small model copies a name it can see far more reliably than one it has to
dig out of a JSON schema it never reads.

```
# normal
- registry: Read or modify the Windows registry. actions: get (values of a key), list (subkeys), ...
    action must be one of: get, list, set, delete

# guided
- registry: Read or modify the Windows registry. actions: get (values of a key), list (subkeys), ...
    action must be one of: get, list, set, delete
    arguments: path (required), name, value, type
```

```
# normal
- services: Manage Windows services without remembering sc.exe syntax. actions: list, status, ...
    action must be one of: list, status, start, stop, restart, enable, disable

# guided
- services: Manage Windows services without remembering sc.exe syntax. actions: list, status, ...
    action must be one of: list, status, start, stop, restart, enable, disable
    arguments: name, filter
```

It costs about 600 characters for the whole catalogue (3.4 KB → 4.0 KB on a default
install): far less than one wasted round trip.

## One tool call per step

Even if the model answers with three `tool_calls` in one message, guided mode runs
the **first** one and answers the others with a tool message:

```
Skipped: guided mode runs one tool call per step. This call was not executed - read
the result above, then call this tool again if it is still needed.
```

That keeps every step anchored to a real result. The model is never told a call ran
when it did not, and it is never allowed to plan four steps off a guess. Nothing is
lost: it can simply call the same tool on the next step.

## Which mode should I use?

| Your model | Use | Why |
| --- | --- | --- |
| LM Studio / Ollama 3B–9B (`qwen2.5:7b`, `glm-4.7-flash`, …) | `guided` | the explicit rules and the visible argument names remove the two commonest small-model failures: inventing a tool, and narrating success without calling anything |
| 14B local models | `guided`, try `normal` on your tasks | at 14B the argument list matters less; measure on your own workflow |
| GPT-4 class / Claude / DeepSeek via API | `normal` | capable models batch independent calls (read three files at once) and plan ahead correctly; the procedure only slows them down |

The mode touches nothing else — same tools (minus the withheld shell), same approval
prompts, same memory, same budget. You can switch mid-conversation.

## Checking which mode is live

```powershell
PS> /status
...
shell      : C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe 5.1.26100.9444
mode       : guided (one tool call per step, explicit procedure)
...
PS> /config agentMode
agentMode = guided
```

`GET /api/state` reports it too, and its `catalog` field returns the **verbose**
catalogue when guided mode is on — so a custom front end can show the model exactly
what it was told.
