# Sandbox — keeping the agent inside one folder / 沙箱

A small model that misreads a path is not a hypothetical: `C:\Users\me\Downloads` and
`C:\Users\me\Documents` look alike to a 7B model. So the agent ships **confined**: with
the sandbox on, every file path a tool is handed has to land inside the working
directory, and a PowerShell script is read before it runs.

The sandbox is **on by default** and it is a switch, not a checkbox buried in a config
file: the chat sidebar, the Settings tab, `/sandbox off` and `AGENT_SANDBOX` all flip
the same setting. See [Sandbox](../README.md#sandbox) in the README for the full story.

## What is confined, and what is not

| | Sandboxed? | Why |
| --- | --- | --- |
| `files` — list, read, write, copy, move, delete, zip… | **yes**, every path | this is where a wrong path hurts |
| `web` — `download` (the file it writes) | **yes** | it writes a file, so it obeys the same rule |
| `powershell` — a raw script | **yes**, read before it runs | a literal path out of the folder, a `..`, a `$env:` that resolves outside it, or a disk-destroying command is refused (see below) |
| audit backups under `data/undo/` | **yes**, they live in the install folder | they are the way back, not a way out |
| `custom` — your own PowerShell one-liners | no | they are code *you* wrote and approved, like an MCP server |
| `services`, `processes`, `registry`, `scheduled_tasks`, `system` | no — and not a path | each has its own tool and its own approval prompt |
| MCP servers | no | they are separate programs you configured; they run with your rights |

## A refused path, end to end

Task: *"看看 hosts 文件里有没有把某个域名指到 127.0.0.1"* with the working directory set
to `D:\projects\site`.

The model reaches for the file the way it knows it:

```json
{ "tool": "files", "arguments": { "action": "read", "path": "C:\\Windows\\System32\\drivers\\etc\\hosts" } }
```

Nothing is opened. The tool answers with the refusal, and the model reads it:

```text
Refused: C:\Windows\System32\drivers\etc\hosts is outside the sandbox (D:\projects\site),
so nothing was touched. Work inside D:\projects\site, change the working directory,
or switch the sandbox off in Settings.
```

That message is the whole point of the design: it names what was blocked, where the
fence is, and the three ways forward — so the next step is a decision, not a retry loop.
A model that understands it does one of these:

```json
{ "tool": "files", "arguments": { "action": "read", "path": "hosts.txt" } }
```
```text
Reading hosts.txt is fine — it is inside D:\projects\site. (The real hosts file lives
outside the sandbox; say the word and I will read it with the sandbox switched off.)
```

and a model that does not understand it gets the `Refused:` prefix, which the guidance in
`guided` mode tells it to treat as "fix the argument, do not repeat it".

The message is the same whether the path is relative (`..\..\Windows\...`), absolute, on
another drive, or reached through a junction that points out of the folder: links are
resolved before the decision, so `D:\projects\site\link\to\system32` is refused too.

## The command fence / 命令围栏

A script is harder than a path, because a script *makes* its paths while it runs. Since
1.6.0 the agent does the honest half of that job: with the sandbox on, `powershell`
is offered again (it is not withheld any more — see the note at the end), and the script
is **read before the approval prompt runs**.

```json
{ "tool": "powershell", "arguments": { "script": "Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts -TotalCount 5" } }
```
```text
Refused: "C:\Windows\System32\drivers\etc\hosts" is outside the sandbox (D:\projects\site),
so the script was not run. The sandbox is on (D:\projects\site): work inside that folder,
change the working directory, or switch the sandbox off in Settings.
```

What the scan looks at:

| In the script | Refused because |
| --- | --- |
| `C:\Windows\...`, `\\server\share\...` | a literal path outside the folder |
| `..\..\Windows\...`, `~\Documents\...` | the same path spelled relatively or from home |
| `$env:APPDATA\Thing` | `$env:` is resolved here, and the value is outside the folder |
| `$env:SOMETHING\Thing` where the variable is not set | a path that cannot be checked is not approved |
| `iwr https://… | iex` (also `irm`, `DownloadString`, `Invoke-Expression`) | it downloads code and runs it — nothing can read that safely |
| `Format-Volume`, `Clear-Disk`, `Initialize-Disk`, `Remove-Partition`, `diskpart`, `bcdedit` | it destroys a volume, a partition table or the boot configuration — no audit entry can put those back |

Everything else a script does is a *decision*, not a pattern match: it goes to the normal
approval prompt, where you see the script before it runs.

```text
> Get-ChildItem .\logs | Remove-Item -WhatIf
  (scanned: no path leaves D:\projects\site, nothing is downloaded) → approval prompt
```

Being straight about the limit, because it is the kind of thing that should be in the
docs and not discovered: this is a **guard, not a jail**. A path a script only learns
while it runs — `Join-Path $root $sub` where `$sub` came out of a file — cannot be read
by anything that reads text. Closing that needs an OS-level sandbox (a restricted token,
a job object, an AppContainer), which is a different piece of work. What the guard buys
today is that the obvious escape — and by far the most common one — is a clear refusal
*before* anything runs, instead of a post-mortem in the audit log.

## Switching / 切换

Four surfaces, one setting:

```powershell
# 1. the chat sidebar: the "Sandbox" switch (applies at once, and the tool chips update)
# 2. Settings -> "Sandbox": the same switch, with the meaning spelled out
# 3. terminal:
PS> /sandbox off      # let the agent work outside the working directory
PS> /sandbox on       # confine it again (this is the default)
# 4. any setting surface:
PS> /set sandbox false
```

```jsonc
// data/settings.json
{ "sandbox": false }
```

```powershell
# or for one shell only, no file change:
$env:AGENT_SANDBOX = "false"; npm run web
```

## Working outside the folder on purpose

The sandbox is a guard against mistakes, not a policy against admin work. When the task
really is outside — installing into `C:\Program Files`, editing `%APPDATA%\...`, reading
the real `hosts` — there are three honest options:

1. **Move the working directory** (`/cd D:\projects` or the folder picker in the chat
   toolbar) so the fence surrounds the work. Best when the job is one folder.
2. **Switch the sandbox off** for that session and turn it back on afterwards. The switch
   is one click in the sidebar; nothing else about the agent changes — approvals, the
   audit log and `dryRun` all still apply.
3. **Leave it on** and let the structured tools do the machine-level part: `services` can
   stop a service, `registry` can read and write keys, `scheduled_tasks` can create a
   task. None of those are file paths, and all of them ask before they change anything.

> Turning the sandbox off does not turn the approvals off. It also does not bring the raw
> shell back on its own in `guided` mode — that mode withholds the shell whatever the
> sandbox says, because a small model writing its own command line is the thing `guided`
> exists to prevent.

## What changed in 1.6.0

- **1.5.1** added the folder fence and withheld `powershell` and `custom` while it was on.
  Withholding worked, but it took the tool away rather than checking it: a legitimate
  `Get-ChildItem` was as impossible as a path escape.
- **1.6.0** offers `powershell` again with the sandbox on, and reads the script first
  (this page). `custom` is offered too: it is code you wrote and approved yourself.
- The copies that make an undo possible are now kept for `undoRetentionDays` (7 by
  default) instead of being swept on every start, and any single entry can be rolled back
  from Settings → *Change log and undo* — see
  [Audit log and undo](../README.md#audit-log-and-undo).
