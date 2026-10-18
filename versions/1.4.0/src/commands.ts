import {
  DEFAULTS,
  activeProfile,
  findProfile,
  getSettings,
  loadSettings,
  normalizeAgentMode,
  normalizeLanguage,
  publicSettings,
  removeProfile,
  saveSettings,
  settingsFile,
  updateSettings,
  upsertProfile,
  type Language,
  type Profile,
  type Settings,
} from "./settings.js";
import { powerShellInfo, psQuote } from "./util/ps.js";
import type { AuditEntry } from "./audit.js";
import { VERSION } from "./version.js";
import { MCP_SERVER_ID, mcp, safeName, upsertServer, type McpServer } from "./mcp.js";
import type { ContextStats } from "./context.js";
import type {
  ConversationSummary,
  CumulativeUsage,
  DataInfo,
  UsageTotals,
} from "./store.js";

/** Context budget report for the open conversation. */
export interface ContextReport {
  stats: ContextStats;
  /** Where the window came from: an explicit setting, the endpoint, or nowhere. */
  source: "settings" | "model" | "unknown";  messages: number;
}

/** What the audit log looks like from the outside (see src/audit.ts). */
export interface AuditReport {
  enabled: boolean;
  file: string;
  /** Set when the log file could not be written. */
  problem: string | null;
  /** Newest first. */
  entries: AuditEntry[];
  /** The changes /undo would reverse, newest first. */
  pending: AuditEntry[];
}

export interface UndoReport {
  ok: boolean;
  undone: AuditEntry[];
  failures: string[];
  message: string;
}

export interface CommandHost {
  /** Wipe the chat conversation (in memory and on disk). */
  resetHistory(): void;
  /** Tool names that are offered to the model right now. */
  toolNames(): string[];
  /** Tools that exist but are not offered right now (guided mode hides the shell). */
  withheld(): Array<{ name: string; reason: string }>;
  /** The audit log: recent records and what /undo can reverse. */
  audit(limit?: number): AuditReport;
  /** Reverse the newest `count` reversible changes. */
  undo(count: number): Promise<UndoReport>;
  /** Apply side effects after settings change (chdir, powershell). Returns notices. */
  applySettings(): string[];
  /** Rebind the web server to a new port. */
  restart(port: number): Promise<string>;
  /** Terminal working directory. */
  cwd(): string;
  setCwd(target: string): string;
  /** Ask a profile's endpoint which models it serves. */
  listModels(id?: string): Promise<{ profile: string; baseUrl: string; models: string[]; error?: string }>;
  /** 记忆化 / memory: where the conversation is stored and how big it is. */
  memoryInfo(): { file: string; entries: number; bytes: number };
  /** Token usage of the open conversation plus the all-time totals. */
  usage(): UsageSnapshot;
  /** Archived conversations, newest first. */
  conversations(): ConversationSummary[];
  /** Where the data folder lives. */
  dataInfo(): DataInfo;
  /** Stop the turn that is running (the Stop button). Returns false if idle. */
  abort(): boolean;
  /** How full the model's context window is right now. */
  context(): ContextReport;
  /** Probe the endpoint and report what works. */
  diagnose(): Promise<string>;
  /** Compatibility notes learned about the active endpoint (may be empty). */
  capabilities(): string[];
}

/** Mirrors the shape built by the web server. */
export interface UsageSnapshot {
  conversation: UsageTotals & {
    id: string;
    startedAt: string;
    tokensPerSecond: number | null;
    cacheHitRate: number | null;
  };
  allTime: CumulativeUsage;
}

/* -------------------------------------------------------------------------- */
/* Localised messages                                                         */
/* -------------------------------------------------------------------------- */

interface Messages {
  help: string;
  noChange: string;
  updated: string;
  unknownSetting: string;
  unknownTool: string;
  unknownCommand: string;
  unknownSub: string;
  missingArg: string;
  usageEnable: string;
  usageCustomRemove: string;
  usageCustomAdd: string;
  languageInvalid: string;
  invalidPort: string;
  noCustom: string;
  opened: string;
  chatCleared: string;
  reloaded: string;
  savedTo: string;
  agentAt: string;
  statusSet: string;
  statusEmpty: string;
  statusTools: string;
  customDescription: string;
  languageCurrent: string;
  fileLabel: string;
  profileListHeader: string;
  profileSwitched: string;
  profileSaved: string;
  profileCreated: string;
  profileRemoved: string;
  profileUnknown: string;
  profileUsage: string;
  modelsHeader: string;
  modelsEmpty: string;
  memoryState: string;
  usageHeader: string;
  usageTotals: string;
  usageSpeed: string;
  usageAllTime: string;
  usageEmpty: string;
  usageUnreported: string;
  conversationsHeader: string;
  conversationsEmpty: string;
  conversationLine: string;
  dataHeader: string;
  dataLine: string;
  stopIdle: string;
  stopRequested: string;
  contextHeader: string;
  contextLine: string;
  contextUnknownLimit: string;
  contextSource: string;
  sourceSettings: string;
  sourceModel: string;
  modeGuided: string;
  modeNormal: string;
  modeInvalid: string;
  adminYes: string;
  adminNo: string;
  adminUnknown: string;
  englishErrors: string;
  onWord: string;
  offWord: string;
  contextTrimmed: string;
  diagnoseHeader: string;
  capabilityHeader: string;
  capabilityEmpty: string;
  versionLine: string;
  mcpHeader: string;
  mcpEmpty: string;
  mcpStateOn: string;
  mcpStateOff: string;
  mcpStateDead: string;
  mcpUsage: string;
  mcpAddUsage: string;
  mcpIdInvalid: string;
  mcpUnknown: string;
  mcpEnableUsage: string;
  mcpRemoveUsage: string;
  mcpToolsHeader: string;
  mcpNoTools: string;
  auditHeader: string;
  auditEmpty: string;
  auditOff: string;
  auditLine: string;
  auditUndoable: string;
  auditUndone: string;
  undoNothing: string;
  undoListHeader: string;
  undoHeader: string;
  undoLine: string;
  undoFailed: string;
  undoUsage: string;
  toolsWithheld: string;
}

/** Every message the terminal prints, per language. Exported so the i18n test can
 *  check that the two dictionaries stay in lockstep. */
