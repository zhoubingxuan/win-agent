# Prompts / 任务示例

Paste these into the chat box (or `npm run dev -- "<task>"`). They are ordered by how
much work they make the agent do — the first group needs one tool call, the last group
needs a plan.

直接复制到聊天框（或 `npm run dev -- "任务"`）。按难度排列：第一组只要一次工具调用，
最后一组需要先规划。

> Small models do best when the task names the thing to look at. "Check X" beats "make my
> PC faster". Add *"just tell me the plan first"* (or turn on `/dry-run on`) when you want
> to see the steps before anything is touched.

## One call / 一次调用

| English | 中文 | Tool it should pick |
| --- | --- | --- |
| How much free space is left on C:? | C 盘还剩多少空间？ | `system` → `disk` |
| How much RAM is in use right now? | 现在内存用了多少？ | `system` → `memory` |
| Which Windows version is this? | 这是什么版本的 Windows？ | `system` → `info` |
| Show the top 10 processes by memory. | 列出内存占用前 10 的进程。 | `processes` → `list` |
| Is the print spooler running? | 打印后台处理程序在运行吗？ | `services` → `status` |
| What is my IP configuration? | 我的 IP 配置是什么？ | `network` → `ipconfig` |
| Is anything listening on port 8787? | 8787 端口有人监听吗？ | `network` → `port_check` |
| What is in D:\new\tmp? | D:\new\tmp 里有什么？ | `files` → `list` |
| What is on my clipboard? | 剪贴板里是什么？ | `ui` → `clipboard_get` |
| Which programs start with Windows? | 开机自启动有哪些程序？ | `registry` → `get` |
| What subkeys are under HKCU:\Software? | HKCU:\Software 下面有哪些子键？ | `registry` → `list` |
| With the fs MCP tool, list D:\new and tell me which folders are there. | 用 fs 这个 MCP 工具列出 D:\new，告诉我有哪些文件夹。 | `mcp__fs__list_directory` |

> The last one needs an MCP server called `fs` (see [mcp.md](mcp.md)); the agent can only
> call MCP tools that a server you added advertises, so ask for it by the name you gave it.

## Two or three calls / 两三次调用

| English | 中文 |
| --- | --- |
| List the files in D:\new\tmp and delete the `.log` ones — tell me first. | 列出 D:\new\tmp 里的文件，把 .log 的删掉，先告诉我有哪些。 |
| Create D:\new\tmp\report and copy README.md and CHANGELOG.md into it. | 建个 D:\new\tmp\report 文件夹，把 README.md 和 CHANGELOG.md 复制进去。 |
| Check whether github.com is reachable; if it is not, ping 8.8.8.8 as well. | 看看 github.com 通不通，不通的话再 ping 一下 8.8.8.8。 |
| Read D:\new\package.json and tell me the version and which dependencies it has. | 读一下 D:\new\package.json，告诉我版本号和依赖。 |
| Search D:\new\src for the text `dataDir` and show me the file names. | 在 D:\new\src 里搜 `dataDir`，把文件名给我。 |
| Take a screenshot and save it as D:\new\tmp\shot.png. | 截个图，存成 D:\new\tmp\shot.png。 |
| Set the environment variable WIN_AGENT_DEMO to 1 for my user. | 给当前用户加个环境变量 WIN_AGENT_DEMO=1。 |

## Multi-step, with approval / 多步、需要审批

| English | 中文 |
| --- | --- |
| Check the Spooler service; if it is stopped, start it, then write the result to D:\new\tmp\spooler.txt. | 检查 Spooler 服务，如果停了就启动，然后把结果写到 D:\new\tmp\spooler.txt。 |
| Look in D:\new\tmp, zip everything older than a day into D:\new\tmp\old.zip, then delete the originals. | 看看 D:\new\tmp，把一天前的东西打包成 old.zip，然后删掉原件。 |
| Create a scheduled task named win-agent-demo that writes the date to D:\new\tmp\stamp.txt every day at 23:00. | 建一个计划任务 win-agent-demo，每天 23:00 把日期写进 D:\new\tmp\stamp.txt。 |
| Find the 3 biggest files under D:\new and tell me their sizes and full paths. | 找出 D:\new 下最大的 3 个文件，告诉我大小和完整路径。 |
| Show me what changed in the git repository in D:\new during the last week. | 给我看看 D:\new 这个仓库最近一周改了什么。 |

## Prompts that show off the design / 体现设计意图的任务

These are the ones a small model gets *right* here and wrong with a raw shell:

- **"Is the firewall blocking 8080?"** — needs the right `netsh` incantation; the model
  only picks `{"action":"firewall_list"}`.
- **"What does STARTTLS mean in our mail logs?"** — a question, not a command: the agent
  answers directly without calling a tool.
- **"Open D:\new in Explorer, and while you are at it tell me how big it is."** — two
  tools (`ui` → `open`, then `files` → `tree`).
- **"把我的 IP 和 DNS 服务器用中文列出来"** — with `language = zh`, tool output stays
  raw but the answer comes back in Chinese.

## Tips / 技巧

| Want | Do |
| --- | --- |
| See the plan, run nothing | say *"just plan it"*, or `/dry-run on` |
| Skip approvals (careful) | `/auto-approve on`, or Settings → Advanced |
| A cheap model that still acts correctly | `glm-4.7-flash` (LM Studio) or `qwen2.5:7b` (Ollama); both are tested with these prompts |
| Fewer tools, fewer mistakes | `/disable powershell` — the model then has to use real tools |
| A repeatable task | make it a custom command: [custom-commands.md](custom-commands.md) |
| Watch it work | the Terminal tab shows every PowerShell line the agent runs |
