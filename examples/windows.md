# Windows compatibility / Windows 兼容性

Every item below was a bug found on an ordinary Windows 11 machine, reproduced there,
fixed, and pinned by a test. `npm run test:windows` runs 57 checks **against the
machine you are on** — it starts a real PowerShell, reads a real service, writes real
UTF-16 files and kills a real hung process.

```
$ npm run test:windows
powershell binary
  ok   powershell.exe resolves to an absolute path
  ok   the version reads back
  ...
57 passed, 0 failed
```

## 1. PowerShell 5.1 *and* PowerShell 7

`powershell.exe` ships with Windows (Windows PowerShell 5.1); `pwsh.exe` does not
(PowerShell 7). The agent must work with whichever you have.

```powershell
PS> /status
shell      : C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe 5.1.26100.9444
PS> /powershell pwsh.exe     # use PowerShell 7 instead (Settings -> PowerShell binary)
PS> /powershell
```

- The binary is resolved through `PATH`, then `PATHEXT`, then the well-known install
  locations — so a bare `powershell.exe` or `pwsh.exe` works even when it is not on
  `PATH`. `resolvePowerShell()` returns `{ exe, found, tried }`; when nothing is found
  the error names what was tried instead of `spawn ENOENT`.
- `GET /api/state` → `windows` reports it:

  ```json
  { "exe": "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "found": true, "version": "5.1.26100.9444", "edition": "Desktop",
    "elevated": false, "englishErrors": true }
  ```

### Cmdlets that changed between the two versions

The agent deliberately does **not** use the ones that differ:

| Need | Not used (why) | Used instead |
| --- | --- | --- |
| ping | `Test-Connection -ComputerName` (no `-TargetName` on 5.1; `-ComputerName` is gone in 7) | .NET `System.Net.NetworkInformation.Ping` |
| port check | `Test-NetConnection` (slow, and returns an object, not a verdict) | `System.Net.Sockets.TcpClient` with an explicit timeout |
| connections | `Get-NetTCPConnection` (needs the `NetTCPIP` module) | `Get-NetTCPConnection` when present, otherwise `netstat -ano` |
| services | `Get-Service` + `StartType` (no `StartType` before Windows 10 1709) | `Get-Service` when it has `StartType`, otherwise the `Win32_Service` CIM class |

## 2. Error text you can actually read

### Errors were localized

A Chinese Windows answers `Access is denied` in Chinese, and a small model cannot use
that. The launcher pins PowerShell's **UI culture** to `en-US` before your script runs
(setting: `psEnglishErrors`, on by default; switch in Settings → **Windows**):

```powershell
PS> /set psEnglishErrors off   # keep your own language
```

Only the *messages* change. Dates and numbers keep your format — that matters for the
JSON the tools parse:

```powershell
PS> /exec [pscustomobject]@{ d = Get-Date "2026-01-02"; n = 1234.5 } | ConvertTo-Json -Compress
{"d":"2026/1/2 0:00:00","n":1234.5}      # date/number formatting untouched
```

One caveat: a **parse** error happens before the culture pin can take effect, so a
syntax error in a raw script stays localized. That is also why the built-in tools never
end a `runPsJson` script with `}` — `… } | ConvertTo-Json` is a parse error
(`EmptyPipeElement`) after the pin, which is exactly how that bug was found.

### PowerShell 5.1 wraps redirected errors in CLIXML

With stderr redirected, 5.1 writes the error as XML:

```
#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">
<S S="Error">Get-Service : Cannot find any service with service name 'x'.</S>
<S S="Error">所在位置 行:1 字符: 293</S><S S="Error">+ Get-Service -Name x</S>
<S S="Error">+                 ~</S>
<S S="Error">    + CategoryInfo : ObjectNotFound ...</S>
<S S="Error">    + FullyQualifiedErrorId : NoServiceFoundForGivenName</S>
</Objs>
```

`stripClixml()` decodes it, undoes the XML escaping (`&lt;` → `<`) and drops the
console-only noise: the source echo, the caret line, the localized location line and
`CategoryInfo`. You get the message, then **one** hint where it helps:

```
Error: Access to the path 'C:\Program Files\app' is denied.
(this needs administrator rights and win-agent is NOT elevated - restart win-agent from an elevated PowerShell, or ask the user to do it)
```

