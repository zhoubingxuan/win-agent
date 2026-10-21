/* ------------------------------------------------------------------ i18n */

const I18N = {
  en: {
    "brand.sub": "Windows automation for local LLMs",
    "sidebar.runtime": "Runtime",
    "sidebar.model": "model",
    "sidebar.endpoint": "endpoint",
    "sidebar.cwd": "cwd",
    "sidebar.status": "status",
    "runtime.noModels": "(no models yet — press Refresh models)",
    "notice.profileSwitched": "endpoint: {0}",
    "notice.modelsLoaded": "loaded {0} models from {1}",
    "notice.profileIdInvalid": "endpoint id must be letters, digits, \"-\" or \"_\"",
    "settings.removedProfile": "endpoint {0} deleted",
    "sidebar.behaviour": "Behaviour",
    "sidebar.usage": "Usage",
    "usage.in": "input",
    "usage.out": "output",
    "usage.total": "total",
    "usage.speed": "speed",
    "usage.cache": "cache",
    "usage.context": "context",
    "usage.allTime": "all time",
    "usage.messages": "messages",
    "usage.reasoning": "reasoning",
    "usage.estimated": "estimated",
    "usage.unreported": "not reported by this endpoint",
    "sidebar.openSettings": "Open settings",
    "sidebar.tools": "Tools",
    "common.dryRun": "Dry run",
    "common.autoApprove": "Auto-approve",
    "common.sandbox": "Sandbox",
    "tab.chat": "Chat",
    "tab.terminal": "Terminal",
    "tab.settings": "Settings",
    "title.ready": "Ready",
    "title.working": "Working…",
    "status.online": "online",
    "status.offline": "offline",
    "status.busy": "busy",
    "chat.emptyTitle": "Ask the agent to do something on this PC",
    "chat.emptyText": "It exposes Windows tasks as simple tools, so a small local model can run them.",
    "chat.ex1": "How much free space is left on C:?",
    "chat.ex2": "Is the print spooler running?",
    "chat.ex3": "List the top 10 processes by memory",
    "chat.ex4": "Which listening ports are open?",
    "chat.placeholder": "Describe a task…  (Enter to send, Shift+Enter for newline)",
    "chat.send": "Send",
    "chat.stop": "Stop",
    "chat.thinking": "thinking… ({0} chars so far)",
    "chat.thought": "thinking ({0} chars) — click to read",
    "chat.detail": "detail",
    "terminal.placeholder": "shell command, or /help for internal commands",
    "terminal.run": "Run",
    "terminal.hint":
      "This is the agent's own terminal. Plain text runs in PowerShell; a line starting with <code>/</code> is an internal command that can reconfigure the agent (try <code>/help</code>).",
    "terminal.welcome": "win-agent terminal — type a shell command, or /help for internal commands",
    "terminal.commands": "Internal commands",
    "settings.title": "Settings",
    "settings.model": "Model",
    "settings.baseUrl": "API base URL",
    "settings.apiKey": "API key",
    "settings.apiKeyStored": "(stored — type to replace)",
    "settings.apiKeyNone": "(none)",
    "settings.maxSteps": "Max steps",
    "settings.maxStepsHint":
      "Max steps: 0 means no step limit - a long task may take as many rounds as it needs. What still stops a turn is repeated work: the same call returning the same answer twice is refused on the third try, and the Stop button is always there.",
    "settings.temperature": "Temperature",
    "settings.language": "Language",
    "settings.workdir": "Working directory",
    "settings.powershell": "PowerShell binary",
    "settings.webPort": "Web port",
    "settings.systemPrompt": "System prompt",
    "settings.openOnStart": "Open browser on start",
    "settings.stream": "Stream replies",
    "settings.webSearchUrl": "Web search page",
    "settings.mode": "Agent mode — how closely the model is supervised",
    "settings.modeHint":
      "Guided mode is built for small local models: the prompt gets a numbered operating procedure, every tool lists its required arguments, the model may call only one tool per step (so it cannot guess ahead), and the raw powershell tool is not offered at all - the model has to use the structured actions. Normal mode is the plain prompt plus the shell, enough for a large model.",
    "settings.modeGuided": "guided",
    "settings.modeNormal": "normal",
    "settings.modeStateGuided": "now: guided — one tool per step, explicit procedure, no raw shell",
    "settings.modeStateNormal": "now: normal — plain prompt, parallel tool calls allowed",
    "settings.verbosity": "Output detail — how much of the process the chat shows",
    "settings.verbosityHint":
      "A view setting, nothing else: the agent does exactly the same work, and the whole record is written to the data folder either way. Answer only shows your message and the model's reply; + thinking adds the model's reasoning in a block you can fold; + tools & usage is the machine room — every tool call with its arguments and result, step markers and token counts.",
    "settings.verbosityAnswer": "answer only",
    "settings.verbosityThinking": "+ thinking",
    "settings.verbosityFull": "+ tools & usage",
    "settings.verbosityStateAnswer":
      "now: answer only — your message and the model's answer; tool calls, reasoning and token counts stay out of the log",
    "settings.verbosityStateThinking":
      "now: answer + thinking — the model's reasoning appears while it works, and folds away when the answer starts",
    "settings.verbosityStateFull":
      "now: everything — reasoning, every tool call with its arguments and result, step markers and token usage",
    "settings.windows": "Windows",
    "settings.windowsHint":
      "What the agent is actually driving. Elevation decides whether services, the firewall and machine-wide settings can be changed at all.",
    "settings.winShell": "PowerShell",
    "settings.winAdmin": "administrator",
    "settings.psEnglishErrors": "Always report PowerShell errors in English (easier for the model)",
    "settings.adminYes": "yes",
    "settings.adminNo": "no — service, firewall and machine-wide changes will be refused",
    "settings.adminUnknown": "unknown",
    "settings.enabledTools": "Enabled tools",
    "settings.enabledToolsHint": "Turn a tool off with its switch to hide it from the model. All on = all enabled.",
    "settings.skills": "Skills",
    "settings.skillsHint":
      "A skill is a procedure the model loads only when a task matches it - steps, examples, things that went wrong last time. The prompt carries one line per skill; the body is fetched when it is needed, so ten procedures do not fill a small context window. Each skill is a folder under <code>data/skills/</code>, so a file you write there by hand shows up in this list too.",
    "settings.skillsDir": "folder",
    "settings.skillName": "name (clean-temp)",
    "settings.skillDesc": "one line: what it does",
    "settings.skillWhen": "when to use it: the user asks to …",
    "settings.skillBody":
      "The steps, written for a careful colleague: what to check first, which tool, what not to touch.",
    "settings.skillSave": "Save skill",
    "settings.skillNew": "New",
    "settings.skillEdit": "Edit",
    "settings.skillDelete": "Delete",
    "settings.skillEmpty":
      "(no skills yet - write one below, or drop a folder with a SKILL.md into the folder above)",
    "settings.skillSaved": "saved {0}",
    "settings.skillDeleted": "deleted {0}",
    "settings.skillLoaded": "editing {0}",
    "settings.skillNeedName": "a skill needs a name and a body",
    "settings.skillDeleteAsk": "Delete the skill \"{0}\" and its folder?",
    "settings.customCommands": "Custom commands",
    "settings.customHint":
      "Add your own commands. Each becomes an action of the <code>custom</code> tool and runs as PowerShell; the model's <code>arg</code> value is available as <code>$arg</code>.",
    "settings.memory": "Memory",
    "settings.remember": "Remember the conversation across restarts",
    "settings.memoryInfo": "memory {0} — {1} messages, {2} bytes · {3}",
    "settings.data": "Conversation records",
    "settings.dataHint":
      "Every conversation is written to the data folder with its token totals. Starting a new conversation files the open one away; click an archived one to reopen it.",
    "settings.dataDir": "folder",
    "settings.dataConv": "open conversation",
    "settings.dataUsage": "its usage",
    "settings.dataArchived": "archived",
    "settings.noArchived": "(no archived conversations yet)",
    "settings.openData": "Open data folder",
    "settings.newConversation": "New conversation",
    "settings.dataOpened": "opened {0}",
    "settings.reopened": "reopened {0}",
    "settings.reopenHint": "click to reopen this conversation",
    "settings.endpoints": "Endpoints — local server or cloud API",
    "settings.endpointsHint":
      "One click switches the whole agent between a local model server and a cloud API. Every endpoint keeps its own URL, key and model.",
    "settings.activeProfile": "Active endpoint",
    "settings.modelPick": "Models offered by this endpoint",
    "settings.newProfileId": "New endpoint id",
    "settings.newProfileKind": "New endpoint kind",
    "settings.refreshModels": "Refresh models",
    "settings.newProfile": "Add endpoint",
    "settings.removeProfile": "Delete endpoint",
    "settings.add": "Add",
    "settings.save": "Save settings",
    "settings.reload": "Reload from disk",
    "settings.clearChat": "Clear conversation",
    "settings.remove": "remove",
    "settings.namePlaceholder": "name (a-z, _)",
    "settings.descPlaceholder": "description",
    "settings.scriptPlaceholder": "PowerShell, e.g. Get-Date -Format o",
    "settings.noCustom": "(no custom commands yet)",
    "settings.audit": "Change log and undo",
    "settings.auditHint":
      "Every change the tools make is appended to the audit log, and each one that can be restored faithfully can be rolled back from this list - today, tomorrow, or next week. Files are copied aside before they are touched; the copies are kept for the number of days below, so a restart loses nothing. A change that could not be saved (a folder bigger than 64 MB) is still recorded - just without a rollback.",
    "settings.auditOn": "Record changes and allow undo",
    "settings.auditRetention": "Keep undo copies for (days)",
    "settings.auditFile": "log file",
    "settings.auditUndoable": "can be undone",
    "settings.auditUndo": "Undo the last change",
    "settings.auditRollback": "Roll back",
    "settings.auditEmpty": "(nothing has been changed yet)",
    "settings.auditOff": "switched off - nothing is being recorded",
    "settings.auditDone": "undid {0} change(s)",
    "settings.auditNothing": "nothing to undo",
    "settings.auditLine": "{0}  {1} {2}: {3}",
    "settings.sandboxHint":
      "Sandbox (on by default): every file path has to point inside the working directory, and a PowerShell script is read before it runs - a path that leaves the folder, a $env: that resolves outside it, or a disk-destroying command is refused instead of approved. Turn it off to work outside the folder.",
    "settings.toolsWithheld": "not offered right now: {0}",
    "settings.loopGuard": "Stop repeated calls",
    "settings.loopGuardHint":
      "On by default. When the model asks for exactly the same call and gets exactly the same answer twice, the third one is answered with a note instead of being run again - the commonest way a small model burns a turn. A poll whose answer keeps changing is never stopped, and switching this off returns to plain step-by-step execution.",
    "settings.savedFile": "saved to {0}",
    "settings.saved": "saved: {0}",
    "settings.noChanges": "no changes",
    "settings.reloaded": "reloaded from disk",
    "settings.cleared": "conversation archived — started a new one",
    "settings.moving": "moving to {0} — open it in a new tab",
    "approval.question": "The agent wants to: ",
    "approval.approve": "Approve",
    "approval.deny": "Deny",
    "approval.approved": "approved",
    "approval.denied": "denied",
    "approval.auto": "auto-approved",
    "tool.running": "running…",
    "notice.moving": "moving to {0} …",
    "notice.customInvalid": "custom command needs a valid name and a script",
    "error.prefix": "Error: ",
    "step.label": "step {0}/{1}",
    "step.labelNoLimit": "step {0}",
    "notice.stopping": "stopping…",
    "notice.stopped": "task stopped",
    "settings.context": "Context window and robustness",
    "settings.contextHint":
      "Small local models have a small window. The agent measures every request and quietly drops the oldest exchanges (and squeezes huge tool results) when it would not fit — the stored conversation is never shortened. Leave 0 to use the length the endpoint reports.",
    "settings.contextNow": "right now",
    "settings.contextLimit": "Context limit (tokens, 0 = auto)",
    "settings.requestTimeoutMs": "Request timeout (ms)",
    "settings.maxRetries": "Retries (429 / 5xx / network)",
    "settings.diagnose": "Test this endpoint",
    "settings.diagnosing": "testing…",
    "settings.diagnoseHint": "checks chat, token usage, function calling, streaming and the context length",
    "context.none": "no limit known",
    "context.line": "{0} / {1} tokens ({2}%) · {3} messages",
    "context.used": "{0} tokens used · {1} messages",
    "context.source.settings": "from settings",
    "context.source.model": "from the endpoint",
    "context.source.unknown": "unknown — set a limit if replies get cut off",
    "context.trimmed": "trimmed: {0} old exchange(s) dropped, {1} tool result(s) shortened",
    "chat.workdir": "workdir",
    "chat.browse": "Browse…",
    "chat.endpoint": "endpoint",
    "chat.model": "model",
    "chat.refresh": "Refresh models",
    "dir.title": "Choose the agent's working directory",
    "dir.close": "Close",
    "dir.up": "Up",
    "dir.drives": "Drives",
    "dir.go": "Open",
    "dir.use": "Use this folder",
    "dir.empty": "(no sub-folders here — use this folder, or go up)",
    "dir.failed": "cannot read this folder",
    "settings.kindLocal": "local",
    "settings.kindApi": "API",
    "settings.localModels": "Local model sync",
    "settings.localModelsHint":
      "Ask every local server — LM Studio (port 1234) and Ollama (port 11434) — which models it can load, and put them in one list. Picking a model that lives on another server switches the endpoint for you. Nothing leaves this machine.",
    "settings.syncLocalModels": "Sync the models of every local server",
    "fleet.empty": "(no local server answered — start LM Studio or Ollama and press Refresh models)",
    "fleet.ok": "{0} model(s)",
    "fleet.none": "no models",
    "fleet.error": "no answer",
    "notice.syncDone": "synced {0} model(s) from {1} local server(s)",
    "settings.mcp": "MCP — Model Context Protocol",
    "settings.mcpHint":
      "MCP lets the agent use tools that live in other programs: a filesystem server, git, a database, your own service. Add one with its start command (<code>stdio</code>, e.g. <code>npx -y @modelcontextprotocol/server-filesystem D:\\</code>) or with a URL (<code>http</code>). Their tools show up in the model's tool list as <code>mcp__&lt;server&gt;__&lt;tool&gt;</code> and ask for approval before they run.",
    "settings.mcpEnabled": "Master switch: enable MCP",
    "settings.mcpId": "id (a-z, 0-9, _)",
    "settings.mcpCommand": "npx -y @modelcontextprotocol/server-filesystem D:\\",
    "settings.mcpStdio": "stdio",
    "settings.mcpHttp": "HTTP",
    "settings.mcpAuto": "auto-approve",
    "settings.mcpAdd": "Add server",
    "settings.mcpRefresh": "Reconnect & refresh tools",
    "settings.mcpNone": "(no MCP servers yet — add one below)",
    "settings.mcpState": "{0} server(s) switched on · {1} tool(s) offered · refreshed {2}",
    "settings.mcpOffState": "MCP is off: no server is started and no MCP tool is offered.",
    "settings.mcpNever": "never",
    "mcp.connected": "connected",
    "mcp.disconnected": "not connected",
    "mcp.on": "connected, {0} tool(s)",
    "mcp.disabled": "off",
    "mcp.tools": "{0} tool(s): {1}",
    "mcp.remove": "Remove",
    "notice.mcpRefreshed": "MCP: {0} tool(s) from {1} server(s)",
    "notice.mcpAdded": "MCP server {0} added",
    "notice.mcpRemoved": "MCP server {0} removed",
    "chat.current": "current",
    "notice.workdirChanged": "workdir: {0}",
  },
  zh: {
    "brand.sub": "让本地小模型操作 Windows",
    "sidebar.runtime": "运行状态",
    "sidebar.model": "模型",
    "sidebar.endpoint": "接口地址",
    "sidebar.cwd": "当前目录",
    "sidebar.status": "状态",
    "runtime.noModels": "（还没有模型，点「刷新模型」）",
    "notice.profileSwitched": "接口：{0}",
    "notice.modelsLoaded": "已从 {0} 读取 {1} 个模型",
    "notice.profileIdInvalid": "接口 id 只能是字母、数字、\"-\" 或 \"_\"",
    "settings.removedProfile": "已删除接口 {0}",
    "sidebar.behaviour": "行为",
    "sidebar.usage": "用量统计",
    "usage.in": "输入",
    "usage.out": "输出",
    "usage.total": "合计",
    "usage.speed": "速度",
    "usage.cache": "缓存",
    "usage.context": "上下文",
    "usage.allTime": "历史累计",
    "usage.messages": "条消息",
    "usage.reasoning": "思考",
    "usage.estimated": "估算",
    "usage.unreported": "该接口未提供",
    "sidebar.openSettings": "打开设置",
    "sidebar.tools": "工具",
    "common.dryRun": "试运行",
    "common.autoApprove": "自动批准",
    "common.sandbox": "沙箱",
    "tab.chat": "对话",
    "tab.terminal": "终端",
    "tab.settings": "设置",
    "title.ready": "就绪",
    "title.working": "工作中…",
    "status.online": "在线",
    "status.offline": "离线",
    "status.busy": "忙碌",
    "chat.emptyTitle": "让 agent 在这台电脑上做点什么",
    "chat.emptyText": "它把 Windows 的各种操作封装成简单工具，本地小模型也能驱动。",
    "chat.ex1": "C 盘还剩多少空间？",
    "chat.ex2": "打印后台处理程序（Spooler）在运行吗？",
    "chat.ex3": "按内存列出占用最高的 10 个进程",
    "chat.ex4": "现在有哪些监听端口？",
    "chat.placeholder": "描述一个任务…（Enter 发送，Shift+Enter 换行）",
    "chat.send": "发送",
    "chat.stop": "停止",
    "chat.thinking": "思考中…（已 {0} 字符）",
    "chat.thought": "思考（{0} 字符）—— 点击展开",
    "chat.detail": "详细",
    "terminal.placeholder": "输入 shell 命令，或输入 /help 查看内部指令",
    "terminal.run": "运行",
    "terminal.hint":
      "这是 agent 自带的终端。普通文本会用 PowerShell 执行；以 <code>/</code> 开头的是内部指令，可以直接修改 agent 的配置（试试 <code>/help</code>）。",
    "terminal.welcome": "win-agent 终端 —— 输入 shell 命令，或输入 /help 查看内部指令",
    "terminal.commands": "内部指令",
    "settings.title": "设置",
    "settings.model": "模型",
    "settings.baseUrl": "接口地址",
    "settings.apiKey": "API 密钥",
    "settings.apiKeyStored": "（已保存，输入以替换）",
    "settings.apiKeyNone": "（未设置）",
    "settings.maxSteps": "最大步数",
    "settings.maxStepsHint":
      "最大步数填 0 = 不设上限：长任务可以走多少步就走多少步。真正会拦住它的是重复工作——同一个调用连续两次返回相同结果，第三次会被拒绝；另外“停止”按钮一直都在。",
    "settings.temperature": "温度",
    "settings.language": "语言",
    "settings.workdir": "工作目录",
    "settings.powershell": "PowerShell 程序",
    "settings.webPort": "网页端口",
    "settings.systemPrompt": "系统提示词",
    "settings.openOnStart": "启动时打开浏览器",
    "settings.stream": "流式输出回复",
    "settings.webSearchUrl": "网页搜索地址",
    "settings.mode": "智能体模式 —— 对模型的监督程度",
    "settings.modeHint":
      "高监督模式是给本地小模型用的：提示词里会附加一份编号操作规范，每个工具都会列出必填参数，模型每一步只能调用一个工具（防止它瞎猜着一次做一堆），而且完全不提供原始 powershell 工具 —— 模型只能用结构化的动作。普通模式是原始提示词加 shell，大模型够用。",
    "settings.modeGuided": "高监督",
    "settings.modeNormal": "普通",
    "settings.modeStateGuided": "当前：高监督 —— 每步只调用一个工具，附操作规范，不提供原始 shell",
    "settings.modeStateNormal": "当前：普通 —— 原始提示词，允许一次调用多个工具",
    "settings.verbosity": "输出详细程度 —— 对话区显示多少过程",
    "settings.verbosityHint":
      "这只是显示设置，agent 做的事情完全一样，完整记录也照样写进数据文件夹。「只显示回答」只有你的消息和模型的回答；「+ 思考过程」会把模型的思考放进一个可折叠的区块；「+ 工具与用量」是机房全开：每次工具调用及其参数和结果、步骤标记、token 用量。",
    "settings.verbosityAnswer": "只显示回答",
    "settings.verbosityThinking": "+ 思考过程",
    "settings.verbosityFull": "+ 工具与用量",
    "settings.verbosityStateAnswer": "当前：只显示回答 —— 只有你的消息和模型的回答；工具调用、思考过程和 token 用量都不进对话区",
    "settings.verbosityStateThinking": "当前：回答 + 思考过程 —— 模型工作时显示它的思考，开始回答时自动折叠",
    "settings.verbosityStateFull": "当前：全部 —— 思考过程、每次工具调用及其参数与结果、步骤标记、token 用量",
    "settings.windows": "Windows",
    "settings.windowsHint": "这里是智能体实际驱动的环境。是否有管理员权限，决定了能不能改服务、防火墙和系统级设置。",
    "settings.winShell": "PowerShell",
    "settings.winAdmin": "管理员",
    "settings.psEnglishErrors": "PowerShell 报错一律用英文（模型更容易看懂）",
    "settings.adminYes": "是",
    "settings.adminNo": "否 —— 服务、防火墙、系统级修改都会被拒绝",
    "settings.adminUnknown": "未知",
    "settings.enabledTools": "启用的工具",
    "settings.enabledToolsHint": "关掉开关即可对模型隐藏该工具。全部打开 = 全部启用。",
    "settings.skills": "技能包",
    "settings.skillsHint":
      "技能包是模型在任务匹配时才加载的做法说明——步骤、例子、上次踩过的坑。提示词里每个技能只占一行，正文按需读取，所以十个技能也不会塞满小模型的上下文。每个技能是 <code>data/skills/</code> 下的一个文件夹，你手动写进去的文件这里同样能看到。",
    "settings.skillsDir": "文件夹",
    "settings.skillName": "名字（clean-temp）",
    "settings.skillDesc": "一句话：它做什么",
    "settings.skillWhen": "什么时候用：当用户要求……",
    "settings.skillBody": "步骤，写给一位细心的同事看：先检查什么、用哪个工具、哪些东西不要碰。",
    "settings.skillSave": "保存技能",
    "settings.skillNew": "新建",
    "settings.skillEdit": "编辑",
    "settings.skillDelete": "删除",
    "settings.skillEmpty": "（还没有技能包——在下面写一个，或者把带 SKILL.md 的文件夹放进上面的目录）",
    "settings.skillSaved": "已保存 {0}",
    "settings.skillDeleted": "已删除 {0}",
    "settings.skillLoaded": "正在编辑 {0}",
    "settings.skillNeedName": "技能需要名字和正文",
    "settings.skillDeleteAsk": "删除技能「{0}」以及它的文件夹？",
    "settings.customCommands": "自定义命令",
    "settings.customHint":
      "添加你自己的命令。每条会成为 <code>custom</code> 工具的一个 action，以 PowerShell 执行；模型传入的 <code>arg</code> 在脚本里是 <code>$arg</code>。",
    "settings.memory": "记忆化",
    "settings.remember": "跨重启记住对话内容",
    "settings.memoryInfo": "记忆化 {0} —— {1} 条消息，{2} 字节 · {3}",
    "settings.data": "对话记录",
    "settings.dataHint": "每个对话连同 token 用量都会写入数据文件夹；新建对话会把当前这个归档，点击已归档的可重新打开。",
    "settings.dataDir": "文件夹",
    "settings.dataConv": "当前对话",
    "settings.dataUsage": "它的用量",
    "settings.dataArchived": "已归档",
    "settings.noArchived": "（还没有归档的对话）",
    "settings.openData": "打开数据文件夹",
    "settings.newConversation": "新建对话",
    "settings.dataOpened": "已打开 {0}",
    "settings.reopened": "已重新打开 {0}",
    "settings.reopenHint": "点击可重新打开这个对话",
    "settings.endpoints": "接口 —— 本地服务 / 云端 API",
    "settings.endpointsHint":
      "一键在本地模型服务和云端 API 之间切换；每个接口各自保存地址、密钥和模型。",
    "settings.activeProfile": "当前接口",
    "settings.modelPick": "该接口提供的模型",
    "settings.newProfileId": "新接口 id",
    "settings.newProfileKind": "新接口类型",
    "settings.refreshModels": "刷新模型",
    "settings.newProfile": "新增接口",
    "settings.removeProfile": "删除接口",
    "settings.add": "添加",
    "settings.save": "保存设置",
    "settings.reload": "从磁盘重新加载",
    "settings.clearChat": "清空对话",
    "settings.remove": "删除",
    "settings.namePlaceholder": "名称（a-z、_）",
    "settings.descPlaceholder": "描述",
    "settings.scriptPlaceholder": "PowerShell，例如 Get-Date -Format o",
    "settings.noCustom": "（还没有自定义命令）",
    "settings.audit": "改动记录与撤销",
    "settings.auditHint":
      "工具做的每一次改动都会追加到改动记录（audit）里；能够忠实还原的改动，可以在这个列表里逐条回档——今天、明天、下周都行。文件在修改前会先备份一份，备份按下方的天数保留，服务重启也不会丢。无法备份的改动（例如超过 64 MB 的文件夹）仍然会记录，只是不能回档。",
    "settings.auditOn": "记录改动并允许撤销",
    "settings.auditRetention": "撤销备份保留（天）",
    "settings.auditFile": "记录文件",
    "settings.auditUndoable": "可撤销",
    "settings.auditUndo": "撤销最近一次改动",
    "settings.auditRollback": "回档",
    "settings.auditEmpty": "（还没有任何改动）",
    "settings.auditOff": "已关闭 —— 不会记录任何改动",
    "settings.auditDone": "已撤销 {0} 次改动",
    "settings.auditNothing": "没有可撤销的改动",
    "settings.auditLine": "{0}  {1} {2}：{3}",
    "settings.sandboxHint":
      "沙箱（默认开启）：文件路径必须落在工作目录内部；PowerShell 脚本在执行前会先被读一遍——路径离开目录、$env: 解析到外面、或涉及毁盘的命令，都会被拒绝而不是送进审批。需要在目录之外操作时把它关掉。",
    "settings.toolsWithheld": "当前不提供：{0}",
    "settings.loopGuard": "拦截原地打转的调用",
    "settings.loopGuardHint":
      "默认开启。同一个调用连续两次返回完全相同的结果时，第三次不再执行，而是回一条说明——这是小模型最常白烧步数的方式。结果一直在变化的轮询不会被拦；关掉它就回到普通的逐步执行。",
    "settings.savedFile": "已保存到 {0}",
    "settings.saved": "已保存：{0}",
    "settings.noChanges": "没有变化",
    "settings.reloaded": "已从磁盘重新加载",
    "settings.cleared": "对话已归档，并开始了新对话",
    "settings.moving": "正在切换到 {0} —— 请在新标签页打开",
    "approval.question": "agent 想要执行：",
    "approval.approve": "批准",
    "approval.deny": "拒绝",
    "approval.approved": "已批准",
    "approval.denied": "已拒绝",
    "approval.auto": "自动批准",
    "tool.running": "运行中…",
    "notice.moving": "正在切换到 {0} …",
    "notice.customInvalid": "自定义命令需要合法的名称和脚本",
    "error.prefix": "错误：",
    "step.label": "第 {0}/{1} 步",
    "step.labelNoLimit": "第 {0} 步",
    "notice.stopping": "正在停止…",
    "notice.stopped": "任务已停止",
    "settings.context": "上下文窗口与健壮性",
    "settings.contextHint":
      "本地小模型的上下文窗口很小。每次请求前 agent 都会先量一遍，装不下就悄悄丢掉最早的几段对话（并把过大的工具结果压缩）——磁盘上的对话不会被删短。填 0 表示使用接口报告的窗口长度。",
    "settings.contextNow": "当前占用",
    "settings.contextLimit": "上下文上限（tokens，0 = 自动）",
    "settings.requestTimeoutMs": "单次请求超时（毫秒）",
    "settings.maxRetries": "失败重试次数（429 / 5xx / 网络错误）",
    "settings.diagnose": "检测这个接口",
    "settings.diagnosing": "正在检测…",
    "settings.diagnoseHint": "检测对话、用量上报、函数调用、流式输出和上下文长度",
    "context.none": "未知上限",
    "context.line": "{0} / {1} tokens（{2}%）· {3} 条消息",
    "context.used": "已用 {0} tokens · {1} 条消息",
    "context.source.settings": "来自设置",
    "context.source.model": "来自接口",
    "context.source.unknown": "未知 —— 如果回复被截断可以手动设置",
    "context.trimmed": "已精简：丢弃 {0} 段旧对话，缩短 {1} 条工具结果",
    "chat.workdir": "工作目录",
    "chat.browse": "浏览…",
    "chat.endpoint": "接口",
    "chat.model": "模型",
    "chat.refresh": "刷新模型",
    "dir.title": "选择 agent 的工作目录",
    "dir.close": "关闭",
    "dir.up": "上一层",
    "dir.drives": "磁盘",
    "dir.go": "打开",
    "dir.use": "用这个文件夹",
    "dir.empty": "（这里没有子文件夹 —— 直接用这个文件夹，或返回上一层）",
    "dir.failed": "无法读取这个文件夹",
    "settings.kindLocal": "本地",
    "settings.kindApi": "云端 API",
    "settings.localModels": "本地模型同步",
    "settings.localModelsHint":
      "同时询问本机的 LM Studio（1234 端口）和 Ollama（11434 端口）能加载哪些模型，合成一个列表。选中属于另一个服务的模型时，接口会自动切过去。全程不联网。",
    "settings.syncLocalModels": "同步所有本地服务的模型",
    "fleet.empty": "（没有本地服务响应 —— 请先启动 LM Studio 或 Ollama，再点「刷新模型」）",
    "fleet.ok": "{0} 个模型",
    "fleet.none": "没有模型",
    "fleet.error": "无响应",
    "notice.syncDone": "已从 {1} 个本地服务同步 {0} 个模型",
    "settings.mcp": "MCP —— Model Context Protocol",
    "settings.mcpHint":
      "MCP 让 agent 用上别的程序里的工具：文件系统服务、git、数据库、你自己的服务。可以用启动命令添加（<code>stdio</code>，例如 <code>npx -y @modelcontextprotocol/server-filesystem D:\\</code>），也可以用网址添加（<code>http</code>）。这些工具会以 <code>mcp__&lt;服务器&gt;__&lt;工具&gt;</code> 出现在模型的工具列表里，执行前会征求你的同意。",
    "settings.mcpEnabled": "总开关：启用 MCP",
    "settings.mcpId": "id（a-z、0-9、_）",
    "settings.mcpCommand": "npx -y @modelcontextprotocol/server-filesystem D:\\",
    "settings.mcpStdio": "stdio",
    "settings.mcpHttp": "HTTP",
    "settings.mcpAuto": "自动批准",
    "settings.mcpAdd": "添加服务器",
    "settings.mcpRefresh": "重新连接并刷新工具",
    "settings.mcpNone": "（还没有 MCP 服务器 —— 在下面添加一个）",
    "settings.mcpState": "已打开 {0} 个服务器 · 提供 {1} 个工具 · 刷新于 {2}",
    "settings.mcpOffState": "MCP 已关闭：不会启动任何服务器，也不会向模型提供 MCP 工具。",
    "settings.mcpNever": "从未",
    "mcp.connected": "已连接",
    "mcp.disconnected": "未连接",
    "mcp.on": "已连接，{0} 个工具",
    "mcp.disabled": "已关闭",
    "mcp.tools": "{0} 个工具：{1}",
    "mcp.remove": "删除",
    "notice.mcpRefreshed": "MCP：{1} 个服务器提供了 {0} 个工具",
    "notice.mcpAdded": "已添加 MCP 服务器 {0}",
    "notice.mcpRemoved": "已删除 MCP 服务器 {0}",
    "chat.current": "当前",
    "notice.workdirChanged": "工作目录：{0}",
  },
};

