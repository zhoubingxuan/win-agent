# Skills / 技能包

Each skill is a folder under `data/skills/` with a `SKILL.md`. Copy one of the three
below into `data/skills/<name>/SKILL.md`, or paste it into **Settings → Skills**.
Nothing needs a restart: the next turn reads the folder.

A skill is *text*, not code. It cannot grant the model anything — every tool call it
leads to still needs the same approval, and runs inside the same sandbox and audit log.

The three fields in the header are the whole contract:

| Field | What it is for |
| --- | --- |
| `name` | the id the model calls `skills load` with (the folder name is used, not this field) |
| `description` | the one line that appears in the prompt index |
| `when` | when to reach for it — the sentence that decides whether the model loads it at all |

---

## 1. Clean the temp folder

`s data/skills/clean-temp/SKILL.md`:

```markdown
---
name: clean-temp
description: Find old files in %TEMP% and remove them safely
when: The user asks to free up disk space or clean temporary files
---
# Clean the temp folder

Never delete first. This is a "report, ask, then act" procedure.

1. Find the folder: `powershell` with `$env:TEMP` — or use `C:\Users\<you>\AppData\Local\Temp`.
2. `files list` it (not recursive) and report the ten largest items with their sizes.
3. Group them in the answer: "logs / caches / installers / unknown", and give a total.
4. Say what you would remove and ask the user. Do not remove anything on your own.
5. After an approval, remove one item at a time with `files delete`, and only files
   older than 7 days. Check free space at the end with `system` -> `disk`.

Do not touch: anything in `Windows\Temp` that is currently open, anything whose name
starts with `~`, and anything modified today.
```

The prompt index gains exactly one line:

```text
- clean-temp: Find old files in %TEMP% and remove them safely - when: The user asks to free up disk space or clean temporary files
```

## 2. A service restart checklist

`data/skills/restart-service/SKILL.md`:

```markdown
---
name: restart-service
description: Restart a Windows service and prove it came back
when: The user asks to restart, bounce or recover a service
---
# Restarting a service, with proof

1. `services` -> `status` for the short name (e.g. Spooler). If it is not found, stop
   here: the name is wrong, do not guess another one.
2. Report the current state and the start type before changing anything.
3. If the service is running, `services` -> `stop`, then `status` again. A service can
   take ten seconds to stop; wait by checking, not by repeating the same call with the
   same arguments.
4. `services` -> `start`, then `status`. The restart only counts if the state is
   `Running` afterwards.
5. If it fails to start, read the hint in the error (permission vs. dependency) before
   trying anything else, and put the failure in the answer with the error text.

Never change the start type (`Automatic`, `Manual`, `Disabled`) unless the user asked
for that specifically.
```

## 3. A weekly report

`data/skills/weekly-report/SKILL.md`:

```markdown
---
name: weekly-report
description: Collect disk, memory, uptime and service health into one short report
when: The user asks for a weekly status report or a health check of this machine
---
# Weekly report

Collect first, write once. Do not answer until all four sections have data.

1. Disk: `system` -> `disk`. Report free space per drive, and flag anything below 10%.
2. Memory: `system` -> `memory`. Report used/total and the percentage.
3. Uptime and load: `system` -> `info`; note the last boot time and the top three
   processes by memory from `processes` -> `list`.
4. Services: `services` -> `list` filtered to automatic ones that are not running.
5. Write the report with one heading per section, numbers in a table, and a final
   "needs attention" list. No more than 25 lines.

If a tool fails, say which section is missing and why. Never fill a gap with a guess.
```

---

## How the model is told

Only the header is in the prompt. For the three skills above the block is:

```text
Skills (procedures you can load when they fit; call the `skills` tool with action "load"):
- clean-temp: Find old files in %TEMP% and remove them safely - when: The user asks to free up disk space or clean temporary files
- restart-service: Restart a Windows service and prove it came back - when: The user asks to restart, bounce or recover a service
- weekly-report: Collect disk, memory, uptime and service health into one short report - when: The user asks for a weekly status report or a health check of this machine
Load a skill before starting a task it covers; it is written as steps for you to follow with the normal tools.
```

Then, when the task is *"帮我看看这台机器这周有什么问题"*, the turn looks like:

```text
skills load {"name":"weekly-report"}
→ Skill "weekly-report": Collect disk, memory, uptime and service health into one short report

  # Weekly report
  1. Disk: ...
  ...

system {"action":"disk"}            (the steps, followed with the normal tools)
system {"action":"memory"}
...
```

## Files next to SKILL.md

A skill can ship examples, a template, a long checklist:

```text
data/skills/clean-temp/
  SKILL.md
  examples.txt
```

The body can say *"see examples.txt"*, and the model reads it with
`skills read {"name":"clean-temp","path":"examples.txt"}`. That path is confined to the
skill's own folder: `..\..\settings.json` is refused, an absolute path is refused, and a
missing file lists what is actually there.

## Writing one that a small model can follow

- **One action per step.** "List first, then ask, then delete" beats "clean up carefully".
- **Name the tool and the action.** `services` -> `stop`, not "stop the service".
- **Say what not to touch.** The negative rules are what stop a 7B model from being
  helpful in the wrong direction.
- **Say when to stop.** A step that ends the procedure ("if the name is not found, stop
  here") is worth more than a tenth step.
- **Keep it short.** If it does not fit on one screen, split it into two skills.