| The error contains | The hint says |
| --- | --- |
| `access is denied`, `0x80070005`, `requires elevation`, `requested registry access is not allowed` | that it needs administrator rights — and, knowing its own elevation state, whether to restart elevated or to check the object's permissions |
| `is not recognized as the name of a cmdlet`, `cannot find the path`, `no such file` | check the spelling and pass a full path |
| `cannot find any service … does not exist as an installed service` | use the short service name; `services list` shows them |

## 3. Elevation decides what the agent can do

Starting a service, adding a firewall rule, writing `HKLM:` and machine-wide
environment variables all need administrator rights. `/status`, `system info`
(`IsAdmin`) and Settings → **Windows** say whether win-agent has them, and the boot
banner prints it:

```
win-agent 1.3.0 web UI running
  ...
  powershell : C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe 5.1.26100.9444
  elevated   : no - service/firewall/machine-wide changes will be refused
```

Run the agent from an elevated terminal when you want those. The approval prompt still
stands between the model and the change.

## 4. Encodings — UTF-16 files are normal on Windows

Notepad's "Unicode" and Windows PowerShell 5.1's `Out-File` write **UTF-16**; plenty
of tools write a **UTF-8 BOM**. Reading those as UTF-8 gives `h\0e\0l\0l\0o` — the
classic "the file tool is broken" report.

```powershell
PS> /exec "hello" | Out-File C:\Temp\utf16.txt      # 5.1 writes UTF-16LE
PS> /exec "hello" | Set-Content C:\Temp\bom.txt     # writes UTF-8 with a BOM
```

`src/util/text.ts` detects the encoding from the BOM, and for BOM-less files from the
NUL byte pattern:

| Tool | Behaviour |
| --- | --- |
| `files read` | returns clean text; **refuses** binary files with a message instead of dumping NULs into the conversation |
| `files edit`, `files append`, `files write` (when overwriting) | write the file back in **its own** encoding and BOM, so editing a UTF-16 file does not silently convert it to UTF-8 |
| `files grep` | searches UTF-16 files correctly and skips binary ones |
| `data/settings.json` | read even if Notepad saved it as UTF-16 |

## 5. Hung commands are killed with their whole tree

`child.kill()` on Windows kills `powershell.exe` but not what it started, so a stuck
`robocopy` or a long `Test-Connection` kept running after a timeout. A timeout now runs
`taskkill /pid <n> /T /F` (whole tree) and the result says so:

```
Error: the command did not finish within 30000 ms and was killed (with everything it started)
```

`PsResult` carries `timedOut: true` so callers can tell a timeout from a real failure.

## 6. Fixed along the way

- **`scheduled_tasks create` ignored `time`.** The start time was computed from `$t`
  one line *before* `$t` was assigned, so every task ran five minutes from now. The
  script is now built by an exported, tested `buildTaskScript()`, with a tolerant
  `[datetime]::TryParse`, and the reply reports the next run time Task Scheduler
  computed for the task it actually created.
- **`network port_check` printed the literal `${host}:${port}`.** PowerShell does not
  interpolate inside a single-quoted string, and the line *looked* right in the source.
  Rewritten with a `TcpClient` and an explicit timeout; it is fast now.
- **`runPsJson` broke on scripts ending in `}`** — appending `| ConvertTo-Json` produced
  `EmptyPipeElement`. `ipconfig` and `connections` now end with a variable
  (`$gwConfig`, `$gwConns | Sort-Object LocalPort`).
- **`system info`** now also reports the PowerShell version/edition/path, elevation,
  time zone and current time.
- **Small-model mistakes get hints.** Tool-argument JSON with a trailing comma, a
  single-quoted string or a comment is repaired before it is rejected, and an unknown
  tool name gets *"did you mean `services`?"* (Levenshtein distance) instead of a list.

## Running the checks yourself

```powershell
npm run test:windows     # 57 live checks on this machine (needs no model)
npm run test:mode        # 74 model-free checks: modes, JSON repair, encodings, CLIXML
```

`test:windows` creates its scratch files under `%TEMP%` (and deliberately attempts one
write to `%ProgramFiles%` to check the permission hint), reads a real service, starts
no service and cleans up after itself. It is safe to run with the agent already
running on port 8787.