let lang = "en";

function t(key, ...args) {
  const table = I18N[lang] ?? I18N.en;
  let text = table[key] ?? I18N.en[key] ?? key;
  args.forEach((value, index) => {
    text = text.replaceAll(`{${index}}`, String(value));
  });
  return text;
}

/* --------------------------------------------------------------- elements */

const el = (id) => document.getElementById(id);
const log = el("log");
const input = el("input");
const sendBtn = el("send");
const title = el("title");
const conn = el("conn");
const notice = el("notice");

const CLIENT_ID =
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

let running = false;
let connState = "offline";
let openTools = [];
let state = {
  settings: {},
  tools: [],
  allTools: [],  memory: null,
  conversation: null,
  usage: null,
  data: null,
  context: null,
  version: "",
  mcp: null,
  windows: null,
};
/** Local endpoints found by the last model refresh (LM Studio / Ollama). */
let discovered = { endpoints: null, merged: null, sync: false };
let customTools = [];
let termHistory = [];
let termHistoryIndex = -1;
let settingsFilePath = "";

/** Usage of the LLM call that is being rendered right now, waiting for its last element. */
let pendingUsage = null;
let pendingUsageAnchor = null;
/** The assistant bubble text is currently being streamed into, if any. */
let streamBubble = null;
/** The reasoning block of the step being drawn, if any (see showThinking). */
let thinkingEl = null;
let thinkingBody = null;
let thinkingChars = 0;
let thinkingClosed = false;

