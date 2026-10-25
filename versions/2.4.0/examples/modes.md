# Agent modes — auto, guided, normal, expert / 智能体模式

win-agent drives a 3B model and a GPT-4-class model with the same tools, but they need
different amounts of hand-holding. `agentMode` is that one switch.

| Mode | Default for | What the model is given |
| --- | --- | --- |
| `auto` | **almost everyone** | uses the measured profile when one exists, then falls back to the endpoint and model name |
| `guided` | small local models | prompt + numbered operating procedure, required arguments spelled out, one tool call per step, **no raw shell tool** |
| `normal` | a model you want unmanaged | prompt + full catalogue, any number of tool calls per step, shell included |
| `expert` | cloud APIs and local models 14B+ | short prompt + brief catalogue, batched calls encouraged, shell included |

`auto` is a resolver, not a fifth behaviour. It checks for a **measured model
profile** first (Settings → Model profile → Test this model); if there is one for this
endpoint + model, its recommendation is used. Otherwise the old heuristic applies:

- a profile with `kind: "api"` → **`expert`**;
- a local model whose name contains a size of at least **14B**
  (`qwen3-coder-30b-a3b` → 30B) → **`expert`**;
- everything else → **`guided`**.

The UI shows both values (`auto → expert`), `/status` prints the resolved mode, and
`GET /api/settings` exposes `agentModeEffective`. An explicit `guided`, `normal` or
`expert` always wins over the resolver.

## Measured profile / 实测档案

Seven small tasks (read, write, patch, multi-step, recovery, instruction, system tool)
run in a temporary folder, through the normal agent loop, with only `files`,
`apply_patch`, `system` and `todo`. The result is stored per endpoint + model in
`data/model-profiles.json` and is visible in Settings with every check and its reason.
`GET /api/model-profiles` reads it; `POST /api/model-profiles` with
`{ "action": "run" }` starts a probe, `{ "action": "cancel" }` stops it, and
`{ "action": "delete", "key": "..." }` forgets one. A dead endpoint is reported as a
failed test and is not saved as a 0% profile.

## Switching / 切换

Four identical ways — all write the same setting to `data/settings.json`:

```powershell
# 1. Settings tab -> "Agent mode": the auto -> guided -> normal -> expert slider
# 2. terminal:
PS> /mode                 # print the setting and what it resolves to
PS> /mode auto            # follow the endpoint/model
PS> /mode guided          # high supervision
PS> /mode normal          # plain prompt
PS> /mode expert          # fast workflow for capable models
# 3. any setting surface:
PS> /set agentMode auto
PS> /unset agentMode      # back to the default (auto)
```

```jsonc
// data/settings.json
{ "agentMode": "auto" }
```

```powershell
# or per shell, no file change:
$env:AGENT_MODE = "auto"; npm run web
```

`normalizeAgentMode` accepts aliases in both languages:

- `guided`, `guide`, `supervised`, `supervision`, `strict`, `监督`, `高监督`, `严格`
  → `guided`;
- `normal`, `plain`, `standard`, `off`, `普通`, `正常` → `normal`;
- `expert`, `fast`, `efficient`, `专家`, `快速` → `expert`;
- `auto`, `automatic`, `自动` → `auto`;
- anything else, or no `agentMode` at all, → `auto`.

`agentMode` is the *setting*. Internally the agent stores the **resolved** mode in
`Config.agentMode`, so the prompt, catalogue and per-step policy never see `"auto"` as
a behaviour they have to interpret.

## What `guided` adds to the prompt

Appended *after* your `systemPrompt`, in the configured `language` (English version;
a Chinese one ships too):

```
Operating procedure (follow it exactly):
1. Call ONE tool per step, with a single JSON object of arguments. Never call two tools at once.
2. Wait for the tool result and read it before deciding the next step. Never assume a call worked.
3. Only use the tool names listed above. If none fits, say so in plain text - do not invent a tool.
4. Use exactly the argument names documented above; do not add other keys.
5. If a result starts with 'Error:' or 'Refused:', fix the arguments and call the SAME tool again. After two failures, explain the problem in plain text and stop.
6. Write paths exactly as the user gave them (C:\Users\Name\file.txt); never guess a path.
7. Before a destructive step (delete, move, kill, stop a service, change the registry, shut down), say in one short sentence what you are about to do.
8. If the request has two or more parts, call todo with action "set" first (one item per part), then mark each item "done" as you finish it.
9. To change code, read the file first, then use apply_patch with a unified diff; afterwards run the tests tool if the project has tests. Never overwrite a file you have not read. For a .zip use files action zip/unzip, not a script.
10. When the task is done, answer in plain text with a short summary of what you did, and do not call a tool.
11. There is no shell in this mode: never write command lines, scripts or registry paths. Every step is one of the tool actions listed above.
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
model's. Switch to `normal` or `expert` when a capable model should have the shell
back; nothing else changes.

## What `guided` adds to the tool catalogue

The catalogue in the system prompt is the same list of tools in every mode. In
`guided` mode every tool **also** lists its argument names and marks the required
ones. A small model copies a name it can see far more reliably than one it has to dig
out of a JSON schema it never reads.

```
# normal
- registry: Read or modify the Windows registry. actions: get (values of a key), list (subkeys), ...
    action must be one of: get, list, set, delete

