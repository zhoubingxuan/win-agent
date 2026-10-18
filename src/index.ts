#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import fs from "node:fs";
import { Agent } from "./agent.js";
import { getSettings, loadSettings, settingsFile, toConfig } from "./settings.js";
import { configurePowerShell } from "./util/ps.js";
import { createWindowsTools, type Approval } from "./tools/index.js";
import { mcp } from "./mcp.js";
import { VERSION } from "./version.js";

interface Flags {
  yes: boolean;
  dryRun: boolean;
  listTools: boolean;
  help: boolean;
  prompt: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, dryRun: false, listTools: false, help: false, prompt: "" };
  const rest: string[] = [];
  for (const token of argv) {
    switch (token) {
      case "-y":
      case "--yes":
        flags.yes = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--list-tools":
        flags.listTools = true;
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
      default:
        rest.push(token);
    }
  }
  flags.prompt = rest.join(" ").trim();
  return flags;
}

function printHelp(): void {
  console.log(
    [
      `win-agent ${VERSION} - a Windows automation agent for local LLMs`,
      "",
      "Usage:",
      "  npm run dev                 interactive mode",
      "  npm run web                 browser UI (everything configurable there)",
      '  npm run dev -- "<task>"     run a single task and exit',
      "",
      "Options:",
      "  -y, --yes        auto-approve all actions (use with care)",
      "  --dry-run        show what would happen without doing it",
      "  --list-tools     print the available tools and exit",
      "  -h, --help       show this help",
      "",
      `Settings file: ${settingsFile()}`,
    ].join("\n"),
  );
}

/** Print one line per MCP server that would not start. Never fatal. */
function warnMcpFailures(): void {
  for (const server of mcp.status()) {
    if (server.enabled && !server.connected) console.log(`  warning: MCP ${server.id}: ${server.error}`);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  loadSettings();
  const settings = getSettings();
  configurePowerShell(settings.powershell);
  if (fs.existsSync(settings.workdir)) {
    try {
      process.chdir(settings.workdir);
    } catch {
      /* keep current directory */
    }
  }

  if (flags.listTools) {
    // Connect to the MCP servers first, so the printed catalog is the real one.
    await mcp.ensureFresh();
    warnMcpFailures();
    console.log(
      createWindowsTools(async () => true, {
        dryRun: flags.dryRun,
        enabledTools: settings.enabledTools,
        customTools: settings.customTools,
        webSearchUrl: settings.webSearchUrl,
      }).describe(),
    );
    mcp.close();
    return;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: !!stdin.isTTY });

  const autoApprove = flags.yes || settings.autoApprove;
  const approval: Approval = async (summary) => {
    if (flags.dryRun || settings.dryRun) return true;
    if (autoApprove) {
      console.log(`  [auto-approved] ${summary}`);
      return true;
    }
    if (!stdin.isTTY) {
      console.log(`  [denied - no terminal] ${summary}`);
      return false;
    }
    const answer = await rl.question(`\n  Approve: ${summary} ? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  };

  // The MCP tool list is needed before the tool set is built; a server that will
  // not start is a warning here, not a reason to refuse to run.
  if (settings.mcpEnabled) {
    await mcp.ensureFresh();
    warnMcpFailures();
  }

  const tools = createWindowsTools(approval, {
    dryRun: flags.dryRun || settings.dryRun,
    enabledTools: settings.enabledTools,
    customTools: settings.customTools,
    webSearchUrl: settings.webSearchUrl,
  });

  const agent = new Agent(toConfig(settings), tools, {
    onStep: (step, max) => {
      if (step > 1) console.log(`  ... step ${step}/${max}`);
    },
    onAssistantText: (text) => console.log(`\n${text}\n`),
    onContext: (stats) => {
      console.log(
        `  ... context trimmed (${stats.droppedMessages} exchange(s) dropped, ${stats.truncatedToolResults} result(s) shortened) to fit ${stats.limit} tokens`,
      );
    },
    onToolCall: (name, args) => {
      const preview = args.length > 160 ? `${args.slice(0, 160)}...` : args;
      console.log(`  -> ${name} ${preview}`);
    },
    onToolResult: (name, result) => {
      const oneLine = result.replace(/\s+/g, " ").trim();
      const preview = oneLine.length > 160 ? `${oneLine.slice(0, 160)}...` : oneLine;
      console.log(`  <- [${name}] ${preview}`);
    },
  });

  if (flags.prompt) {
    try {
      await agent.run(flags.prompt);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    } finally {
      mcp.close();
      rl.close();
    }
    return;
  }

  console.log(`win-agent ${VERSION} (Windows automation for local LLMs)`);
  console.log(`  model : ${settings.model}`);
  console.log(`  api   : ${settings.baseUrl}`);
  console.log(`  tools : ${tools.names().join(", ")}`);
  console.log(`  hints : run "npm run web" for the full interface`);
  if (flags.dryRun) console.log("  mode  : DRY RUN (nothing will be changed)");
  if (autoApprove) console.log("  mode  : auto-approve ON");
  console.log("  Type /help for commands, /exit to quit.\n");

  try {
    for (;;) {
      let line: string;
      try {
        line = (await rl.question("you> ")).trim();
      } catch {
        break;
      }
      if (line === "") continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") {
        printHelp();
        continue;
      }
      if (line === "/reset") {
        agent.reset();
        console.log("(history cleared)");
        continue;
      }

      try {
        await agent.run(line);
      } catch (error) {
        console.error(`\n[error] ${(error as Error).message}\n`);
      }
    }
  } finally {
    mcp.close();
    rl.close();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