/* ---------------------------------------------------------------- verbosity */

/** The three levels, mirroring VERBOSITY_LEVELS in src/settings.ts. */
const LEVELS = ["answer", "thinking", "full"];

/** How much of the process the chat draws right now. */
function verbosity() {
  const value = String(state.settings?.verbosity ?? "answer");
  return LEVELS.includes(value) ? value : "answer";
}

/** The model's reasoning deserves a block. */
const showsThinking = () => verbosity() !== "answer";
/** Tool calls, their results, step markers and token captions. */
const showsProcess = () => verbosity() === "full";

/** i18n keys for the three stops: short label, and the "now:" line under the slider. */
const LEVEL_NAME = {
  answer: "settings.verbosityAnswer",
  thinking: "settings.verbosityThinking",
  full: "settings.verbosityFull",
};
const LEVEL_STATE = {
  answer: "settings.verbosityStateAnswer",
  thinking: "settings.verbosityStateThinking",
  full: "settings.verbosityStateFull",
};

/* ---------------------------------------------------------------- utilities */

function setText(node, text) {
  node.textContent = text;
}

// Follow new output only while the reader is already at the bottom: the panes scroll
// themselves now, so yanking the view down mid-history would lose their place.
//
// The flag is set by real scroll events rather than measured at append time, so one
// tall tool result cannot strand the view above the answer that follows it.
const NEAR_BOTTOM = 120;
let followLog = true;

log.addEventListener("scroll", () => {
  followLog = log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM;
});

function atBottom(node) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM;
}

function followBottom(node) {
  if (node === log ? followLog : atBottom(node)) node.scrollTop = node.scrollHeight;
}

/** Jump to the newest output: a reload, or the reader just sent something. */
function scrollToBottom(node) {
  node.scrollTop = node.scrollHeight;
  if (node === log) followLog = true;
  // One more pass after the layout settles: bubbles, usage rows and wrapped text
  // can still add a few pixels after the first measurement.
  requestAnimationFrame(() => {
    if (node === log ? followLog : atBottom(node)) node.scrollTop = node.scrollHeight;
  });
}

function showNotice(text, ms = 4000) {
  notice.textContent = text;
  if (text) setTimeout(() => (notice.textContent = ""), ms);
}

async function api(path, method = "GET", body) {
  const options = { method, headers: { "X-Client-Id": CLIENT_ID } };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  return res.json().catch(() => ({}));
}

