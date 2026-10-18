# Custom commands / 自定义命令

A custom command is a PowerShell one-liner that becomes an action of the `custom` tool.
The model then calls it like any other tool — it never sees or writes the script.

一条 PowerShell 单行命令 = `custom` 工具的一个 action，模型像调用内置工具一样调用它。

## Add one / 添加

From the web terminal (or the CLI's `/` commands), or Settings → **Custom commands**:

```
PS> /custom add diskfree Get-PSDrive C | Select-Object -ExpandProperty Free
```

The tool appears immediately — the model sees it on the next turn:

```json
{"name":"custom","arguments":{"action":"diskfree"}}
```

Manage them with:

```
PS> /custom list                       # what exists
PS> /custom remove diskfree            # delete one
```

## Ready to paste / 可以直接用

Each line is a single PowerShell statement (the part after the name is the script, so
keep it on **one line**; use `;` to chain).

| Line to paste | What it gives the model |
| --- | --- |
| `/custom add diskfree Get-PSDrive C \| Select-Object -ExpandProperty Free` | free bytes on C: |
| `/custom add myip (Invoke-RestMethod https://api.ipify.org)` | the public IP address |
| `/custom add bigfiles Get-ChildItem D:\ -Recurse -File -ErrorAction SilentlyContinue \| Sort-Object Length -Descending \| Select-Object -First 20 FullName,@{n="MB";e={[math]::Round($_.Length/1MB,1)}} \| Format-Table -AutoSize` | the 20 biggest files on D: |
| `/custom add listening Get-NetTCPConnection -State Listen \| Select-Object LocalAddress,LocalPort,OwningProcess \| Sort-Object LocalPort \| Format-Table -AutoSize` | every listening port |
| `/custom add lastboot (Get-CimInstance Win32_OperatingSystem).LastBootUpTime` | last boot time |
| `/custom add battery Get-CimInstance Win32_Battery \| Select-Object EstimatedChargeRemaining,BatteryStatus` | battery level and state |
| `/custom add tempfiles Get-ChildItem $env:TEMP -Recurse -File -ErrorAction SilentlyContinue \| Measure-Object Length -Sum \| ForEach-Object { "{0:N1} MB in {1} files" -f ($_.Sum/1MB), $_.Count }` | how much junk is in %TEMP% |
| `/custom add gitsummary git -C D:\new log --oneline -10` | the last 10 git commits |
| `/custom add uptime7 (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString("yyyy-MM-dd HH:mm")` | boot time as text |
| `/custom add myname whoami` | the current user |

> `$env:TEMP`, `$_` and `|` all survive: the script is run as a *single* PowerShell
> command through `-EncodedCommand`, so it is never split by the shell or the model.

## Where they are stored / 存在哪

`customTools` in `data/settings.json`, so they survive restarts and are visible in the
Settings tab:

```json
{
  "customTools": [
    { "name": "diskfree", "description": "custom command: diskfree", "script": "Get-PSDrive C | Select-Object -ExpandProperty Free" },
    { "name": "myip", "description": "custom command: myip", "script": "(Invoke-RestMethod https://api.ipify.org)" }
  ]
}
```

The `description` is what the model reads when deciding whether to use it, so a far
better version of the same thing is:

```json
{
  "customTools": [
    { "name": "diskfree", "description": "free space left on drive C, in bytes", "script": "Get-PSDrive C | Select-Object -ExpandProperty Free" },
    { "name": "myip", "description": "the machine's public IP address", "script": "(Invoke-RestMethod https://api.ipify.org)" }
  ]
}
```

Edit the descriptions in Settings (or the file) — the model picks commands by description,
which is exactly what makes them work better than the `powershell` tool.

## Rules / 规则

- **Always approval-gated.** Custom commands run arbitrary PowerShell, so they ask every
  time unless `/auto-approve on` or `/dry-run on`.
- **Name = action.** Lowercase, no spaces: `diskfree`, `myip`. Adding a name again
  replaces that command.
- **One line.** Use `;` instead of newlines. Quotes are handled — write the PowerShell as
  you would type it in a console.
- **Errors come back as text**, so the model can read them and try a different command
  instead of failing.
- **Keep them read-only** where you can (report a number, list something). A command that
  *changes* the machine is a tool the model may decide to call on its own.

## When to use this instead of `powershell`

The `powershell` tool is the escape hatch: it exists for the one-off script that nobody
will need again. A custom command is for the thing you ask twice — it gets a name and a
description the model can reason about, and it shows up in the tool list instead of being
invented from scratch at call time.
