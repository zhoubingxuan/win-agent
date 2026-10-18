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
    "settings.temperature": "Temperature",
    "settings.language": "Language",
    "settings.workdir": "Working directory",
    "settings.powershell": "PowerShell binary",
    "settings.webPort": "Web port",
    "settings.systemPrompt": "System prompt",
    "settings.openOnStart": "Open browser on start",
    "settings.stream": "Stream replies",
    "settings.webSearchUrl": "Web search page",
    "settings.enabledTools": "Enabled tools",
    "settings.enabledToolsHint": "Turn a tool off with its switch to hide it from the model. All on = all enabled.",
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
    "settings.temperature": "温度",
    "settings.language": "语言",
    "settings.workdir": "工作目录",
    "settings.powershell": "PowerShell 程序",
    "settings.webPort": "网页端口",
    "settings.systemPrompt": "系统提示词",
    "settings.openOnStart": "启动时打开浏览器",
    "settings.stream": "流式输出回复",
    "settings.webSearchUrl": "网页搜索地址",
    "settings.enabledTools": "启用的工具",
    "settings.enabledToolsHint": "关掉开关即可对模型隐藏该工具。全部打开 = 全部启用。",
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
  allTools: [],
  memory: null,
  conversation: null,
  usage: null,
  data: null,
  context: null,
  version: "",
};
let customTools = [];
let termHistory = [];
let termHistoryIndex = -1;
let settingsFilePath = "";

/** Usage of the LLM call that is being rendered right now, waiting for its last element. */
let pendingUsage = null;
let pendingUsageAnchor = null;
/** The assistant bubble text is currently being streamed into, if any. */
let streamBubble = null;
/** The "thinking…" line shown while a reasoning model works, if any. */
let thinkingEl = null;

/* ---------------------------------------------------------------- utilities */

function setText(node, text) {
  node.textContent = text;
}

function atBottom(node) {
  node.scrollTop = node.scrollHeight;
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
  if (role === "assistant") clearThinking();
  // A streamed reply already built this bubble: fill in the final text.
  if (role === "assistant" && streamBubble) {
    const div = streamBubble;
    streamBubble = null;
    div.classList.remove("streaming");
    setText(div, text);
    if (pendingUsage) pendingUsageAnchor = div;
    atBottom(log);
    return div;
  }
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  setText(div, text);
  log.appendChild(div);
  if (role === "assistant" && pendingUsage) pendingUsageAnchor = div;
  atBottom(log);
  return div;
}

/** A live token from the model: grow the streaming bubble (or start one). */
function addDelta(text) {
  clearEmpty();
  clearThinking();
  if (!streamBubble) {
    const div = document.createElement("div");
    div.className = "bubble assistant streaming";
    log.appendChild(div);
    streamBubble = div;
  }
  streamBubble.textContent += text;
  if (pendingUsage) pendingUsageAnchor = streamBubble;
  atBottom(log);
}

/** Stop waiting for more tokens (the turn ended early). */
function closeStream(stopped = false) {
  if (!streamBubble) return;
  streamBubble.classList.remove("streaming");
  if (stopped) streamBubble.classList.add("stopped");
  streamBubble = null;
}

/** One dimmed line showing that a reasoning model is still working. */
function showThinking(chars) {
  clearEmpty();
  if (!thinkingEl) {
    thinkingEl = document.createElement("div");
    thinkingEl.className = "thinking";
    log.appendChild(thinkingEl);
  }
  setText(thinkingEl, t("chat.thinking", fmtInt(chars)));
  atBottom(log);
}

function clearThinking() {
  if (!thinkingEl) return;
  thinkingEl.remove();
  thinkingEl = null;
}

function addStep(step, max) {
  clearEmpty();
  const div = document.createElement("div");
  div.className = "step";
  setText(div, t("step.label", step, max));
  log.appendChild(div);
  atBottom(log);
}

function addToolCall(name, args) {
  clearEmpty();
  clearThinking();
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
  atBottom(log);
  return card;
}

function addToolResult(name, result) {
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
  atBottom(log);
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
  atBottom(log);
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
  atBottom(log);
}

/** A new LLM call started: park its usage until the reply has been drawn. */
function setUsage(u) {
  flushUsage();
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
}

/* --------------------------------------------------------------- SSE events */

function handle(ev) {
  switch (ev.type) {
    case "user":
      addBubble("user", ev.text);
      break;
    case "assistant":
      addBubble("assistant", ev.text);
      break;
    case "delta":
      addDelta(ev.text);
      break;
    case "thinking":
      showThinking(ev.chars);
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
      clearThinking();
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
      clearThinking();
      setRunning(false);
      showNotice(t("notice.stopped"));
      break;
    case "error":
      flushUsage();
      closeStream(true);
      clearThinking();
      setRunning(false);
      addBubble("error", `${t("error.prefix")}${ev.message}`);
      break;
    case "status":
      setRunning(ev.running);
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
  atBottom(el("term"));
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
  await refreshState();
  if (result.error) {
    if (messageEl) setText(messageEl, `${t("error.prefix")}${result.error}`);
    return;
  }
  if (messageEl) setText(messageEl, t("notice.modelsLoaded", result.models.length, result.baseUrl));
}

/** Instantly switch the model of the active endpoint. */
async function switchModel(name) {
  if (!name) return;
  const result = await api("/api/settings", "POST", { model: name });
  if (result.error) {
    showNotice(`${t("error.prefix")}${result.error}`);
    return;
  }
  if (result.settings) {
    state.settings = result.settings;
    applySettingsToUi(result.settings);
  }
}

/* ---------------------------------------------------------------- settings */

function applySettingsToUi(s) {
  if (!s) return;
  state.settings = s;
  renderRuntime(s);
  el("dryRun").checked = s.dryRun;
  el("autoApprove").checked = s.autoApprove;

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
  el("s-maxSteps").value = s.maxSteps ?? 12;
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
  el("s-autoOpenBrowser").checked = !!s.autoOpenBrowser;
  el("s-stream").checked = s.stream !== false;
  el("s-remember").checked = !!s.remember;
  customTools = (s.customTools ?? []).map((c) => ({ ...c }));
  renderCustomTools();
  renderToolChecks(s.enabledTools);
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
    autoOpenBrowser: el("s-autoOpenBrowser").checked,
    stream: el("s-stream").checked,
    remember: el("s-remember").checked,
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
  setText(el("cwd"), data.cwd);
  el("termPrompt").textContent = `PS ${data.cwd}>`;
  el("dryRun").checked = data.settings.dryRun;
  el("autoApprove").checked = data.settings.autoApprove;
  state.settings = data.settings;
  state.version = data.version ?? state.version;
  setText(el("version"), state.version ? `v${state.version}` : "");
  renderRuntime(data.settings);
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

  for (const text of data.notices ?? []) showNotice(text, 8000);
}

/** Empty the chat view (starting or loading a conversation). */
function clearLog() {
  log.innerHTML = "";
  openTools = [];
  pendingUsage = null;
  pendingUsageAnchor = null;
  streamBubble = null;
  thinkingEl = null;
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
    kind: el("s-newProfileKind").value,
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

el("dryRun").addEventListener("change", () =>
  api("/api/settings", "POST", { dryRun: el("dryRun").checked }),
);
el("autoApprove").addEventListener("change", () =>
  api("/api/settings", "POST", { autoApprove: el("autoApprove").checked }),
);

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
})();