/* -------------------------------------------------------------- language */

function applyLanguage() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll("[data-i18n-html]")) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }

  // Re-apply the dynamic bits that depend on the language.
  el("title").textContent = running ? t("title.working") : t("title.ready");
  setConn(connState);
  if (settingsFilePath) setText(el("settingsFile"), t("settings.savedFile", settingsFilePath));
  if (state.settings) {
    el("s-apiKey").placeholder = state.settings.apiKeySet
      ? t("settings.apiKeyStored")
      : t("settings.apiKeyNone");
  }
  el("s-msg").textContent = "";
  renderCustomTools();
  renderUsage(state.usage);
  renderData(state.data);
  renderContext(state.context);
  if (state.settings && state.settings.profiles) renderRuntime(state.settings);
  renderMcp();
  renderFleet();
  renderModeState();
  renderVerbosityState();
  renderWindows();
}

async function setLanguage(value, persist = true) {
  const next = value === "zh" ? "zh" : "en";
  const changed = next !== lang;
  lang = next;
  el("language").value = next;
  el("s-language").value = next;
  applyLanguage();
  if (persist && changed) {
    const result = await api("/api/settings", "POST", { language: next });
    if (result.settings) state.settings = result.settings;
  }
}

/* ------------------------------------------------------------------ chat */

function clearEmpty() {
  const empty = el("empty");
  if (empty) empty.remove();
}

function addBubble(role, text) {
  clearEmpty();
  if (role === "assistant") closeThinking();
  // A streamed reply already built this bubble: fill in the final text.
  if (role === "assistant" && streamBubble) {
    const div = streamBubble;
    streamBubble = null;
    div.classList.remove("streaming");
    setText(div, text);
    if (pendingUsage) pendingUsageAnchor = div;
    followBottom(log);
    return div;
  }
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  setText(div, text);
  log.appendChild(div);
  if (role === "assistant" && pendingUsage) pendingUsageAnchor = div;
  followBottom(log);
  return div;
}

/** A live token from the model: grow the streaming bubble (or start one). */
function addDelta(text) {
  clearEmpty();
  closeThinking();
  if (!streamBubble) {
    const div = document.createElement("div");
    div.className = "bubble assistant streaming";
    log.appendChild(div);
    streamBubble = div;
  }
  streamBubble.textContent += text;
  if (pendingUsage) pendingUsageAnchor = streamBubble;
  followBottom(log);
}

/** Stop waiting for more tokens (the turn ended early). */
function closeStream(stopped = false) {
  if (!streamBubble) return;
  streamBubble.classList.remove("streaming");
  if (stopped) streamBubble.classList.add("stopped");
  streamBubble = null;
}

/**
 * The model's reasoning, live: a block that folds away as soon as the step starts
 * answering (a wall of thinking would push the answer off the screen). It stays in
 * the log, so a folded block can be opened again - and a reload redraws it from the
 * conversation record.
 */
function showThinking(text, chars) {
  if (!showsThinking()) return;
  clearEmpty();
  if (!thinkingEl || thinkingClosed) {
    thinkingEl = document.createElement("details");
    thinkingEl.className = "thinking";
    thinkingEl.open = true;
    const summary = document.createElement("summary");
    thinkingBody = document.createElement("div");
    thinkingBody.className = "thinking-body";
    thinkingEl.append(summary, thinkingBody);
    log.appendChild(thinkingEl);
    thinkingChars = 0;
    thinkingClosed = false;
    setText(summary, t("chat.thinking", 0));
  }
  if (text) thinkingBody.textContent += text;
  if (chars !== undefined && chars !== null) thinkingChars = chars;
  const summary = thinkingEl.querySelector("summary");
  setText(summary, t("chat.thinking", fmtInt(thinkingChars)));
  followBottom(log);
}

/** The step is answering: fold its reasoning away but keep it in the log. */
function closeThinking() {
  if (!thinkingEl) return;
  if (!thinkingClosed) {
    thinkingClosed = true;
    thinkingEl.open = false;
    setText(thinkingEl.querySelector("summary"), t("chat.thought", fmtInt(thinkingChars)));
  }
  thinkingEl = null;
  thinkingBody = null;
}

/** A finished reasoning block, for a conversation replayed from disk. */
function addThought(text) {
  if (!showsThinking()) return;
  const details = document.createElement("details");
  details.className = "thinking";
  const summary = document.createElement("summary");
  setText(summary, t("chat.thought", fmtInt(text.length)));
  const body = document.createElement("div");
  body.className = "thinking-body";
  setText(body, text);
  details.append(summary, body);
  log.appendChild(details);
  followBottom(log);
}

function addStep(step, max) {
  if (!showsProcess()) return;
  clearEmpty();
  const div = document.createElement("div");
  div.className = "step";
  // max 0 = no step limit: show the counter only.
  setText(div, max > 0 ? t("step.label", step, max) : t("step.labelNoLimit", step));
  log.appendChild(div);
  followBottom(log);
}

function addToolCall(name, args) {
  if (!showsProcess()) return null;
  clearEmpty();
  closeThinking();
  const card = document.createElement("div");
  card.className = "tool";

  const head = document.createElement("div");
  head.className = "tool-head";
  const nameEl = document.createElement("span");
  nameEl.className = "tool-name";
  setText(nameEl, name);
  const argsEl = document.createElement("span");
  argsEl.className = "tool-args";
  setText(argsEl, args);
  head.append(nameEl, argsEl);

  const body = document.createElement("div");
  body.className = "tool-body";
  setText(body, t("tool.running"));
  card.append(head, body);
  head.addEventListener("click", () => card.classList.toggle("open"));

  log.appendChild(card);
  openTools.push({ name, card, body });
  if (pendingUsage) pendingUsageAnchor = card;
  followBottom(log);
  return card;
}

function addToolResult(name, result) {
  if (!showsProcess()) return;
  const index = openTools.findIndex((entry) => entry.name === name);
  const entry = index >= 0 ? openTools.splice(index, 1)[0] : null;
  const failed = /^Error:|exit code/i.test(result);
  let card;
  if (entry) {
    setText(entry.body, result);
    entry.card.classList.add("done");
    if (failed) entry.card.classList.add("failed", "open");
    card = entry.card;
  } else {
    card = addToolCall(name, "");
    setText(card.querySelector(".tool-body"), result);
    card.classList.add("done");
  }
  if (pendingUsage) pendingUsageAnchor = card;
  followBottom(log);
}

function addApproval(ev) {
  clearEmpty();
  const wrap = document.createElement("div");
  wrap.className = "approval";
  wrap.id = `approval-${ev.id}`;

  const q = document.createElement("div");
  q.className = "q";
  q.append(t("approval.question"));
  const code = document.createElement("code");
  setText(code, ev.summary);
  q.append(code);

  const row = document.createElement("div");
  row.className = "row";

  if (ev.auto && ev.approved) {
    row.append(Object.assign(document.createElement("div"), { textContent: t("approval.auto") }));
    wrap.classList.add("resolved");
  } else {
    const yes = document.createElement("button");
    yes.className = "primary";
    yes.textContent = t("approval.approve");
    const no = document.createElement("button");
    no.textContent = t("approval.deny");
    yes.onclick = () => decideApproval(ev.id, true, wrap);
    no.onclick = () => decideApproval(ev.id, false, wrap);
    row.append(yes, no);
  }

  wrap.append(q, row);
  log.appendChild(wrap);
  followBottom(log);
}

async function decideApproval(id, approved, wrap) {
  wrap.classList.add("resolved");
  setText(wrap.querySelector(".row"), approved ? t("approval.approved") : t("approval.denied"));
  await api("/api/approve", "POST", { id, approved });
}

function setConn(value) {
  connState = value;
  const key = value === "online" ? "status.online" : value === "busy" ? "status.busy" : "status.offline";
  conn.textContent = t(key);
  conn.className = `dot ${value}`;
}

function setRunning(value) {
  running = value;
  sendBtn.disabled = value;
  el("stop").hidden = !value;
  title.textContent = value ? t("title.working") : t("title.ready");
  setConn(value ? "busy" : "online");
}

/** Ask the server to stop the turn that is running. */
async function stopTask() {
  if (!running) return;
  await api("/api/abort", "POST", {});
}

/* ------------------------------------------------------------------- usage */

function fmtInt(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

/** The speed the endpoint reported, or completion tokens over wall time. */
function usageSpeed(u) {
  if (u.tokensPerSecond) return u.tokensPerSecond;
  const seconds = (u.elapsedMs || 0) / 1000;
  return seconds > 0 && u.completionTokens ? u.completionTokens / seconds : null;
}

/** One line like "↑14 ↓122 (96 reasoning) · 204.0 tok/s · 0.8s · cache 900". */
function usageText(u) {
  const parts = [`↑${fmtInt(u.promptTokens)}`, `↓${fmtInt(u.completionTokens)}`];
  if (u.reasoningTokens > 0) parts[1] += ` (${fmtInt(u.reasoningTokens)} ${t("usage.reasoning")})`;
  const speed = usageSpeed(u);
  if (speed) parts.push(`${speed.toFixed(1)} tok/s`);
  if (u.elapsedMs) parts.push(`${(u.elapsedMs / 1000).toFixed(1)}s`);
  if (u.cachedTokens > 0) parts.push(`${t("usage.cache")} ${fmtInt(u.cachedTokens)}`);
  if (u.estimated) parts.push(t("usage.estimated"));
  return parts.join(" · ");
}

function usageCaption(u) {
  const div = document.createElement("div");
  div.className = "usage";
  setText(div, usageText(u));
  return div;
}

/** Place the finished call's caption right after the last element it produced. */
function flushUsage() {
  if (!pendingUsage) return;
  const caption = usageCaption(pendingUsage);
  if (pendingUsageAnchor && pendingUsageAnchor.isConnected) pendingUsageAnchor.after(caption);
  else log.appendChild(caption);
  pendingUsage = null;
  pendingUsageAnchor = null;
  followBottom(log);
}

/** A new LLM call started: park its usage until the reply has been drawn. */
function setUsage(u) {
  flushUsage();
  // Per-call token captions are part of the machine room (see verbosity).
  if (!showsProcess()) return;
  pendingUsage = u;
  pendingUsageAnchor = null;
}

/** Sidebar totals: the open conversation plus everything ever. */
function renderUsage(snapshot) {
  if (!snapshot) return;
  state.usage = snapshot;
  const c = snapshot.conversation ?? null;
  const all = snapshot.allTime ?? null;
  const empty = !c || !c.calls;
  setText(el("u-in"), empty ? "—" : fmtInt(c.promptTokens));
  setText(el("u-out"), empty ? "—" : fmtInt(c.completionTokens));
  setText(el("u-total"), empty ? "—" : fmtInt(c.totalTokens));
  const speed = empty ? null : usageSpeed(c);
  setText(el("u-speed"), speed ? `${speed.toFixed(1)} tok/s` : "—");
  setText(
    el("u-cache"),
    c && c.cacheHitRate !== null && c.cacheHitRate !== undefined
      ? `${fmtInt(c.cachedTokens)} (${Math.round(c.cacheHitRate * 100)}%)`
      : "—",
  );
  setText(el("u-all"), all && all.calls ? fmtInt(all.totalTokens) : "—");
}

/**
 * How full the model's context window is: one sidebar cell plus a line in
 * Settings. `{ limit, estimatedTokens, source, messages, trimmed, ... }`.
 */
function renderContext(ctx) {
  if (!ctx) return;
  state.context = ctx;
  const cell = el("u-context");
  const line = el("s-contextNow");
  if (!cell || !line) return;
  const used = fmtInt(ctx.estimatedTokens);
  if (ctx.limit) {
    const limit = fmtInt(ctx.limit);
    const percent = Math.round((ctx.estimatedTokens / ctx.limit) * 100);
    setText(cell, `${used} / ${limit}`);
    cell.title = t("context.line", used, limit, percent, ctx.messages ?? 0);
    cell.classList.toggle("warn", percent >= 75);
    let detail = `${t("context.line", used, limit, percent, ctx.messages ?? 0)} · ${t(
      `context.source.${ctx.source}`,
    )}`;
    if (ctx.trimmed) {
      detail += ` · ${t("context.trimmed", ctx.droppedMessages ?? 0, ctx.truncatedToolResults ?? 0)}`;
    }
    setText(line, detail);
  } else {
    setText(cell, used);
    cell.title = t("context.source.unknown");
    cell.classList.remove("warn");
    setText(
      line,
      `${t("context.used", used, ctx.messages ?? 0)} · ${t("context.source.unknown")}`,
    );
  }
}

/** The data folder panel in Settings. */
function renderData(info) {
  if (!info) return;
  state.data = info;
  setText(el("d-dir"), info.dir);
  setText(
    el("d-conv"),
    `${info.conversation?.id ?? "?"} · ${info.conversation?.messages ?? 0} ${t("usage.messages")}`,
  );
  const c = info.usage?.conversation ?? {};
  setText(
    el("d-usage"),
    c.calls ? `↑${fmtInt(c.promptTokens)} ↓${fmtInt(c.completionTokens)} = ${fmtInt(c.totalTokens)}` : "—",
  );

  const list = info.list ?? [];
  setText(el("d-archived"), String(list.length));
  const box = el("d-list");
  box.innerHTML = "";
  if (list.length === 0) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = t("settings.noArchived");
    box.appendChild(p);
    return;
  }
  for (const row of list.slice(0, 15)) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "archived-item";
    item.title = t("settings.reopenHint");
    const id = document.createElement("code");
    setText(id, row.id);
    const meta = document.createElement("span");
    meta.className = "grow";
    setText(meta, `${row.messages} ${t("usage.messages")} · ${fmtInt(row.usage?.totalTokens)} tokens`);
    item.append(id, meta);
    item.onclick = () => reopenConversation(row.id);
    box.appendChild(item);
  }
}

