# Tool call examples / 工具调用示例

One worked example per tool. The middle block is **exactly** what the model has to
produce: a function call, or — for endpoints without function calling — a single fenced
JSON block using the same object (`{"tool": ...}` instead of `{"name": ...}`).

每个工具一个例子。中间那段 JSON 就是模型要输出的东西（原生函数调用，或退化成
`{"tool": ..., "arguments": ...}` 代码块）。

## Text protocol fallback / 退化格式

If the endpoint cannot call functions, the model answers with nothing but:

```json
{"tool": "system", "arguments": {"action": "disk"}}
```

The agent runs it and replies with the result as a tool message; the model then answers
in plain text. `/diagnose` tells you which of the two this endpoint can do.

---

## `files` — read, edit, search, zip

> "What is in `D:\new`?" · "D 盘那个项目文件夹里有什么？"

```json
{"name":"files","arguments":{"action":"list","path":"D:\\new","recursive":false,"max":50}}
```

Returns name / size / modified time per entry. Related actions:

```json
{"action":"tree","path":"D:\\new","depth":2}
{"action":"read","path":"D:\\new\\README.md","offset":0}
{"action":"grep","path":"D:\\new\\src","pattern":"dataDir","max":20}
{"action":"search","path":"D:\\new","pattern":"*.mjs","recursive":true}
{"action":"hash","path":"D:\\new\\package.json","algorithm":"sha256"}
```

Editing never rewrites a whole file — it replaces **exact text** and shows a diff, so a
small model cannot destroy a file by paraphrasing it:

```json
{"action":"edit","path":"D:\\new\\data\\settings.json","find":"\"maxSteps\": 12","replace":"\"maxSteps\": 20","all":false}
```

Writing from scratch, and archives:

```json
{"action":"write","path":"D:\\new\\tmp\\notes.txt","content":"hello","overwrite":true}
{"action":"mkdir","path":"D:\\new\\tmp"}
{"action":"copy","source":"D:\\new\\README.md","destination":"D:\\new\\tmp\\README.md","overwrite":true}
{"action":"move","source":"D:\\new\\tmp\\notes.txt","destination":"D:\\new\\tmp\\old.txt"}
{"action":"zip","source":"D:\\new\\tmp","destination":"D:\\new\\tmp.zip","overwrite":true}
{"action":"unzip","source":"D:\\new\\tmp.zip","destination":"D:\\new\\tmp2"}
{"action":"delete","path":"D:\\new\\tmp","recursive":true}
```

`delete` is the one that always asks for approval first.

---

## `system` — info, disk, memory, env, power

> "How much space is left on C:?" · "C 盘还剩多少空间？"

```json
{"name":"system","arguments":{"action":"disk"}}
```

```json
{"action":"info"}
{"action":"memory"}
{"action":"cpu"}
{"action":"uptime"}
{"action":"battery"}
{"action":"whoami"}
{"action":"installed_apps"}
```

Environment variables — `scope` (`User` or `Machine`) is required for `env_get` and
`env_set` because "the variable" is not one thing: the user's copy and the machine's copy
are different values. `Machine` needs admin.

```json
{"action":"env_get","name":"PATH","scope":"User"}
{"action":"env_list","scope":"User"}
{"action":"env_set","name":"WIN_AGENT_DEMO","value":"1","scope":"User"}
```

Power & screen — all four ask for approval: `lock_screen`, `sleep`, `shutdown`
(`restart`, `hibernate` are separate actions).

---

## `processes` — find, list, kill, start

> "Is notepad running?" · "记事本开着吗？"

```json
{"name":"processes","arguments":{"action":"find","name":"notepad"}}
```

```json
{"action":"list","top":10}
{"action":"kill","name":"notepad"}
{"action":"kill","id":1234}
{"action":"start","name":"notepad","args":"D:\\new\\README.md"}
```

`list` without `name` returns the top memory consumers; `top` caps the rows.

---

## `services` — status, start, stop, restart, enable, disable

> "Is the print spooler running? If not, start it." · "打印服务在运行吗？没运行就启动它。"

```json
{"name":"services","arguments":{"action":"status","name":"Spooler"}}
```

then, only if it is stopped:

```json
{"action":"start","name":"Spooler"}
```

```json
{"action":"list","filter":"print"}
{"action":"restart","name":"Spooler"}
{"action":"disable","name":"Spooler"}
```

`enable` / `disable` set the start type (`Automatic` / `Disabled`) and need admin.

---

## `network` — ip, ping, dns, ports, firewall, wifi

> "Can we reach github.com? And is anything listening on 8787?" · "github.com 通吗？8787 端口有人监听吗？"

```json
{"name":"network","arguments":{"action":"ping","host":"github.com"}}
```

```json
{"action":"ipconfig"}
{"action":"dns_lookup","host":"github.com"}
{"action":"port_check","host":"127.0.0.1","port":8787}
{"action":"connections"}
{"action":"wifi_profiles"}
{"action":"firewall_list"}
{"action":"firewall_add","rule":"win-agent demo 8080","port":8080,"protocol":"TCP","direction":"Inbound"}
{"action":"firewall_remove","rule":"win-agent demo 8080"}
```