# guided
- registry: Read or modify the Windows registry. actions: get (values of a key), list (subkeys), ...
    action must be one of: get, list, set, delete
    arguments: path (required), name, value, type
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

`normal` runs every call. `expert` runs every call **and asks the model to batch
independent ones**, so three reads become one round trip instead of three.

## What `expert` changes

Expert mode keeps your prompt and the language rule, then adds five efficiency rules:

```
Expert mode (work efficiently):
1. Do not create a todo list for a one-step task. Use it only when the job has four or more distinct steps, and never restart a plan that is already done.
2. Batch independent tool calls in one reply when the API supports it; read their results together. Only sequence calls that depend on an earlier result.
3. Do not narrate routine reads, writes or scans. Skip the running commentary and spend the turn on the work.
4. Read a file before overwriting it. For code changes use apply_patch, then run the project's tests when they exist.
5. Keep the final answer short: what changed, where, and anything the user must know. Do not repeat tool output.
```

The catalogue is deliberately **brief** — one line per tool, without repeating actions
and arguments that the JSON schema already carries. That is where the token saving
comes from. The shell stays available; the checklist is not forced for small jobs;
batching is encouraged.

## Which mode should I use?

| Your model | Use | Why |
| --- | --- | --- |
| LM Studio / Ollama 3B–9B (`qwen2.5:7b`, `glm-4.7-flash`, …) | `auto` | resolves to `guided`: explicit rules and visible argument names remove the two commonest small-model failures — inventing a tool, and narrating success without calling anything |
| Local 14B–30B (`qwen3-coder-30b`, …) | `auto` | resolves to `expert`: the model can batch calls, and the shorter prompt saves context |
| GPT-4 class / Claude / DeepSeek via API | `auto` | resolves to `expert`; pin `normal` if you want the plain prompt instead |
| A model that ignores the expert rules | pin `guided` or `normal` | `auto` is a heuristic, not a guarantee; measure on your own tasks |

The mode touches nothing else — same tools (minus the withheld shell in `guided`),
same approval prompts, same memory, same budget. You can switch mid-conversation.

## Checking which mode is live

```powershell
PS> /mode
mode = auto -> expert  (auto | guided | normal | expert)
PS> /config agentMode
agentMode = auto
```

`GET /api/state` reports the resolved mode, and its `catalog` field returns the
catalogue the model actually received: verbose in `guided`, brief in `expert`, the
plain one in `normal`. `GET /api/settings` adds `agentModeEffective`, so a custom
front end can show the same `auto → expert` line.

## The checklist / 清单

All modes share the `todo` tool. `guided` adds rule 8: *if the request has two or more
parts, call `todo` with action `set` first, then mark each item `done`*. `expert`
asks for a list only when there are four or more distinct steps, so a one-line task
does not pay for a plan.

```text
you> 读一下 notes.txt，把端口改成 9090，然后汇报
tool> todo {"action":"set","items":["读取 notes.txt","把端口改成 9090","汇报结果"]}
      Checklist: 0/3 done
      1. [ ] 读取 notes.txt
      2. [ ] 把端口改成 9090
      3. [ ] 汇报结果
tool> files {"action":"read","path":"notes.txt"}
tool> todo {"action":"done","id":1}
      Checklist: 1/3 done
      ...
```

While the turn runs the list is drawn live above the composer; afterwards it stays
under the answer as a card (`✓` / `▶` / `○`), including how many items are still open.
If the model answers while one is open it is reminded — twice — and then may finish;
the card still shows the open item, so "done" is never taken on trust.

```powershell
PS> /set todoCheck false     # keep the list, drop the reminder
PS> /unset todoCheck         # back to the default (on)
```

```powershell
$env:AGENT_TODO_CHECK = "false"; npm run web
```