async function loadData() {
  const info = await api("/api/data");
  if (info.error) return;
  renderData(info);
  if (info.usage) renderUsage(info.usage);
  await Promise.all([refreshAudit(), refreshSkills()]);
}

/* ------------------------------------------------------- audit log & undo */

/** Ask the server what has been changed and what can still be undone. */
async function refreshAudit() {
  const report = await api("/api/audit?n=12");
  if (report.error) return;
  renderAudit(report);
}

function renderAudit(report) {
  const list = el("a-list");
  if (!list) return;
  setText(el("a-file"), report.file ?? "…");
  setText(
    el("a-pending"),
    report.enabled === false
      ? t("settings.auditOff")
      : `${report.pending?.length ?? 0}  ${t("settings.auditUndoable")}`,
  );
  const undo = el("a-undo");
  undo.disabled = report.enabled === false || (report.pending?.length ?? 0) === 0;
  list.innerHTML = "";
  // What can still be rolled back, by number: one button per such row, so a
  // specific change can be picked instead of "the newest one".
  const rollbackable = new Set((report.pending ?? []).map((entry) => entry.seq));
  const entries = report.entries ?? [];
  if (entries.length === 0) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = t("settings.auditEmpty");
    list.appendChild(p);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "audit-item";
    const stamp = String(entry.time ?? "").replace("T", " ").slice(0, 19);
    const line = document.createElement("span");
    line.className = "grow";
    setText(
      line,
      t("settings.auditLine", stamp, entry.tool, entry.action, entry.summary ?? ""),
    );
    const flag = document.createElement("span");
    flag.className = "muted";
    setText(flag, entry.undoable && entry.action !== "undo" ? t("settings.auditUndoable") : "");
    row.append(line, flag);
    if (rollbackable.has(entry.seq)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost";
      button.textContent = t("settings.auditRollback");
      button.title = `${entry.summary ?? ""}`;
      button.addEventListener("click", () => requestUndo({ seq: entry.seq }, button));
      row.appendChild(button);
    }
    list.appendChild(row);
  }
}

/* --------------------------------------------------------------- SSE events */

function handle(ev) {
  switch (ev.type) {
    case "user":
      addBubble("user", ev.text);
      // A message was just sent (probably by this reader): show the newest output.
      scrollToBottom(log);
      break;
    case "assistant":
      addBubble("assistant", ev.text);
      break;
    case "delta":
      addDelta(ev.text);
      break;
    case "thinking":
      showThinking(ev.text ?? "", ev.chars);
      break;
    case "step":
      flushUsage();
      if (ev.step > 1) addStep(ev.step, ev.max);
      break;
    case "tool_call":
      addToolCall(ev.name, ev.args);
      break;
    case "tool_result":
      addToolResult(ev.name, ev.result);
      break;
    case "usage":
      if (ev.totals) renderUsage(ev.totals);
      if (ev.usage) setUsage(ev.usage);
      break;
    case "approval":
      addApproval(ev);
      break;
    case "done":
      flushUsage();
      closeStream();
      closeThinking();
      if (ev.totals) renderUsage(ev.totals);
      setRunning(false);
      if (el("view-settings").classList.contains("active")) loadData();
      break;
    case "stopping":
      showNotice(t("notice.stopping"));
      break;
    case "stopped":
      flushUsage();
      closeStream(true);
      closeThinking();
      setRunning(false);
      showNotice(t("notice.stopped"));
      break;
    case "error":
      flushUsage();
      closeStream(true);
      closeThinking();
      setRunning(false);
      addBubble("error", `${t("error.prefix")}${ev.message}`);
      break;
    case "status":
      setRunning(ev.running);
      // A finished turn changed something (or did not): the change log panel is
      // the place to see what, so keep it current without a reload.
      if (!ev.running) refreshAudit();
      break;
    case "reset":
      clearLog();
      break;
    case "reload_history":
      reloadHistory();
      break;
    case "archived":
      loadData();
      break;
    case "context":
      renderContext(ev);
      break;
    case "settings":
      applySettingsToUi(ev.settings);
      break;
    case "terminal":
      if (ev.clientId === CLIENT_ID) break; // this tab renders it from the POST response
      termAppend(ev.input, ev.output, ev.kind, ev.cwd);
      break;
    case "server_restart":
      showNotice(t("notice.moving", ev.url), 15000);
      break;
    case "notice":
      showNotice(ev.text, 8000);
      break;
    case "audit":
      // A change (or an undo) finished; keep the change log panel honest.
      refreshAudit();
      break;
  }
}

let connectedOnce = false;

function connect() {
  const es = new EventSource("/api/events");
  es.onopen = () => {
    setConn(running ? "busy" : "online");
    // After a server restart the page is showing a conversation that may no
    // longer be the open one, so redraw from /api/state.
    if (connectedOnce) {
      reloadHistory();
      loadData();
    }
    connectedOnce = true;
  };
  es.onmessage = (event) => {
    try {
      handle(JSON.parse(event.data));
    } catch {
      /* ignore malformed frame */
    }
  };
  es.onerror = () => setConn("offline");
}

/* ---------------------------------------------------------------- terminal */

function termLine(text, cls) {
  const div = document.createElement("div");
  div.className = `term-line ${cls}`;
  setText(div, text);
  el("term").appendChild(div);
  followBottom(el("term"));
}

function termAppend(command, output, kind, cwd) {
  termLine(command, kind === "internal" ? "term-sys" : "term-cmd");
  const failed = /^Error:|^exit code/i.test(output);
  termLine(output, failed ? "term-err" : "term-out");
  if (cwd) {
    el("termPrompt").textContent = `PS ${cwd}>`;
    setText(el("cwd"), cwd);
  }
}

async function runTerminalLine(line) {
  termHistory.push(line);
  termHistoryIndex = termHistory.length;
  const result = await api("/api/terminal", "POST", { input: line });
  if (result.error) {
    termLine(`${t("error.prefix")}${result.error}`, "term-err");
    return;
  }
  termAppend(line, result.output, result.kind, result.cwd);
}

/* --------------------------------------------------------- profiles/models */

function profileList(settings) {
  return settings.profiles ?? [];
}

function activeProfileOf(settings) {
  return profileList(settings).find((p) => p.id === settings.activeProfile) ?? null;
}

/** Remembered models for the active endpoint, plus whatever is selected now. */
function modelNames(settings) {
  const list = [...(activeProfileOf(settings)?.models ?? [])];
  if (settings.model && !list.includes(settings.model)) list.unshift(settings.model);
  return list;
}

function fillModelSelect(select, settings) {
  const names = modelNames(settings);
  select.innerHTML = "";
  if (names.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("runtime.noModels");
    select.appendChild(option);
    return;
  }
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === settings.model) option.selected = true;
    select.appendChild(option);
  }
}

function fillProfileSelect(select, settings, withModel) {
  select.innerHTML = "";
  for (const profile of profileList(settings)) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = withModel ? `${profile.id} — ${profile.model || "?"}` : profile.name || profile.id;
    if (profile.id === settings.activeProfile) option.selected = true;
    select.appendChild(option);
  }
}

/** Sidebar quick-switch + the endpoint pickers in Settings. */
function renderRuntime(settings) {
  if (!settings) return;
  fillProfileSelect(el("q-profile"), settings, false);
  fillModelSelect(el("q-model"), settings);
  fillProfileSelect(el("s-profile"), settings, true);
  fillModelSelect(el("s-modelPick"), settings);
  fillProfileSelect(el("chat-profile"), settings, false);
  fillChatModelSelect(settings);
  fillWorkdirSelect(settings);
}

/* ------------------------------------------------- chat: working directory */

/** The chat picker: the current working directory plus the recent ones. */
function fillWorkdirSelect(settings) {
  const select = el("chat-workdir");
  if (!select) return;
  const current = settings.workdir ?? "";
  const list = [current, ...(settings.recentWorkdirs ?? [])].filter(Boolean);
  select.innerHTML = "";
  const seen = new Set();
  for (const dir of list) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const option = document.createElement("option");
    option.value = dir;
    option.textContent = dir;
    option.title = dir;
    if (dir === current) option.selected = true;
    select.appendChild(option);
  }
}

/** Change the agent's working directory (used by the picker and the dialog). */
async function useWorkdir(dir) {
  if (!dir) return;
  const result = await api("/api/settings", "POST", { workdir: dir });
  if (result.error) {
    showNotice(`${t("error.prefix")}${result.error}`);
    return;
  }
  if (result.settings) {
    state.settings = result.settings;
    applySettingsToUi(result.settings);
  }
  showNotice(t("notice.workdirChanged", dir));
}

/* ------------------------------------------------------- chat: model picker */

/**
 * The model list of the chat toolbar. When "sync local models" is on, every
 * local server is listed as its own group, so a model can be picked from
 * anywhere - and picking it switches the endpoint behind it.
 */
function modelGroups(settings) {
  const groups = [];
  const seen = new Set();
  const active = activeProfileOf(settings);
  const push = (label, models, endpointId) => {
    const list = [];
    for (const id of models ?? []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push({ id, endpointId });
    }
    if (list.length > 0) groups.push({ label, models: list });
  };

  push(
    active ? `${active.id} — ${t("chat.current")}` : t("chat.current"),
    modelNames(settings),
    settings.activeProfile,
  );
  for (const endpoint of discovered.endpoints ?? []) {
    if (endpoint.id === settings.activeProfile) continue;
    push(
      endpoint.ok ? endpoint.label : `${endpoint.label} (${t("fleet.error")})`,
      endpoint.models,
      endpoint.id,
    );
  }
  return groups;
}