export const MESSAGES: Record<Language, Messages> = {
  en: {
    help: `Internal commands — everything here can also be changed from the Settings tab.

Inspect:
  /help  /?                  this help
  /status                    model, endpoint, tools, flags
  /config [key]              show all settings, or a single key
  /get <key>                 read one setting
  /tools                     list tools and whether they are enabled
  /custom list               list custom commands
  /whoami                    where the settings file lives
  /public                    the settings the UI receives (API key masked)
  /context                   how full the model's context window is
  /diagnose                  test the endpoint: chat, tools, streaming, usage
  /caps                      what this endpoint does not support
  /version                   which win-agent version this is
  /audit [n]                 the last n changes (default 15), newest first
  /undo [list|n]             reverse the last change (or n of them) — list what can be

Change (saved to disk and applied immediately):
  /set <key> <value>         change any setting, e.g. /set maxSteps 20
  /unset <key>               restore a setting's default value
  /model <name>              which model to use
  /baseurl <url>             API endpoint
  /apikey <key>              API key
  /language <en|zh>          interface + reply language
  /maxsteps <n>              tool-calling rounds per turn
  /temperature <n>           sampling temperature (0-2)
  /prompt <text>             system prompt
  /workdir <path>            working directory
  /powershell <exe>          powershell.exe or pwsh.exe
  /mode <guided|normal>      supervision level (guided = one tool per step)
  /enable <name...>          enable tools  ( /enable all )
  /disable <name...>         disable tools
  /custom add <name> <ps>    add a custom command (one-line PowerShell)
  /custom remove <name>      remove a custom command
  /dry-run <on|off>          describe actions instead of doing them
  /auto-approve <on|off>     skip approval prompts
  /stream <on|off>           stream the reply token by token
  /set contextLimit <n>      context window to budget against (0 = ask the endpoint)
  /set requestTimeoutMs <n>  how long one request may take before it is abandoned
  /set maxRetries <n>        retries for 429 / 5xx / network errors
  /port <n>                  move the web UI to another port (rebinds)

Endpoints (local server vs. cloud API) and memory:
  /profile                   list endpoints and which one is active
  /profile use <id>          switch endpoint (local server <-> cloud API)
  /profile set <id> <k> <v>  change a field: name|kind|baseUrl|apiKey|model
  /profile new <id> <kind> <baseUrl> [model]   add an endpoint
  /profile remove <id>       delete an endpoint
  /models [id]               ask an endpoint which models it serves
  /memory [on|off|info|clear] remember the conversation across restarts
  /usage                     tokens, speed and cache for this conversation
  /conversations             list the archived conversations
  /data                      where data/ lives on disk

MCP servers (Model Context Protocol - tools from other programs):
  /mcp                       master switch, servers, connections, tool counts
  /mcp on | off              master switch (nothing is started while it is off)
  /mcp refresh               reconnect and re-read the tool lists
  /mcp tools                 every MCP tool the model can call
  /mcp add <id> stdio <cmd> [args...]    e.g. npx -y @modelcontextprotocol/server-filesystem D:\\
  /mcp add <id> http <url>               a remote / proxied MCP endpoint
  /mcp enable | disable <id> switch one server
  /mcp remove <id>           forget a server

Other:
  /stop                      stop the task that is running
  /open <path>               open a file or folder in Explorer
  /exec <command>            force a raw shell command
  /reset                     archive this conversation and start a new one
  /reload                    reload settings from disk
  /save                      write settings to disk now

Anything not starting with "/" runs as a PowerShell command in the terminal's
current directory.`,
    noChange: "(no change)",
    updated: "updated: {0}",
    unknownSetting: 'unknown setting "{0}"',
    unknownTool: 'unknown tool "{0}"',
    unknownCommand: 'unknown command "/{0}". Try /help',
    unknownSub: 'unknown /custom subcommand "{0}"',
    missingArg: "missing argument. Example: {0}",
    usageEnable: "usage: /{0} <tool> [tool...]",
    usageCustomRemove: "usage: /custom remove <name>",
    usageCustomAdd: "usage: /custom add <name> <powershell script>",
    languageInvalid: 'language must be "en" or "zh"',
    invalidPort: "invalid port",
    noCustom: "(no custom commands)",
    opened: "opened {0}",
    chatCleared: "conversation archived — started a new one",
    reloaded: "settings reloaded from disk",
    savedTo: "saved to {0}",
    agentAt: "settings file: {0}",
    statusSet: "set",
    statusEmpty: "(empty)",
    statusTools: "{0}/{1} enabled",
    customDescription: "Custom command {0}",
    languageCurrent: "language = {0}  (en | zh)",
    fileLabel: "file: {0}",
    profileListHeader: "endpoints (active = *):",
    profileSwitched: 'switched to profile "{0}"  ({1})',
    profileSaved: 'profile "{0}" saved',
    profileCreated: 'profile "{0}" created',
    profileRemoved: 'profile "{0}" removed',
    profileUnknown: 'unknown profile "{0}". Try /profile',
    profileUsage: `usage:
  /profile
  /profile use <id>
  /profile set <id> <name|kind|baseUrl|apiKey|model> <value>
  /profile new <id> <local|api> <baseUrl> [model]
  /profile remove <id>`,
    modelsHeader: "models offered by {0}  ({1}):",
    modelsEmpty: "(the endpoint listed no models - check /profile and the URL)",
    memoryState: "memory = {0}  ({1} messages, {2} bytes)\nfile: {3}",
    usageHeader: "token usage — conversation {0}  (started {1})",
    usageTotals: "  calls {0} · input {1} · output {2} · total {3} tokens",
    usageSpeed: "  avg output {0} tok/s · {1}s of LLM time · cache {2}",
    usageAllTime: "all time ({0} conversations): {1} calls · input {2} · output {3} · total {4}",
    usageEmpty: "(no LLM calls in this conversation yet)",
    usageUnreported: "not reported",
    conversationsHeader: "archived conversations ({0}) in {1}:",
    conversationsEmpty: "(nothing archived yet - /reset files the current conversation away)",
    conversationLine: "  {0}   {1} messages   {2} tokens",
    dataHeader: "data folder: {0}",
    dataLine: "  {0}: {1}",
    stopIdle: "nothing is running right now",
    stopRequested: "stopping the current task…",
    contextHeader: "context — model {0}",
    contextLine: "  used {0} / {1} tokens ({2}%) · {3} messages in the conversation",
    contextUnknownLimit: "unknown — the endpoint did not report one, set it with /set contextLimit <tokens>",
    contextSource: "  window {0} tokens, from {1}",
    sourceSettings: "the settings",
    sourceModel: "the endpoint",
    modeGuided: "guided (one tool call per step, explicit procedure)",
    modeNormal: "normal (plain prompt)",
    modeInvalid: 'mode must be "guided" or "normal"',
    adminYes: "yes",
    adminNo: "no — service, firewall and machine-wide changes will be refused",
    adminUnknown: "unknown",
    englishErrors: "PowerShell error language",
    onWord: "on",
    offWord: "off",
    contextTrimmed: "  trimmed for the model: {0} old exchange(s) dropped, {1} tool result(s) shortened (the stored conversation is untouched)",
    diagnoseHeader: "endpoint diagnosis for {0} ({1}):",
    capabilityHeader: "endpoint compatibility:",
    capabilityEmpty: "no compatibility problems seen with this endpoint",
    versionLine: "win-agent {0}",
    mcpHeader: "MCP master switch: {0} ({1} server(s) configured)",
    mcpEmpty: "(no MCP servers - /mcp add <id> stdio <command> [args...])",
    mcpStateOn: "connected, {0} tool(s)",
    mcpStateOff: "off",
    mcpStateDead: "not connected",
    mcpUsage: `usage:
  /mcp                 status
  /mcp on | off        master switch
  /mcp refresh         reconnect and re-read the tool lists
  /mcp tools           every MCP tool
  /mcp add <id> stdio <command> [args...]
  /mcp add <id> http <url>
  /mcp enable | disable <id>
  /mcp remove <id>`,
    mcpAddUsage: "usage: /mcp add <id> <stdio <command> [args...] | http <url>>",
    mcpIdInvalid: "server id must be letters, digits, - or _ (max 32)",
    mcpUnknown: 'no MCP server "{0}". Try /mcp',
    mcpEnableUsage: "usage: /mcp {0} <id>",
    mcpRemoveUsage: "usage: /mcp remove <id>",
    mcpToolsHeader: "MCP tools the model can call ({0}):",
    mcpNoTools: "(no MCP tools - switch MCP on and refresh)",
    auditHeader: "audit log — {0} record(s), newest first ({1})",
    auditEmpty: "(nothing has been changed yet)",
    auditOff: "the audit log is switched off - turn on \"audit log\" in the Settings tab to record changes",
    auditLine: "{0}. {1}  {2} {3}: {4}",
    auditUndoable: "undoable",
    auditUndone: "undone",
    undoNothing: "nothing to undo (a restart clears the undo stack; the audit log keeps the record)",
    undoListHeader: "can be undone, newest first:",
    undoHeader: "undid {0} change(s):",
    undoLine: "- {0} {1}: {2}",
    undoFailed: "some steps could not be reversed: {0}",
    undoUsage: "usage: /undo [list|count]",
    toolsWithheld: "not offered: {0}",
  },
  zh: {
    help: `内部指令 —— 下面每一项在「设置」标签页里也能改。

查看：
  /help  /?                  显示本说明
  /status                    模型、接口、工具、开关
  /config [key]              显示全部设置，或某一项
  /get <key>                 读取一个设置
  /tools                     列出工具及是否启用
  /custom list               列出自定义命令
  /whoami                    显示设置文件位置
  /public                    网页拿到的设置（API 密钥已隐藏）
  /context                   查看模型上下文占用了多少
  /diagnose                  检测接口：对话、工具、流式、用量
  /caps                      这个接口不支持什么
  /version                   当前 win-agent 版本号
  /audit [n]                 最近 n 条改动记录（默认 15 条），新的在前
  /undo [list|n]             撤销最近 1 次（或 n 次）改动；list 列出可撤销的

修改（会写入磁盘并立即生效）：
  /set <key> <value>         修改任意设置，例如 /set maxSteps 20
  /unset <key>               把某项恢复为默认值
  /model <name>              使用哪个模型
  /baseurl <url>             接口地址
  /apikey <key>              API 密钥
  /language <en|zh>          界面与回复语言
  /maxsteps <n>              每轮最多工具调用步数
  /temperature <n>           采样温度（0-2）
  /prompt <text>             系统提示词
  /workdir <path>            工作目录
  /powershell <exe>          powershell.exe 或 pwsh.exe
  /mode <guided|normal>      监督等级（guided = 每步只调用一个工具）
  /enable <name...>          启用工具（ /enable all ）
  /disable <name...>         停用工具
  /custom add <name> <ps>    添加自定义命令（单行 PowerShell）
  /custom remove <name>      删除自定义命令
  /dry-run <on|off>          只报告不真正执行
  /auto-approve <on|off>     跳过审批提示
  /stream <on|off>           逐字流式输出回复
  /set contextLimit <n>      上下文窗口预算（0 = 询问接口）
  /set requestTimeoutMs <n>  单次请求最长等待时间，超时即放弃
  /set maxRetries <n>        429 / 5xx / 网络错误的重试次数
  /port <n>                  把网页切到另一个端口（会重新监听）

接口（本地服务 / 云端 API）与记忆：
  /profile                   列出所有接口，并标出当前使用的
  /profile use <id>          切换接口（本地服务 <-> 云端 API）
  /profile set <id> <项> <值>  改一项：name|kind|baseUrl|apiKey|model
  /profile new <id> <kind> <baseUrl> [model]   新增一个接口
  /profile remove <id>       删除一个接口
  /models [id]               询问接口提供哪些模型
  /memory [on|off|info|clear]   跨重启记住对话内容
  /usage                     本对话的 token、速度与缓存
  /conversations             列出已归档的对话
  /data                      数据文件夹在哪里

MCP 服务器（Model Context Protocol —— 用别的程序的工具）：
  /mcp                       总开关、服务器、连接状态、工具数量
  /mcp on | off              总开关（关闭时不会启动任何服务器）
  /mcp refresh               重新连接并重读工具列表
  /mcp tools                 列出模型可调用的全部 MCP 工具
  /mcp add <id> stdio <命令> [参数...]   例如 npx -y @modelcontextprotocol/server-filesystem D:\\
  /mcp add <id> http <网址>              远程或经代理的 MCP 接口
  /mcp enable | disable <id> 单独开关某个服务器
  /mcp remove <id>           删除一个服务器

其他：
  /stop                      停止正在运行的任务
  /open <path>               在资源管理器中打开文件或文件夹
  /exec <command>            强制执行一条 shell 命令
  /reset                     归档当前对话并开始新对话
  /reload                    从磁盘重新加载设置
  /save                      立即把设置写入磁盘

不以 "/" 开头的输入，会在终端当前目录下作为 PowerShell 命令执行。`,
    noChange: "（无变化）",
    updated: "已更新：{0}",
    unknownSetting: '未知设置项 "{0}"',
    unknownTool: '未知工具 "{0}"',
    unknownCommand: '未知指令 "/{0}"，试试 /help',
    unknownSub: '未知的 /custom 子命令 "{0}"',
    missingArg: "缺少参数。示例：{0}",
    usageEnable: "用法：/{0} <工具> [工具...]",
    usageCustomRemove: "用法：/custom remove <名称>",
    usageCustomAdd: "用法：/custom add <名称> <PowerShell 脚本>",
    languageInvalid: 'language 只能是 "en" 或 "zh"',
    invalidPort: "端口不合法",
    noCustom: "（没有自定义命令）",
    opened: "已打开 {0}",
    chatCleared: "对话已归档，并开始了新对话",
    reloaded: "已从磁盘重新加载设置",
    savedTo: "已保存到 {0}",
    agentAt: "设置文件：{0}",
    statusSet: "已设置",
    statusEmpty: "（空）",
    statusTools: "已启用 {0}/{1}",
    customDescription: "自定义命令 {0}",
    languageCurrent: "language = {0}  （en | zh）",
    fileLabel: "文件：{0}",
    profileListHeader: "接口列表（* = 当前使用）：",
    profileSwitched: '已切换到接口 "{0}"  （{1}）',
    profileSaved: '已保存接口 "{0}"',
    profileCreated: '已新增接口 "{0}"',
    profileRemoved: '已删除接口 "{0}"',
    profileUnknown: '未知接口 "{0}"，试试 /profile',
    profileUsage: `用法：
  /profile
  /profile use <id>
  /profile set <id> <name|kind|baseUrl|apiKey|model> <值>
  /profile new <id> <local|api> <baseUrl> [model]
  /profile remove <id>`,
    modelsHeader: "{0} 提供的模型  （{1}）：",
    modelsEmpty: "（接口没有返回模型列表，检查 /profile 和地址）",
    memoryState: "memory = {0}  （{1} 条消息，{2} 字节）\n文件：{3}",
    usageHeader: "用量 —— 对话 {0}（开始于 {1}）",
    usageTotals: "  调用 {0} 次 · 输入 {1} · 输出 {2} · 合计 {3} tokens",
    usageSpeed: "  平均输出 {0} tok/s · 模型耗时 {1} 秒 · 缓存 {2}",
    usageAllTime: "历史累计（{0} 个对话）：调用 {1} 次 · 输入 {2} · 输出 {3} · 合计 {4}",
    usageEmpty: "（本对话还没有调用过模型）",
    usageUnreported: "接口未提供",
    conversationsHeader: "已归档对话（{0} 个），目录 {1}：",
    conversationsEmpty: "（还没有归档的对话 —— /reset 会把当前对话存档）",
    conversationLine: "  {0}   {1} 条消息   {2} tokens",
    dataHeader: "数据文件夹：{0}",
    dataLine: "  {0}：{1}",
    stopIdle: "当前没有正在运行的任务",
    stopRequested: "正在停止当前任务…",
    contextHeader: "上下文 —— 模型 {0}",
    contextLine: "  已用 {0} / {1} tokens（{2}%）· 对话 {3} 条消息",
    contextUnknownLimit: "未知 —— 接口没有报告上下文长度，可用 /set contextLimit <tokens> 手动设置",
    contextSource: "  窗口 {0} tokens，来源：{1}",
    sourceSettings: "设置",
    sourceModel: "接口",
    modeGuided: "高监督（每步只调用一个工具，附操作规范）",
    modeNormal: "普通（原始提示词）",
    modeInvalid: '模式必须是 "guided" 或 "normal"',
    adminYes: "是",
    adminNo: "否 —— 服务、防火墙、系统级修改都会被拒绝",
    adminUnknown: "未知",
    englishErrors: "PowerShell 报错语言",
    onWord: "开",
    offWord: "关",
    contextTrimmed: "  为模型精简过：丢弃 {0} 段较早的对话，缩短 {1} 条工具结果（磁盘上的对话不受影响）",
    diagnoseHeader: "{0}（{1}）接口检测：",
    capabilityHeader: "接口兼容性：",
    capabilityEmpty: "这个接口没有发现兼容性问题",
    versionLine: "win-agent {0}",
    mcpHeader: "MCP 总开关：{0}（已配置 {1} 个服务器）",
    mcpEmpty: "（还没有 MCP 服务器 —— /mcp add <id> stdio <命令> [参数...]）",
    mcpStateOn: "已连接，{0} 个工具",
    mcpStateOff: "已关闭",
    mcpStateDead: "未连接",
    mcpUsage: `用法：
  /mcp                 状态
  /mcp on | off        总开关
  /mcp refresh         重新连接并重读工具列表
  /mcp tools           列出全部 MCP 工具
  /mcp add <id> stdio <命令> [参数...]
  /mcp add <id> http <网址>
  /mcp enable | disable <id>
  /mcp remove <id>`,
    mcpAddUsage: "用法：/mcp add <id> <stdio <命令> [参数...] | http <网址>>",
    mcpIdInvalid: "服务器 id 只能是字母、数字、- 或 _（最多 32 位）",
    mcpUnknown: "没有名为 “{0}” 的 MCP 服务器，试试 /mcp",
    mcpEnableUsage: "用法：/mcp {0} <id>",
    mcpRemoveUsage: "用法：/mcp remove <id>",
    mcpToolsHeader: "模型可以调用的 MCP 工具（共 {0} 个）：",
    mcpNoTools: "（没有 MCP 工具 —— 请打开 MCP 总开关并刷新）",
    auditHeader: "改动记录 —— 共 {0} 条，新的在前（{1}）",
    auditEmpty: "（还没有任何改动）",
    auditOff: "改动记录已关闭 —— 在「设置」里打开「改动记录」即可开始记录",
    auditLine: "{0}. {1}  {2} {3}：{4}",
    auditUndoable: "可撤销",
    auditUndone: "已撤销",
    undoNothing: "没有可撤销的改动（重启会清空撤销栈，改动记录仍保留）",
    undoListHeader: "可撤销的改动，新的在前：",
    undoHeader: "已撤销 {0} 次改动：",
    undoLine: "- {0} {1}：{2}",
    undoFailed: "部分步骤未能还原：{0}",
    undoUsage: "用法：/undo [list|次数]",
    toolsWithheld: "当前不提供：{0}",
  },
};