Firewall changes need admin; `ping` reports the raw reply so the model can quote it.

---

## `web` — search, fetch, download

> "Look up the current Node LTS version." · "查一下现在 Node 的 LTS 是哪个版本。"

```json
{"name":"web","arguments":{"action":"search","query":"node.js current LTS version","count":5}}
```

```json
{"action":"fetch","url":"https://nodejs.org/en/about/previous-releases","format":"text","maxChars":4000,"offset":0}
{"action":"fetch","url":"https://api.github.com/repos/zhoubingxuan/win-agent","format":"json"}
{"action":"download","url":"https://example.com/file.zip","path":"D:\\new\\tmp\\file.zip"}
```

`search` opens the search page configured by `webSearchUrl` (`{q}` = the query) and
returns the ranked links — Bing's HTML does not need a key. Long pages are returned in
slices: ask again with a bigger `offset` instead of fetching everything at once.

---

## `scheduled_tasks` — Schtasks without the syntax

> "Every day at 23:00 run a PowerShell that writes the date to D:\new\tmp\stamp.txt." · "每天 23:00 把日期写进一个文件。"

```json
{"name":"scheduled_tasks","arguments":{"action":"create","name":"win-agent-demo","program":"powershell.exe","args":"-NoProfile -Command \"Get-Date | Out-File D:\\new\\tmp\\stamp.txt -Append\"","schedule":"DAILY","time":"23:00"}}
```

```json
{"action":"list"}
{"action":"info","name":"win-agent-demo"}
{"action":"run","name":"win-agent-demo"}
{"action":"delete","name":"win-agent-demo"}
```

`schedule` is one of `ONCE`, `DAILY`, `HOURLY`, `ONLOGON`, `ONSTART`; `time` is `HH:mm`
(ignored by `ONLOGON` / `ONSTART`). Creating and deleting ask for approval.

---

## `registry` — get, list, set, delete

> "Which programs start with Windows for this user?" · "开机自启动里有什么？"

Paths are PowerShell provider paths — `HKCU:\...` or `HKLM:\...` (with the colon), which
is also why they contain backslashes even on the command line.

```json
{"name":"registry","arguments":{"action":"get","path":"HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"}}
```

`get` reads the **values** of a key — that is where the autostart entries live. `list`
reads the **subkeys**, which is a different question:

```json
{"action":"list","path":"HKCU:\\Software\\Microsoft"}
```

```json
{"action":"get","path":"HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run","name":"OneDrive"}
{"action":"set","path":"HKCU:\\Software\\win-agent","name":"Demo","value":"1","type":"DWord"}
{"action":"delete","path":"HKCU:\\Software\\win-agent","name":"Demo"}
```

`path` is required for every action, which is why it is the only tool with two required
arguments. `type` is `String`, `ExpandString`, `DWord`, `QWord` or `MultiString`; writes
ask for approval.

---

## `ui` — clipboard, screenshot, open, notify

> "What is on my clipboard? Put the answer there too." · "剪贴板里是什么？"

```json
{"name":"ui","arguments":{"action":"clipboard_get"}}
```

```json
{"action":"clipboard_set","text":"Copied by win-agent"}
{"action":"screenshot","path":"D:\\new\\tmp\\screen.png"}
{"action":"open","path":"D:\\new"}
{"action":"notify","title":"win-agent","text":"Task finished"}
```

`screenshot` needs a visible desktop session; `open` uses Explorer, so it also works for
folders and documents.

---

## `powershell` — the escape hatch

> "Run this exact script." · "就按我写的脚本跑。"

```json
{"name":"powershell","arguments":{"script":"Get-Service Spooler | Select-Object Status,Name,DisplayName","readOnly":true}}
```

Only for things no other tool covers. Set `"readOnly": true` when the script cannot change
anything — those run without a prompt. Everything else is always confirmed, and the
approval card shows the script before it runs.

Prefer a tool: `{"action":"status","name":"Spooler"}` gives the same answer through the
`services` tool, and cannot be broken by quoting.

---

## `custom` — your own commands

> "How much free space is on C:?" · "C 盘可用空间是多少？" (after `/custom add`)

```json
{"name":"custom","arguments":{"action":"diskfree"}}
```

The tool only exists once you have added at least one command — see
[custom-commands.md](custom-commands.md). Its schema lists each of your commands as an
`action`, so the model sees them exactly like built-in ones.

---

## A whole turn, start to finish / 完整的一轮

User: *"Check the print spooler; if it is stopped, start it and write the result to
D:\new\tmp\spooler.txt."*

```
1. {"name":"services","arguments":{"action":"status","name":"Spooler"}}
   -> "Stopped"

2. {"name":"services","arguments":{"action":"start","name":"Spooler"}}
   -> approval card -> approved -> "Service Spooler started"

3. {"name":"files","arguments":{"action":"write","path":"D:\\new\\tmp\\spooler.txt","content":"Spooler: Running (started by win-agent)","overwrite":true}}
   -> "Wrote 34 bytes"

4. Plain text: "The print spooler was stopped, so I started it and saved the result to
   D:\new\tmp\spooler.txt."
```

Four steps, no Windows syntax anywhere — that is the whole point.