function fillChatModelSelect(settings) {
  const select = el("chat-model");
  if (!select) return;
  select.innerHTML = "";
  const groups = modelGroups(settings);
  for (const group of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const model of group.models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.id;
      option.dataset.profile = model.endpointId ?? "";
      if (model.id === settings.model) option.selected = true;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
  if (select.options.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("runtime.noModels");
    select.appendChild(option);
  }
}

/* --------------------------------------------------------- folder browsing */

let dirPath = "";

async function openDirPicker() {
  const dialog = el("dirDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  await showDir(state.settings?.workdir ?? "");
}

/** Ask the server for the sub-folders of `target` and draw them. */
async function showDir(target) {
  const list = el("dir-list");
  const data = await api(`/api/fs/list?path=${encodeURIComponent(target ?? "")}`);
  list.innerHTML = "";
  if (data.error) {
    setText(el("dir-current"), t("dir.failed"));
    const row = document.createElement("div");
    row.className = "dir-empty";
    setText(row, `${t("error.prefix")}${data.error}`);
    list.appendChild(row);
    return;
  }
  dirPath = data.path ?? "";
  el("dir-path").value = dirPath;
  setText(el("dir-current"), dirPath || t("dir.drives"));
  for (const dir of data.dirs ?? []) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dir-item";
    const icon = document.createElement("span");
    icon.className = "icon";
    setText(icon, data.drives ? "▣" : "▸");
    const name = document.createElement("span");
    setText(name, dir.name);
    item.append(icon, name);
    item.onclick = () => showDir(dir.path);
    list.appendChild(item);
  }
  if ((data.dirs ?? []).length === 0) {
    const row = document.createElement("div");
    row.className = "dir-empty";
    setText(row, t("dir.empty"));
    list.appendChild(row);
  }
  el("dirDialog").dataset.parent = data.parent ?? "";
}

/* ------------------------------------------- local model sync (LM + Ollama) */

/** One row per local server that was asked for its model list. */
function renderFleet() {
  const box = el("sync-list");
  if (!box) return;
  box.innerHTML = "";
  const endpoints = discovered.endpoints ?? [];
  if (endpoints.length === 0) {
    const row = document.createElement("div");
    row.className = "muted";
    setText(row, t("fleet.empty"));
    box.appendChild(row);
    return;
  }
  for (const endpoint of endpoints) {
    const row = document.createElement("div");
    row.className = "fleet-item";
    const name = document.createElement("span");
    name.className = "name";
    setText(name, endpoint.label);
    const meta = document.createElement("span");
    meta.className = "meta";
    setText(
      meta,
      endpoint.ok
        ? `${endpoint.models.length ? t("fleet.ok", endpoint.models.length) : t("fleet.none")} · ${endpoint.source}`
        : `${t("fleet.error")}${endpoint.error ? ` — ${endpoint.error}` : ""}`,
    );
    row.append(name, meta);
    box.appendChild(row);
  }
}

/* ------------------------------------------------------------------- MCP */

/** The MCP picture the server sent, or a safe placeholder before the first load. */
function mcpSnapshot() {
  if (state.mcp) return state.mcp;
  const s = state.settings ?? {};
  return {
    enabled: !!s.mcpEnabled,
    totalTools: 0,
    ageMs: -1,
    servers: (s.mcpServers ?? []).map((server) => ({
      ...server,
      connected: false,
      liveTools: [],
      error: "",
    })),
  };
}

function ageText(ms) {
  if (ms === null || ms === undefined || ms < 0) return t("settings.mcpNever");
  if (ms < 5000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function switchControl(checked, title, onChange, label) {
  const wrap = document.createElement("label");
  wrap.className = "switch";
  wrap.title = title ?? "";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = () => onChange(input.checked);
  const slider = document.createElement("span");
  slider.className = "slider";
  slider.setAttribute("aria-hidden", "true");
  wrap.append(input, slider);
  if (label) {
    const text = document.createElement("span");
    setText(text, label);
    wrap.appendChild(text);
  }
  return wrap;
}

function renderMcp() {
  const box = el("mcp-list");
  if (!box) return;
  const mcp = mcpSnapshot();
  el("s-mcpEnabled").checked = !!mcp.enabled;
  const on = mcp.servers.filter((server) => server.enabled).length;
  setText(
    el("mcp-state"),
    mcp.enabled
      ? t("settings.mcpState", on, mcp.totalTools, ageText(mcp.ageMs))
      : t("settings.mcpOffState"),
  );

  box.innerHTML = "";
  if (mcp.servers.length === 0) {
    const row = document.createElement("div");
    row.className = "muted";
    setText(row, t("settings.mcpNone"));
    box.appendChild(row);
    return;
  }

  for (const server of mcp.servers) {
    const row = document.createElement("div");
    row.className = "mcp-item";

    row.append(
      switchControl(
        server.enabled,
        t("settings.mcpEnabled"),
        (value) => mcpAction({ action: "toggle", id: server.id, enabled: value }),
      ),
    );

    const name = document.createElement("span");
    name.className = "name";
    setText(name, server.id);

    const state =
      !server.enabled
        ? t("mcp.disabled")
        : server.connected
          ? t("mcp.on", (server.liveTools ?? []).length)
          : t("mcp.disconnected");
    const meta = document.createElement("span");
    meta.className = "meta";
    const where = server.transport === "http" ? server.url : [server.command, ...(server.args ?? [])].join(" ");
    const who = server.connected && server.serverInfo ? ` · ${server.serverInfo}` : "";
    setText(meta, `${server.transport} · ${where} · ${state}${who}${server.error ? ` — ${server.error}` : ""}`);
    meta.title = `${where}${who}`;

    row.append(
      name,
      meta,
      switchControl(server.autoApprove, t("settings.mcpAuto"), (value) =>
        mcpAction({
          action: "update",
          id: server.id,
          server: { ...server, autoApprove: value, args: server.args, env: server.env },
        }),
      ),
    );

    const remove = document.createElement("button");
    remove.type = "button";
    setText(remove, t("mcp.remove"));
    remove.onclick = () => mcpAction({ action: "remove", id: server.id });
    row.appendChild(remove);

    const tools = document.createElement("span");
    tools.className = "tools";
    const list = server.liveTools?.length ? server.liveTools : server.tools ?? [];
    if (list.length > 0) setText(tools, t("mcp.tools", list.length, list.join(", ")));
    row.appendChild(tools);

    box.appendChild(row);
  }
}

async function mcpAction(body) {
  const message = el("m-msg");
  if (message) setText(message, "…");
  const result = await api("/api/mcp", "POST", body);
  if (result.error) {
    if (message) setText(message, `${t("error.prefix")}${result.error}`);
    return null;
  }
  if (result.mcp) state.mcp = result.mcp;
  renderMcp();
  await refreshState();
  if (result.tools !== undefined) {
    showNotice(t("notice.mcpRefreshed", result.tools, mcpSnapshot().servers.filter((s) => s.connected).length));
  }
  if (message) setText(message, t("notice.mcpRefreshed", mcpSnapshot().totalTools, mcpSnapshot().servers.filter((s) => s.connected).length));
  return result;
}

/** Split a command line into program + arguments, honouring quotes. */
function splitCommandLine(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(line)) !== null) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function renderMemory(settings, info) {
  setText(
    el("s-memoryInfo"),
    t(
      "settings.memoryInfo",
      settings.remember ? "on" : "off",
      info?.entries ?? 0,
      info?.bytes ?? 0,
      info?.file ?? "",
    ),
  );
}

async function useProfile(id, messageEl) {
  if (!id) return false;
  const result = await api("/api/profiles", "POST", { action: "use", id });
  if (result.error) {
    if (messageEl) setText(messageEl, `${t("error.prefix")}${result.error}`);
    return false;
  }
  state.settings = result.settings;
  applySettingsToUi(result.settings);
  if (messageEl) setText(messageEl, t("notice.profileSwitched", id));
  return true;
}

/** Ask the endpoint for its model list and remember it. */
async function loadModels(messageEl) {
  const id = el("s-profile").value || state.settings.activeProfile;
  if (messageEl) setText(messageEl, "…");
  const result = await api(`/api/models?profile=${encodeURIComponent(id)}`);
  if (!result.error) {
    // Keep what "sync local models" found so the pickers can group by server.
    discovered = {
      endpoints: result.endpoints ?? null,
      merged: result.merged ?? null,
      sync: !!result.sync,
    };
    renderFleet();
    fillChatModelSelect(state.settings);
  }
  await refreshState();
  if (result.error) {
    if (messageEl) setText(messageEl, `${t("error.prefix")}${result.error}`);
    return;
  }
  if (result.merged && result.merged.length > 0) {
    const servers = (result.endpoints ?? []).filter((e) => e.ok).length;
    if (messageEl) setText(messageEl, t("notice.syncDone", result.merged.length, servers));
    showNotice(t("notice.syncDone", result.merged.length, servers));
    return;
  }
  if (messageEl) setText(messageEl, t("notice.modelsLoaded", result.models.length, result.baseUrl));
}

/**
 * Instantly switch the model. When the model lives on another local server
 * (the sync feature), the endpoint switches with it.
 */
async function switchModel(name, profile) {
  if (!name) return;
  const patch = { model: name };
  if (profile && profile !== state.settings.activeProfile) patch.activeProfile = profile;
  const result = await api("/api/settings", "POST", patch);
  if (result.error) {
    showNotice(`${t("error.prefix")}${result.error}`);
    return;
  }
  if (result.settings) {
    state.settings = result.settings;
    applySettingsToUi(result.settings);
  }
  if (patch.activeProfile) showNotice(t("notice.profileSwitched", patch.activeProfile));
}

/* ---------------------------------------------------------------- settings */

function applySettingsToUi(s) {
  if (!s) return;
  state.settings = s;
  renderRuntime(s);
  el("dryRun").checked = s.dryRun;
  el("autoApprove").checked = s.autoApprove;
  el("sandbox").checked = s.sandbox !== false;

  if (s.language && s.language !== lang) {
    lang = s.language;
    el("language").value = lang;
    el("s-language").value = lang;
    applyLanguage();
  }
  fillSettingsForm(s);
}

function fillSettingsForm(s) {
  el("s-model").value = s.model ?? "";
  el("s-baseUrl").value = s.baseUrl ?? "";
  el("s-apiKey").value = "";
  el("s-apiKey").placeholder = s.apiKeySet ? t("settings.apiKeyStored") : t("settings.apiKeyNone");
  el("s-maxSteps").value = s.maxSteps ?? 0;
  el("s-temperature").value = s.temperature ?? 0;
  el("s-language").value = s.language ?? "en";
  el("s-workdir").value = s.workdir ?? "";
  el("s-powershell").value = s.powershell ?? "";
  el("s-webPort").value = s.webPort ?? 8787;
  el("s-systemPrompt").value = s.systemPrompt ?? "";
  el("s-webSearchUrl").value = s.webSearchUrl ?? "";
  el("s-contextLimit").value = s.contextLimit ?? 0;
  el("s-requestTimeoutMs").value = s.requestTimeoutMs ?? 180000;
  el("s-maxRetries").value = s.maxRetries ?? 2;
  el("s-dryRun").checked = !!s.dryRun;
  el("s-autoApprove").checked = !!s.autoApprove;
  el("s-sandbox").checked = s.sandbox !== false;
  el("s-autoOpenBrowser").checked = !!s.autoOpenBrowser;
  el("s-stream").checked = s.stream !== false;
  el("s-remember").checked = !!s.remember;
  el("s-syncLocalModels").checked = s.syncLocalModels !== false;
  el("s-guided").checked = (s.agentMode ?? "guided") === "guided";
  el("s-psEnglishErrors").checked = s.psEnglishErrors !== false;
  el("s-auditLog").checked = s.auditLog !== false;
  el("s-undoRetentionDays").value = s.undoRetentionDays ?? 7;
  el("s-loopGuard").checked = s.loopGuard !== false;
  setVerbosityControls(s.verbosity);
  renderModeState();
  customTools = (s.customTools ?? []).map((c) => ({ ...c }));
  renderCustomTools();
  renderToolChecks(s.enabledTools);
  renderMcp();
  renderFleet();
}

/** What the mode switch currently means, spelled out under it. */
function renderModeState() {
  const guided = el("s-guided").checked;
  setText(el("s-modeState"), t(guided ? "settings.modeStateGuided" : "settings.modeStateNormal"));
}

/** The detail level as words: the "now:" line in Settings, the label in the chatbar. */
function renderVerbosityState(index) {
  const level = LEVELS[index ?? LEVELS.indexOf(verbosity())] ?? "answer";
  setText(el("s-verbosityState"), t(LEVEL_STATE[level]));
  setText(el("chat-verbosityState"), t(LEVEL_NAME[level]));
}

/** Both sliders follow the setting - it can also change from /set or another tab. */
function setVerbosityControls(value) {
  const index = Math.max(0, LEVELS.indexOf(String(value ?? "answer")));
  el("s-verbosity").value = String(index);
  el("chat-verbosity").value = String(index);
  renderVerbosityState(index);
}

/** Apply a detail level immediately (the sidebar switches work the same way). */
async function setVerbosity(index) {
  const level = LEVELS[index] ?? "answer";
  renderVerbosityState(index);
  const result = await api("/api/settings", "POST", { verbosity: level });
  if (result.settings) state.settings = result.settings;
  applySettingsToUi(result.settings ?? state.settings);
  // What is already drawn stays as it was drawn; a redraw replays the stored
  // conversation at the new level. Never mid-turn: that would erase the live log.
  if (!running) reloadHistory();
}

/** Which PowerShell is behind the tools, and whether it can change the machine. */
function renderWindows() {
  const info = state.windows;
  if (!info) return;
  const version = info.version ? ` ${info.version}${info.edition ? ` (${info.edition})` : ""}` : "";
  const note = info.note ? ` — ${info.note}` : info.found ? "" : " — NOT FOUND";
  setText(el("w-shell"), `${info.exe}${version}${note}`);
  setText(
    el("w-admin"),
    t(info.elevated === true ? "settings.adminYes" : info.elevated === false ? "settings.adminNo" : "settings.adminUnknown"),
  );
}

function renderToolChecks(enabled) {
  const box = el("s-tools");
  box.innerHTML = "";
  for (const name of state.allTools) {
    const label = document.createElement("label");
    label.className = "tool-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.tool = name;
    checkbox.checked = enabled === null || enabled === undefined || enabled.includes(name);
    const span = document.createElement("span");
    span.textContent = name;
    const slider = document.createElement("span");
    slider.className = "slider";
    slider.setAttribute("aria-hidden", "true");
    label.append(checkbox, slider, span);
    box.appendChild(label);
  }
}

function renderCustomTools() {
  const box = el("s-custom");
  if (!box) return;
  box.innerHTML = "";
  if (customTools.length === 0) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = t("settings.noCustom");
    box.appendChild(p);
    return;
  }
  customTools.forEach((tool, index) => {
    const row = document.createElement("div");
    row.className = "custom-item";
    const name = document.createElement("code");
    setText(name, tool.name);
    const script = document.createElement("span");
    script.className = "script";
    setText(script, tool.script);
    const remove = document.createElement("button");
    remove.textContent = t("settings.remove");
    remove.onclick = () => {
      customTools.splice(index, 1);
      renderCustomTools();
    };
    row.append(name, script, remove);
    box.appendChild(row);
  });
}

/* -------------------------------------------------------------------- skills */

/** The skills the server can see, refreshed whenever the panel opens. */
let skills = [];

async function refreshSkills() {
  const report = await api("/api/skills");
  if (report.error) return;
  skills = report.skills ?? [];
  setText(el("k-dir"), report.dir ?? "…");
  renderSkills();
}

function renderSkills() {
  const box = el("s-skills");
  if (!box) return;
  box.innerHTML = "";
  if (skills.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = t("settings.skillEmpty");
    box.appendChild(empty);
    return;
  }
  for (const skill of skills) {
    const row = document.createElement("div");
    row.className = "skill-item";

    const head = document.createElement("div");
    head.className = "skill-head";
    const name = document.createElement("code");
    setText(name, skill.name);
    const when = document.createElement("span");
    when.className = "muted";
    when.textContent = skill.when ? `· ${skill.when}` : "";
    head.append(name, when);

    const description = document.createElement("div");
    description.className = "muted";
    setText(description, skill.description ?? "");

    const files = document.createElement("div");
    files.className = "muted small";
    setText(files, (skill.files ?? []).join("  ·  "));

    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost";
    edit.textContent = t("settings.skillEdit");
    edit.addEventListener("click", () => editSkill(skill.name));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = t("settings.skillDelete");
    remove.addEventListener("click", () => deleteSkillUi(skill.name));
    actions.append(edit, remove);

    row.append(head, description, files);
    if (skill.problem) {
      const problem = document.createElement("div");
      problem.className = "error";
      setText(problem, skill.problem);
      row.appendChild(problem);
    }
    row.appendChild(actions);
    box.appendChild(row);
  }
}

/** Put one skill into the editor (its body comes from the server, not the list). */
async function editSkill(name) {
  const report = await api(`/api/skills?name=${encodeURIComponent(name)}`);
  if (report.error) {
    setText(el("k-msg"), `${t("error.prefix")}${report.error}`);
    return;
  }
  const skill = report.skill ?? {};
  el("k-name").value = skill.name ?? name;
  el("k-desc").value = skill.description ?? "";
  el("k-when").value = skill.when ?? "";
  el("k-body").value = report.body ?? "";
  setText(el("k-msg"), t("settings.skillLoaded", name));
  el("k-body").focus();
}

async function saveSkillUi() {
  const name = el("k-name").value.trim();
  const body = el("k-body").value.trim();
  if (!name || !body) {
    setText(el("k-msg"), t("settings.skillNeedName"));
    return;
  }
  const result = await api("/api/skills", "POST", {
    name,
    description: el("k-desc").value.trim(),
    when: el("k-when").value.trim(),
    body,
  });
  if (result.error) {
    setText(el("k-msg"), `${t("error.prefix")}${result.error}`);
    return;
  }
  skills = result.skills ?? skills;
  renderSkills();
  setText(el("k-msg"), t("settings.skillSaved", name));
  showNotice(t("settings.skillSaved", name));
}

async function deleteSkillUi(name) {
  if (!window.confirm(t("settings.skillDeleteAsk", name))) return;
  const result = await api("/api/skills/delete", "POST", { name });
  if (result.error) {
    setText(el("k-msg"), `${t("error.prefix")}${result.error}`);
    return;
  }
  skills = result.skills ?? [];
  renderSkills();
  setText(el("k-msg"), t("settings.skillDeleted", name));
}

function clearSkillForm() {
  for (const id of ["k-name", "k-desc", "k-when", "k-body"]) el(id).value = "";
  setText(el("k-msg"), "");
  el("k-name").focus();
}

async function saveSettings() {
  const enabled = [...document.querySelectorAll('#s-tools input[type="checkbox"]:checked')].map(
    (c) => c.dataset.tool,
  );
  const allChecked = enabled.length === state.allTools.length;

  const patch = {
    model: el("s-model").value.trim(),
    baseUrl: el("s-baseUrl").value.trim(),
    maxSteps: Number(el("s-maxSteps").value),
    temperature: Number(el("s-temperature").value),
    language: el("s-language").value,
    workdir: el("s-workdir").value.trim(),
    powershell: el("s-powershell").value.trim(),
    systemPrompt: el("s-systemPrompt").value,
    webSearchUrl: el("s-webSearchUrl").value.trim(),
    contextLimit: Number(el("s-contextLimit").value) || 0,
    requestTimeoutMs: Number(el("s-requestTimeoutMs").value) || 180000,
    maxRetries: Number(el("s-maxRetries").value) || 0,
    dryRun: el("s-dryRun").checked,
    autoApprove: el("s-autoApprove").checked,
    loopGuard: el("s-loopGuard").checked,
    sandbox: el("s-sandbox").checked,
    autoOpenBrowser: el("s-autoOpenBrowser").checked,
    stream: el("s-stream").checked,
    remember: el("s-remember").checked,
    syncLocalModels: el("s-syncLocalModels").checked,
    agentMode: el("s-guided").checked ? "guided" : "normal",
    verbosity: LEVELS[Number(el("s-verbosity").value)] ?? "answer",
    psEnglishErrors: el("s-psEnglishErrors").checked,
    auditLog: el("s-auditLog").checked,
    undoRetentionDays: Number(el("s-undoRetentionDays").value) || 7,
    enabledTools: allChecked ? null : enabled,
    customTools,
  };
  const key = el("s-apiKey").value;
  if (key) patch.apiKey = key;

  const newPort = Number(el("s-webPort").value);
  const result = await api("/api/settings", "POST", patch);
  if (result.error) {
    setText(el("s-msg"), `${t("error.prefix")}${result.error}`);
    return;
  }
  state.settings = result.settings;
  applySettingsToUi(result.settings);

  let message = result.changed.length ? t("settings.saved", result.changed.join(", ")) : t("settings.noChanges");
  if (result.notices && result.notices.length) message += ` — ${result.notices.join("; ")}`;
  setText(el("s-msg"), message);

  if (Number.isInteger(newPort) && newPort !== state.settings.webPort) {
    const moved = await api("/api/port", "POST", { port: newPort });
    if (moved.url) {
      setText(el("s-msg"), t("settings.moving", moved.url));
      showNotice(t("notice.moving", moved.url), 20000);
    }
  }
  refreshState();
}

/* ------------------------------------------------------------------ shell */

async function refreshState() {
  const data = await api("/api/state");
  state.allTools = data.allTools ?? [];
  state.withheld = data.withheld ?? [];
  setText(el("cwd"), data.cwd);
  el("termPrompt").textContent = `PS ${data.cwd}>`;
  el("dryRun").checked = data.settings.dryRun;
  el("autoApprove").checked = data.settings.autoApprove;
  el("sandbox").checked = data.settings.sandbox !== false;
  state.settings = data.settings;
  state.version = data.version ?? state.version;
  setVerbosityControls(data.settings.verbosity);
  state.mcp = data.mcp ?? state.mcp;
  state.windows = data.windows ?? state.windows;
  setText(el("version"), state.version ? `v${state.version}` : "");
  renderRuntime(data.settings);
  renderMcp();
  renderWindows();
  renderMemory(data.settings, data.memory);
  renderUsage(data.usage);
  renderContext(data.context);
  state.memory = data.memory;
  state.conversation = data.conversation ?? null;

  const chips = el("tools");
  chips.innerHTML = "";
  for (const name of data.tools) {
    const chip = document.createElement("span");
    chip.className = "chip";
    setText(chip, name);
    chips.appendChild(chip);
  }

  // Guided mode takes the raw shell out of the catalogue (see createWindowsTools):
  // say so, otherwise the tool just looks missing.
  const withheld = data.withheld ?? [];
  const note = el("s-toolsNote");
  if (note) {
    setText(
      note,
      withheld.length === 0
        ? ""
        : t("settings.toolsWithheld", withheld.map((item) => item.name).join(", ")),
    );
  }

  for (const text of data.notices ?? []) showNotice(text, 8000);
}

/** Empty the chat view (starting or loading a conversation). */
function clearLog() {
  log.innerHTML = "";
  followLog = true;
  openTools = [];
  pendingUsage = null;
  pendingUsageAnchor = null;
  streamBubble = null;
  thinkingEl = null;
  thinkingBody = null;
  thinkingChars = 0;
  thinkingClosed = false;
}

/** Re-draw the chat from whatever conversation is open on the server. */
async function reloadHistory() {
  const data = await api("/api/state");
  clearLog();
  renderHistory(data.history ?? [], data.usage?.calls ?? []);
  renderUsage(data.usage);
  state.conversation = data.conversation ?? null;
  if (el("view-settings").classList.contains("active")) loadData();
}

/** Bring an archived conversation back into the chat. */
async function reopenConversation(id) {
  const result = await api("/api/conversations", "POST", { action: "load", id });
  if (result.error) {
    showNotice(`${t("error.prefix")}${result.error}`);
    return;
  }
  switchTab("chat");
  showNotice(t("settings.reopened", id));
  // Other tabs redraw from the broadcast; this one does it right away.
  await Promise.all([reloadHistory(), loadData()]);
}

/** 记忆化: replay the stored conversation so a reload does not lose it. */
function renderHistory(entries, calls = []) {
  if (!entries || entries.length === 0) return;
  let callIndex = 0;
  for (const entry of entries) {
    if (entry.role === "user") {
      flushUsage();
      if (entry.content) addBubble("user", entry.content);
    } else if (entry.role === "assistant") {
      flushUsage();
      const usage = calls[callIndex++];
      if (usage) setUsage(usage);
      // The reasoning comes first: it is what the model did before it spoke.
      if (entry.reasoning) addThought(entry.reasoning);
      if (entry.content) addBubble("assistant", entry.content);
      for (const call of entry.tool_calls ?? []) {
        addToolCall(call.function?.name ?? "?", call.function?.arguments ?? "{}");
      }
      if (!entry.tool_calls || entry.tool_calls.length === 0) flushUsage();
    } else if (entry.role === "tool") {
      addToolResult(entry.name ?? "?", entry.content ?? "");
    }
  }
  flushUsage();
  // A reload replays the whole conversation: start at the newest message, not at
  // whatever position the layout happened to leave behind.
  scrollToBottom(log);
}

function switchTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
  for (const view of document.querySelectorAll(".view")) {
    view.classList.toggle("active", view.id === `view-${name}`);
  }
  if (name === "settings" && !el("s-model").value) {
    fillSettingsForm(state.settings);
  }
  if (name === "settings") loadData();
  if (name === "terminal") el("termInput").focus();
}