/** The message table for the currently selected language. */
function m(): Messages {
  return MESSAGES[getSettings().language] ?? MESSAGES.en;
}

function format(template: string, ...values: Array<string | number>): string {
  return values.reduce<string>(
    (text, value, index) => text.replaceAll(`{${index}}`, String(value)),
    template,
  );
}

/** 1234567 -> "1,234,567" */
function tokens(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Milliseconds to one decimal place of seconds. */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function fmt(value: unknown): string {
  if (value === null) return "all";
  if (typeof value === "string") return value.includes("\n") ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "null" || trimmed === "all") return null;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/^"(.*)"$/, "$1");
}

function requireArg(rest: string, example: string): string {
  const value = rest.trim();
  if (!value) throw new Error(format(m().missingArg, example));
  return value;
}

function assertSetting(key: string): asserts key is keyof Settings {
  if (!(key in DEFAULTS)) throw new Error(format(m().unknownSetting, key));
}

async function setKeys(host: CommandHost, patch: Record<string, unknown>): Promise<string> {
  const { changed } = updateSettings(patch);
  saveSettings();
  const notices = host.applySettings();
  const lines: string[] = [
    changed.length === 0 ? m().noChange : format(m().updated, changed.join(", ")),
  ];
  lines.push(...notices);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                 */
/* -------------------------------------------------------------------------- */

/** Execute an internal "/command". Throws on unknown command. */
export async function runCommand(line: string, host: CommandHost): Promise<string> {
  const trimmed = line.trim().replace(/^\//, "");
  const space = trimmed.indexOf(" ");
  const name = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space < 0 ? "" : trimmed.slice(space + 1);

  switch (name) {
    case "help":
    case "?":
      return m().help;

    case "status": {
      const s = getSettings();
      const all = host.toolNames();
      const enabled = s.enabledTools ?? all;
      const context = host.context();
      const window = context.stats.limit
        ? `${context.stats.limit} tokens (${context.source})`
        : m().contextUnknownLimit;
      const info = await powerShellInfo();
      const admin =
        info.elevated === true ? m().adminYes : info.elevated === false ? m().adminNo : m().adminUnknown;
      const withheld = host.withheld();
      return [
        `version    : ${VERSION}`,
        `model      : ${s.model}`,
        `profile    : ${s.activeProfile}  (${s.profiles.length} configured)`,
        `endpoint   : ${s.baseUrl}`,
        `apiKey     : ${s.apiKey ? m().statusSet : m().statusEmpty}`,
        `maxSteps   : ${s.maxSteps}`,
        `temperature: ${s.temperature}`,
        `language   : ${s.language}`,
        `workdir    : ${s.workdir}`,
        `powershell : ${s.powershell}`,
        `shell      : ${info.exe}${info.version ? ` ${info.version}` : ""}${info.note ? `  (${info.note})` : ""}`,
        `admin      : ${admin}`,
        `psErrors   : ${s.psEnglishErrors ? m().onWord : m().offWord}`,
        `mode       : ${s.agentMode === "guided" ? m().modeGuided : m().modeNormal}`,
        `webPort    : ${s.webPort}`,
        `dryRun     : ${s.dryRun}`,
        `autoApprove: ${s.autoApprove}`,
        `stream     : ${s.stream}   retries: ${s.maxRetries}   timeout: ${s.requestTimeoutMs}ms`,
        `tools      : ${format(m().statusTools, enabled.length, all.length)}`,
        `customTools: ${s.customTools.length}`,
        `mcp        : ${s.mcpEnabled ? "on" : "off"}  (${s.mcpServers.length} server(s), ${mcp.status().reduce((n, x) => n + x.tools.length, 0)} tool(s))`,
        `syncLocals : ${s.syncLocalModels}`,
        `context    : ${window}`,
        `audit      : ${s.auditLog ? m().onWord : m().offWord}  (${host.audit(0).pending.length} change(s) can be undone)`,
        `withheld   : ${withheld.length === 0 ? "(none)" : withheld.map((w) => `${w.name} (${w.reason})`).join(", ")}`,
      ].join("\n");
    }

    case "version":
    case "about":
      return format(m().versionLine, VERSION);

    case "context":
    case "ctx": {
      const s = getSettings();
      const { stats, source, messages } = host.context();
      const lines: string[] = [format(m().contextHeader, s.model)];
      if (!stats.limit || !stats.budget) {
        lines.push(
          `  used ${tokens(stats.estimatedTokens)} tokens · ${messages} messages in the conversation`,
        );
        lines.push(`  ${m().contextUnknownLimit}`);
      } else {
        const percent = Math.round((stats.estimatedTokens / stats.limit) * 100);
        lines.push(format(m().contextLine, tokens(stats.estimatedTokens), tokens(stats.limit), percent, messages));
        lines.push(
          format(
            m().contextSource,
            tokens(stats.limit),
            source === "settings" ? m().sourceSettings : m().sourceModel,
          ),
        );
        if (stats.trimmed) {
          lines.push(format(m().contextTrimmed, stats.droppedMessages, stats.truncatedToolResults));
        }
      }
      return lines.join("\n");
    }

    case "caps":
    case "capabilities": {
      const notes = host.capabilities();
      if (notes.length === 0) return m().capabilityEmpty;
      return [m().capabilityHeader, ...notes.map((note) => `- ${note}`)].join("\n");
    }

    case "diagnose":
    case "doctor": {
      const s = getSettings();
      const report = await host.diagnose();
      return `${format(m().diagnoseHeader, s.model, s.baseUrl)}\n${report}`;
    }

    case "config": {
      const s = getSettings();
      if (rest.trim()) {
        const key = rest.trim();
        assertSetting(key);
        return `${key} = ${fmt(s[key])}`;
      }
      const lines = Object.keys(DEFAULTS).map((key) => `${key} = ${fmt(s[key as keyof Settings])}`);
      lines.push(`\n${format(m().fileLabel, settingsFile())}`);
      return lines.join("\n");
    }

    case "get": {
      const key = requireArg(rest, "/get maxSteps");
      assertSetting(key);
      return `${key} = ${fmt(getSettings()[key])}`;
    }

    case "set": {
      const value = requireArg(rest, "/set maxSteps 20");
      const sep = value.search(/\s/);
      const key = (sep < 0 ? value : value.slice(0, sep)).trim();
      const raw = sep < 0 ? "" : value.slice(sep + 1);
      assertSetting(key);
      return setKeys(host, { [key]: parseValue(raw) });
    }

    case "unset": {
      const key = requireArg(rest, "/unset model");
      assertSetting(key);
      return setKeys(host, { [key]: DEFAULTS[key] });
    }

    case "model":
      return setKeys(host, { model: requireArg(rest, "/model qwen2.5:7b") });
    case "language":
    case "lang": {
      const value = rest.trim();
      if (!value) return format(m().languageCurrent, getSettings().language);
      if (!/^(en|english|zh|cn|zh-cn|chinese|中文|简体中文|汉语)$/i.test(value)) {
        throw new Error(m().languageInvalid);
      }
      return setKeys(host, { language: normalizeLanguage(value) });
    }
    case "baseurl":
      return setKeys(host, { baseUrl: requireArg(rest, "/baseurl http://127.0.0.1:11434/v1") });
    case "apikey":
      return setKeys(host, { apiKey: rest.trim() });
    case "maxsteps":
      return setKeys(host, { maxSteps: parseValue(requireArg(rest, "/maxsteps 20")) });
    case "temperature":
    case "temp":
      return setKeys(host, { temperature: parseValue(requireArg(rest, "/temperature 0.2")) });
    case "prompt":
      return setKeys(host, { systemPrompt: rest });
    case "workdir":
      return setKeys(host, { workdir: requireArg(rest, "/workdir C:\\Users") });
    case "powershell":
    case "shell":
      return setKeys(host, { powershell: requireArg(rest, "/powershell pwsh.exe") });

    case "mode": {
      // High supervision for small local models vs. the plain prompt.
      const value = rest.trim().toLowerCase();
      if (!value) {
        return `mode = ${getSettings().agentMode}  (guided | normal)`;
      }
      if (!/^(guided|supervised|supervision|strict|normal|plain|standard)$/.test(value)) {
        throw new Error(m().modeInvalid);
      }
      return setKeys(host, { agentMode: normalizeAgentMode(value) });
    }

    case "tools": {
      const s = getSettings();
      const all = host.toolNames();
      const enabled = s.enabledTools ?? all;
      const lines = all.map((t) => `${enabled.includes(t) ? "[x]" : "[ ]"} ${t}`);
      const hidden = host.withheld().map((item) => `${item.name} (${item.reason})`);
      if (hidden.length > 0) lines.push(format(m().toolsWithheld, hidden.join("; ")));
      return lines.join("\n");
    }

    case "enable":
    case "disable": {
      const all = host.toolNames();
      const current = getSettings().enabledTools ?? all;
      let next = [...current];
      const names = rest.trim().toLowerCase() === "all" ? all : rest.split(/[\s,]+/).filter(Boolean);
      if (names.length === 0) throw new Error(format(m().usageEnable, name));

      if (name === "enable") {
        for (const tool of names) {
          if (!all.includes(tool)) throw new Error(format(m().unknownTool, tool));
          if (!next.includes(tool)) next.push(tool);
        }
      } else {
        next = next.filter((t) => !names.includes(t));
      }
      next = all.filter((t) => next.includes(t)); // keep canonical order
      const patch = next.length === all.length ? null : next;
      return setKeys(host, { enabledTools: patch });
    }

    case "custom": {
      const [sub, ...parts] = rest.trim().split(/\s+/);
      const s = getSettings();
      if (!sub || sub === "list") {
        return s.customTools.length === 0
          ? m().noCustom
          : s.customTools.map((c) => `- ${c.name}: ${c.description}`).join("\n");
      }
      if (sub === "remove" || sub === "rm") {
        const target = parts[0];
        if (!target) throw new Error(m().usageCustomRemove);
        return setKeys(host, {
          customTools: s.customTools.filter((c) => c.name !== target),
        });
      }
      if (sub === "add") {
        const toolName = parts[0];
        const body = rest.trim();
        const script = body.slice(body.indexOf(toolName) + toolName.length).trim();
        if (!toolName || !script) throw new Error(m().usageCustomAdd);
        const others = s.customTools.filter((c) => c.name !== toolName);
        return setKeys(host, {
          customTools: [
            ...others,
            { name: toolName, description: format(m().customDescription, toolName), script },
          ],
        });
      }
      throw new Error(format(m().unknownSub, sub));
    }

    case "dry-run":
    case "dryrun":
      return setKeys(host, { dryRun: parseValue(requireArg(rest, "/dry-run on")) });
    case "auto-approve":
    case "autoapprove":
      return setKeys(host, { autoApprove: parseValue(requireArg(rest, "/auto-approve on")) });
    case "stream":
      return setKeys(host, { stream: parseValue(requireArg(rest, "/stream on")) });

    case "profile":
    case "profiles": {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const [sub, ...args] = parts;
      const s = getSettings();

      if (!sub || sub === "list" || sub === "ls") {
        const rows = s.profiles.map(
          (p) =>
            `${p.id === s.activeProfile ? "*" : " "} ${p.id.padEnd(12)} ${p.kind.padEnd(5)} ${p.model.padEnd(22)} ${p.baseUrl}`,
        );
        return [m().profileListHeader, ...rows].join("\n");
      }

      if (sub === "use") {
        const id = args[0];
        if (!id) throw new Error(m().profileUsage);
        const target = findProfile(id);
        if (!target) throw new Error(format(m().profileUnknown, id));
        const output = await setKeys(host, { activeProfile: id });
        return `${format(m().profileSwitched, id, target.baseUrl)}\n${output}`;
      }

      if (sub === "new" || sub === "add") {
        const id = args[0];
        if (!id) throw new Error(m().profileUsage);
        // /profile new <id> [local|api] <baseUrl> [model]
        const hasKind = /^(local|api)$/i.test(args[1] ?? "");
        const kind = (hasKind ? args[1] : /127\.0\.0\.1|localhost/i.test(args[1] ?? "") ? "local" : "api").toLowerCase() as Profile["kind"];
        const baseUrl = (hasKind ? args[2] : args[1]) ?? "";
        const model = args.slice(hasKind ? 3 : 2).join(" ");
        if (!baseUrl) throw new Error(m().profileUsage);
        upsertProfile({
          id,
          name: id,
          kind,
          baseUrl: baseUrl.replace(/\/+$/, ""),
          apiKey: kind === "api" ? "" : "local",
          model: model || (kind === "api" ? "gpt-4o-mini" : "local-model"),
          models: [],
        });
        saveSettings();
        return [format(m().profileCreated, id), ...host.applySettings()].join("\n");
      }

      if (sub === "set") {
        const id = args[0];
        const field = args[1];
        const value = args.slice(2).join(" ");
        const allowed = ["name", "kind", "baseUrl", "apiKey", "model"];
        if (!id || !field || !allowed.includes(field)) throw new Error(m().profileUsage);
        const target = findProfile(id);
        if (!target) throw new Error(format(m().profileUnknown, id));
        const next: Profile = { ...target, models: [...target.models] };
        if (field === "kind") next.kind = value === "api" ? "api" : "local";
        else if (field === "baseUrl") next.baseUrl = value.replace(/\/+$/, "");
        else if (field === "name") next.name = value;
        else if (field === "apiKey") next.apiKey = value;
        else next.model = value;
        upsertProfile(next);
        saveSettings();
        return [format(m().profileSaved, id), ...host.applySettings()].join("\n");
      }

      if (sub === "remove" || sub === "rm" || sub === "delete") {
        const id = args[0];
        if (!id) throw new Error(m().profileUsage);
        removeProfile(id);
        saveSettings();
        return [format(m().profileRemoved, id), ...host.applySettings()].join("\n");
      }

      throw new Error(m().profileUsage);
    }

    case "models": {
      const result = await host.listModels(rest.trim() || undefined);
      if (result.error) {
        return `${result.error}\n${format(m().modelsHeader, result.profile, result.baseUrl)}`;
      }
      if (result.models.length === 0) return m().modelsEmpty;
      return [
        format(m().modelsHeader, result.profile, result.baseUrl),
        ...result.models.map((name) => `- ${name}`),
      ].join("\n");
    }

    case "mcp": {
      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const sub = (parts.shift() ?? "").toLowerCase();
      const servers = (): McpServer[] => getSettings().mcpServers;

      // A compact table: switch, transport, connection, tools, last error.
      const report = (): string => {
        const live = mcp.status();
        const lines = [format(m().mcpHeader, getSettings().mcpEnabled ? "on" : "off", servers().length)];
        if (servers().length === 0) {
          lines.push(m().mcpEmpty);
          return lines.join("\n");
        }
        for (const server of servers()) {
          const found = live.find((x) => x.id === server.id);
          const state = !server.enabled
            ? m().mcpStateOff
            : found?.connected
              ? format(m().mcpStateOn, found.tools.length)
              : m().mcpStateDead;
          const error = found?.error ? ` - ${found.error}` : "";
          lines.push(`  ${server.id.padEnd(14)} ${server.transport.padEnd(5)} ${state}${error}`);
        }
        return lines.join("\n");
      };

      if (!sub || sub === "list" || sub === "status") return report();

      if (sub === "on" || sub === "off") {
        const on = sub === "on";
        const out = await setKeys(host, { mcpEnabled: on });
        if (on) await mcp.refresh();
        else mcp.close();
        return `${out}\n${report()}`;
      }

      if (sub === "refresh" || sub === "reload") {
        await mcp.refresh();
        return report();
      }

      if (sub === "tools") {
        // The names the model actually calls, not the server's own names.
        const names = mcp
          .status()
          .flatMap((server) => server.tools.map((tool) => safeName(server.id, tool)));
        if (names.length === 0) return m().mcpNoTools;
        return [format(m().mcpToolsHeader, names.length), ...names.map((name) => `- ${name}`)].join("\n");
      }

      if (sub === "enable" || sub === "disable") {
        const id = parts[0];
        if (!id) throw new Error(format(m().mcpEnableUsage, sub));
        if (!servers().some((x) => x.id === id)) throw new Error(format(m().mcpUnknown, id));
        const out = await setKeys(host, {
          mcpServers: servers().map((server) =>
            server.id === id ? { ...server, enabled: sub === "enable" } : server,
          ),
        });
        mcp.drop(id);
        await mcp.refresh();
        return `${out}\n${report()}`;
      }

      // /mcp add <id> stdio <command> [args...]   or   /mcp add <id> http <url>
      if (sub === "add") {
        const [id, transport, target, ...args] = parts;
        if (!id || !transport || !target) throw new Error(m().mcpAddUsage);
        if (!MCP_SERVER_ID.test(id)) throw new Error(m().mcpIdInvalid);
        const http = transport.toLowerCase() === "http";
        const next: McpServer = {
          id,
          name: id,
          transport: http ? "http" : "stdio",
          command: http ? "" : target,
          args: http ? [] : args,
          env: {},
          url: http ? target : "",
          enabled: true,
          autoApprove: false,
          tools: [],
        };
        mcp.drop(id);
        const out = await setKeys(host, {
          mcpServers: upsertServer(servers(), next),
          mcpEnabled: true,
        });
        await mcp.refresh();
        return `${out}\n${report()}`;
      }

      if (sub === "remove" || sub === "rm" || sub === "delete") {
        const id = parts[0];
        if (!id) throw new Error(m().mcpRemoveUsage);
        mcp.drop(id);
        const out = await setKeys(host, {
          mcpServers: servers().filter((server) => server.id !== id),
        });
        await mcp.refresh();
        return `${out}\n${report()}`;
      }

      throw new Error(m().mcpUsage);
    }

    case "memory": {
      const sub = rest.trim().toLowerCase();
      const s = getSettings();
      if (!sub || sub === "info" || sub === "status") {
        const info = host.memoryInfo();
        return format(
          m().memoryState,
          s.remember ? "on" : "off",
          info.entries,
          info.bytes,
          info.file,
        );
      }
      if (sub === "clear") {
        host.resetHistory();
        return m().chatCleared;
      }
      if (sub === "on" || sub === "off") {
        return setKeys(host, { remember: sub === "on" });
      }
      throw new Error(m().profileUsage);
    }

    case "usage":
    case "tokens": {
      const { conversation: convo, allTime } = host.usage();
      const lines: string[] = [
        format(m().usageHeader, convo.id, convo.startedAt.replace("T", " ").slice(0, 19)),
      ];
      if (convo.calls === 0) {
        lines.push(m().usageEmpty);
      } else {
        lines.push(
          format(
            m().usageTotals,
            tokens(convo.calls),
            tokens(convo.promptTokens),
            tokens(convo.completionTokens),
            tokens(convo.totalTokens),
          ),
        );
        lines.push(
          format(
            m().usageSpeed,
            convo.tokensPerSecond === null ? "—" : convo.tokensPerSecond.toFixed(1),
            seconds(convo.elapsedMs),
            convo.cacheHitRate === null
              ? m().usageUnreported
              : `${tokens(convo.cachedTokens)} (${Math.round(convo.cacheHitRate * 100)}%)`,
          ),
        );
        if (convo.reasoningTokens > 0) {
          lines.push(`  reasoning ${tokens(convo.reasoningTokens)} tokens`);
        }
      }
      lines.push("");
      lines.push(
        format(
          m().usageAllTime,
          allTime.conversations,
          tokens(allTime.calls),
          tokens(allTime.promptTokens),
          tokens(allTime.completionTokens),
          tokens(allTime.totalTokens),
        ),
      );
      return lines.join("\n");
    }

    case "conversations":
    case "convos":
    case "convo": {
      const rows = host.conversations();
      const info = host.dataInfo();
      if (rows.length === 0) {
        return [m().conversationsEmpty, format(m().dataHeader, info.conversationsDir)].join("\n");
      }
      return [
        format(m().conversationsHeader, rows.length, info.conversationsDir),
        ...rows.map((row) =>
          format(m().conversationLine, row.id, row.messages, tokens(row.usage.totalTokens)),
        ),
      ].join("\n");
    }

    case "data": {
      const info = host.dataInfo();
      return [
        format(m().dataHeader, info.dir),
        format(m().dataLine, "history", info.historyFile),
        format(m().dataLine, "usage", info.usageFile),
        format(m().dataLine, "conversations", `${info.conversationsDir}  (${info.archived})`),
        format(m().dataLine, "audit", info.auditFile),
      ].join("\n");
    }

    case "port": {
      const port = Number(requireArg(rest, "/port 9000"));
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(m().invalidPort);
      saveSettings();
      return host.restart(port);
    }

    case "open": {
      const target = requireArg(rest, "/open C:\\Users");
      const { runPs } = await import("./util/ps.js");
      await runPs(`Start-Process -FilePath ${psQuote(target)}`);
      return format(m().opened, target);
    }

    case "reset":
      host.resetHistory();
      return m().chatCleared;

    case "stop": {
      const stopped = host.abort();
      return stopped ? m().stopRequested : m().stopIdle;
    }

    case "reload": {
      loadSettings();
      const notices = host.applySettings();
      return [m().reloaded, ...notices].join("\n");
    }

    case "save":
      saveSettings();
      return format(m().savedTo, settingsFile());

    case "exec": {
      const command = requireArg(rest, "/exec Get-Date");
      const { runShellLine } = await import("./terminal.js");
      const result = await runShellLine(command);
      return result.output;
    }

    case "whoami":
      return format(m().agentAt, settingsFile());

    case "audit": {
      const wanted = rest.trim() ? Number(rest.trim()) : 15;
      if (!Number.isFinite(wanted) || wanted < 1 || wanted > 500) throw new Error(m().undoUsage);
      const report = host.audit(wanted);
      if (!report.enabled) return m().auditOff;
      const head = format(m().auditHeader, report.entries.length, report.file);
      const lines = report.entries.map((entry) => {
        const stamp = entry.time.replace("T", " ").slice(0, 19);
        const flag =
          entry.action === "undo"
            ? m().auditUndone
            : entry.undoable
              ? m().auditUndoable
              : "";
        const line = format(m().auditLine, entry.seq, stamp, entry.tool, entry.action, entry.summary);
        return flag ? `${line}  (${flag})` : line;
      });
      if (lines.length === 0) return [head, m().auditEmpty].join("\n");
      if (report.problem) lines.push(`warning: ${report.problem}`);
      return [head, ...lines].join("\n");
    }

    case "undo": {
      const report = host.audit(0);
      if (!report.enabled) return m().auditOff;
      const value = rest.trim().toLowerCase();
      if (value === "list") {
        if (report.pending.length === 0) return m().undoNothing;
        return [
          m().undoListHeader,
          ...report.pending.map((entry) =>
            format(m().undoLine, entry.tool, entry.action, entry.summary),
          ),
        ].join("\n");
      }
      const count = value ? Number(value) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error(m().undoUsage);
      const result = await host.undo(count);
      if (result.undone.length === 0) return m().undoNothing;
      const lines = [
        format(m().undoHeader, result.undone.length),
        ...result.undone.map((entry) =>
          format(m().undoLine, entry.tool, entry.action, entry.summary),
        ),
      ];
      if (result.failures.length > 0) lines.push(format(m().undoFailed, result.failures.join("; ")));
      return lines.join("\n");
    }

    case "public":
      return JSON.stringify(publicSettings(), null, 2);

    default:
      throw new Error(format(m().unknownCommand, name));
  }
}