/* -------------------------------------------------------------------- wire */

el("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || running) return;
  input.value = "";
  input.style.height = "auto";
  api("/api/chat", "POST", { message: text });
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el("composer").requestSubmit();
  }
});

el("stop").addEventListener("click", () => stopTask());

// Esc anywhere (outside a text field's own handling) stops the running task.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && running && document.activeElement !== el("termInput")) {
    stopTask();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});
el("openSettings").addEventListener("click", () => switchTab("settings"));

el("termForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const line = el("termInput").value.trim();
  if (!line) return;
  el("termInput").value = "";
  runTerminalLine(line);
});

el("termHelp").addEventListener("click", () => runTerminalLine("/help"));

el("termInput").addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    if (termHistoryIndex > 0) {
      termHistoryIndex -= 1;
      el("termInput").value = termHistory[termHistoryIndex] ?? "";
    }
    event.preventDefault();
  } else if (event.key === "ArrowDown") {
    if (termHistoryIndex < termHistory.length - 1) {
      termHistoryIndex += 1;
      el("termInput").value = termHistory[termHistoryIndex] ?? "";
    } else {
      termHistoryIndex = termHistory.length;
      el("termInput").value = "";
    }
    event.preventDefault();
  }
});

el("language").addEventListener("change", (event) => setLanguage(event.target.value));
el("s-language").addEventListener("change", (event) => setLanguage(event.target.value));

/* ------------------------------------------------- endpoints / models / memory */

el("q-profile").addEventListener("change", async (event) => {
  if (await useProfile(event.target.value)) {
    showNotice(t("notice.profileSwitched", event.target.value));
  }
});

el("q-model").addEventListener("change", (event) => switchModel(event.target.value));

/* ------------------------------------------------- chat toolbar + folders */

el("chat-profile").addEventListener("change", async (event) => {
  if (await useProfile(event.target.value)) {
    showNotice(t("notice.profileSwitched", event.target.value));
  }
});

el("chat-model").addEventListener("change", (event) => {
  const option = event.target.selectedOptions[0];
  switchModel(event.target.value, option?.dataset.profile || "");
});

el("chat-refresh").addEventListener("click", () => loadModels());
el("chat-workdir").addEventListener("change", (event) => useWorkdir(event.target.value));
el("chat-browse").addEventListener("click", () => openDirPicker());

el("dir-close").addEventListener("click", () => el("dirDialog").close());
el("dir-up").addEventListener("click", () => showDir(el("dirDialog").dataset.parent || ""));
el("dir-drives").addEventListener("click", () => showDir(""));
el("dir-go").addEventListener("click", () => showDir(el("dir-path").value.trim()));
el("dir-path").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    showDir(el("dir-path").value.trim());
  }
});
el("dir-use").addEventListener("click", async () => {
  if (!dirPath) return;
  el("dirDialog").close();
  await useWorkdir(dirPath);
});

/* ------------------------------------------------------------------- MCP */

el("s-mcpEnabled").addEventListener("change", async () => {
  const enabled = el("s-mcpEnabled").checked;
  const result = await api("/api/settings", "POST", { mcpEnabled: enabled });
  if (result.mcp) state.mcp = result.mcp;
  if (result.notices?.length) showNotice(result.notices.join("; "), 8000);
  await refreshState();
});

el("s-syncLocalModels").addEventListener("change", async () => {
  const result = await api("/api/settings", "POST", {
    syncLocalModels: el("s-syncLocalModels").checked,
  });
  if (result.settings) state.settings = result.settings;
  if (el("s-syncLocalModels").checked) loadModels(el("s-msg"));
});

el("m-refresh").addEventListener("click", () => mcpAction({ action: "refresh" }));

el("m-add").addEventListener("click", async () => {
  const id = el("m-id").value.trim();
  const target = el("m-target").value.trim();
  const message = el("m-msg");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    setText(message, `${t("error.prefix")}${t("settings.mcpId")}`);
    return;
  }
  if (!target) {
    setText(message, `${t("error.prefix")}${t("settings.mcpCommand")}`);
    return;
  }
  const http = el("m-http").checked;
  const parts = http ? [] : splitCommandLine(target);
  const result = await mcpAction({
    action: "add",
    id,
    server: {
      id,
      name: id,
      transport: http ? "http" : "stdio",
      command: parts[0] ?? "",
      args: parts.slice(1),
      url: http ? target : "",
      env: {},
      enabled: true,
      autoApprove: el("m-auto").checked,
    },
  });
  if (result) {
    el("m-id").value = "";
    el("m-target").value = "";
    showNotice(t("notice.mcpAdded", id));
  }
});

el("s-profile").addEventListener("change", (event) => useProfile(event.target.value, el("p-msg")));

el("s-modelPick").addEventListener("change", (event) => {
  el("s-model").value = event.target.value;
  switchModel(event.target.value);
});

el("p-models").addEventListener("click", () => loadModels(el("p-msg")));

/** Ask the server to probe the endpoint and show the report. */
el("p-diagnose").addEventListener("click", async () => {
  const out = el("diag-out");
  out.hidden = false;
  setText(out, t("settings.diagnosing"));
  setText(el("diag-msg"), t("settings.diagnoseHint"));
  const result = await api("/api/diagnose", "POST", {});
  if (result.error) {
    setText(out, `${t("error.prefix")}${result.error}`);
    return;
  }
  setText(out, result.text ?? JSON.stringify(result, null, 2));
  setText(el("diag-msg"), String(result.verdict ?? ""));
  await refreshState();
});

el("p-new").addEventListener("click", async () => {
  const id = el("s-newProfileId").value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    setText(el("p-msg"), `${t("error.prefix")}${t("notice.profileIdInvalid")}`);
    return;
  }
  const result = await api("/api/profiles", "POST", {
    action: "create",
    id,
    kind: el("s-newProfileApi").checked ? "api" : "local",
    baseUrl: el("s-baseUrl").value.trim(),
    apiKey: el("s-apiKey").value,
    model: el("s-model").value.trim(),
  });
  if (result.error) {
    setText(el("p-msg"), `${t("error.prefix")}${result.error}`);
    return;
  }
  el("s-newProfileId").value = "";
  el("s-apiKey").value = "";
  await useProfile(id, el("p-msg"));
});

el("p-remove").addEventListener("click", async () => {
  const id = el("s-profile").value;
  if (!id) return;
  const result = await api("/api/profiles", "POST", { action: "remove", id });
  if (result.error) {
    setText(el("p-msg"), `${t("error.prefix")}${result.error}`);
    return;
  }
  state.settings = result.settings;
  applySettingsToUi(result.settings);
  setText(el("p-msg"), t("settings.removedProfile", id));
});

el("s-remember").addEventListener("change", async () => {
  const result = await api("/api/settings", "POST", { remember: el("s-remember").checked });
  if (result.settings) {
    state.settings = result.settings;
    renderMemory(result.settings, state.memory);
  }
});

// The audit switch takes effect at once: while it is off nothing is recorded, and
// the undo stack is empty.
el("s-auditLog").addEventListener("change", async () => {
  const result = await api("/api/settings", "POST", { auditLog: el("s-auditLog").checked });
  if (result.settings) state.settings = result.settings;
  await refreshAudit();
});

/** Ask for a rollback and say what happened in the panel. */
async function requestUndo(body, button) {
  if (button) button.disabled = true;
  setText(el("a-msg"), "…");
  const result = await api("/api/undo", "POST", body);
  if (result.error) {
    setText(el("a-msg"), `${t("error.prefix")}${result.error}`);
  } else {
    const text = result.undone?.length
      ? t("settings.auditDone", result.undone.length)
      : t("settings.auditNothing");
    setText(el("a-msg"), result.failures?.length ? `${text} — ${result.failures.join("; ")}` : text);
  }
  await refreshAudit();
}

el("a-undo").addEventListener("click", () => requestUndo({ count: 1 }, el("a-undo")));

el("dryRun").addEventListener("change", () =>
  api("/api/settings", "POST", { dryRun: el("dryRun").checked }),
);
el("autoApprove").addEventListener("change", () =>
  api("/api/settings", "POST", { autoApprove: el("autoApprove").checked }),
);
// The sandbox changes how the shell is treated (an unfenced script vs. one that is
// read first), so the tool chips have to be redrawn, not just the switch flipped.
el("sandbox").addEventListener("change", async () => {
  const result = await api("/api/settings", "POST", { sandbox: el("sandbox").checked });
  if (!result.error) await refreshState();
});

// The mode switch explains itself immediately; "Save settings" persists it.
el("s-guided").addEventListener("change", renderModeState);

// The detail slider lives in the chat toolbar as well as in Settings. Both apply
// at once - it is a view setting, and the toolbar is where you reach for it.
for (const id of ["chat-verbosity", "s-verbosity"]) {
  el(id).addEventListener("input", (event) => renderVerbosityState(Number(event.target.value)));
  el(id).addEventListener("change", (event) => setVerbosity(Number(event.target.value)));
}

el("c-add").addEventListener("click", () => {
  const name = el("c-name").value.trim();
  const description = el("c-desc").value.trim() || `Custom command ${name}`;
  const script = el("c-script").value.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || !script) {
    showNotice(t("notice.customInvalid"));
    return;
  }
  customTools = customTools.filter((c) => c.name !== name);
  customTools.push({ name, description, script });
  el("c-name").value = "";
  el("c-desc").value = "";
  el("c-script").value = "";
  renderCustomTools();
});

el("k-save").addEventListener("click", saveSkillUi);
el("k-new").addEventListener("click", clearSkillForm);

el("s-save").addEventListener("click", saveSettings);
el("s-reload").addEventListener("click", async () => {
  const result = await api("/api/settings/reload", "POST");
  if (result.settings) applySettingsToUi(result.settings);
  setText(el("s-msg"), t("settings.reloaded"));
  refreshState();
});
el("s-resetChat").addEventListener("click", async () => {
  const result = await api("/api/reset", "POST");
  if (result.error) {
    setText(el("s-msg"), `${t("error.prefix")}${result.error}`);
    return;
  }
  clearLog();
  showNotice(t("settings.cleared"));
  await Promise.all([loadData(), refreshState()]);
});

el("d-open").addEventListener("click", async () => {
  const dir = state.data?.dir;
  if (!dir) return;
  await runTerminalLine(`/open ${dir}`);
  showNotice(t("settings.dataOpened", dir));
});

document.querySelectorAll(".example").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.textContent;
    switchTab("chat");
    input.focus();
  });
});

(async () => {
  const data = await api("/api/state");
  state.settings = data.settings;
  state.allTools = data.allTools ?? [];
  state.withheld = data.withheld ?? [];
  state.memory = data.memory ?? null;
  state.usage = data.usage ?? null;
  state.conversation = data.conversation ?? null;
  lang = data.settings.language ?? "en";
  el("language").value = lang;
  el("s-language").value = lang;
  applyLanguage();

  await refreshState();

  const info = await api("/api/settings");
  settingsFilePath = info.file ?? "";
  if (settingsFilePath) setText(el("settingsFile"), t("settings.savedFile", settingsFilePath));
  fillSettingsForm(info.settings ?? state.settings);

  renderHistory(data.history, data.usage?.calls ?? []);
  await loadData();
  termLine(t("terminal.welcome"), "term-sys");
  connect();
  // Fill the model picker with whatever the local servers can load.
  loadModels();
})();
