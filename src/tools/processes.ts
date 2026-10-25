import { arg, argEnum, argNum, argOpt, type Tool } from "./registry.js";
import { jailPath } from "../sandbox.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

const ACTIONS = ["list", "find", "kill", "start"] as const;

/**
 * Programs that run a script rather than doing one thing. In guided mode a model
 * that can `python test.py` is a model writing commands again - which is exactly
 * what the structured tools exist to avoid. `tests` is the sanctioned way to run a
 * project's own tests; everything else waits for normal mode.
 */
const SCRIPT_HOSTS = new Set([
  "python",
  "python3",
  "py",
  "node",
  "nodejs",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "powershell",
  "pwsh",
  "cmd",
  "bash",
  "sh",
  "wsl",
  "cscript",
  "wscript",
  "mshta",
]);

export const processesTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "processes",
      description:
        "Inspect and control running programs. actions: list (top by memory), find (by name), " +
        "kill (by id or name), start (launch a program).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          name: { type: "string", description: "Process name or path for find/kill/start." },
          id: { type: "number", description: "Process id for kill." },
          args: { type: "string", description: "Arguments when starting a program." },
          cwd: {
            type: "string",
            description:
              "start: working folder for the program (relative to the working directory). " +
              "Use it when the program reads or writes files in a project folder.",
          },
          top: { type: "number", description: "How many rows for list. Default 15." },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", ACTIONS);

    switch (action) {
      case "list": {
        const top = argNum(args, "top", 15);
        const data = await runPsJson(
          [
            `Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First ${top} ` +
              "@{n='Id';e={$_.Id}},ProcessName," +
              "@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB,1)}}," +
              "@{n='CPUs';e={[math]::Round($_.CPU,1)}}",
          ].join("\n"),
        );
        return JSON.stringify(data, null, 2);
      }

      case "find": {
        const name = arg(args, "name").replace(/\.exe$/i, "");
        const data = await runPsJson(
          `Get-Process -Name ${psQuote(name)} -ErrorAction SilentlyContinue | ` +
            "Select-Object Id,ProcessName,@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB,1)}}",
        );
        return data ? JSON.stringify(data, null, 2) : `No process named "${name}" is running.`;
      }

      case "kill": {
        const id = argNum(args, "id", -1);
        const name = argOpt(args, "name");
        if (id < 0 && !name) throw new Error("provide either 'id' or 'name' to kill");
        const label = id >= 0 ? `PID ${id}` : `all processes named "${name}"`;
        if (!(await ctx.approve(`kill ${label}`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would kill ${label}.`;
        if (id >= 0) {
          await runPs(`Stop-Process -Id ${id} -Force`);
          return `Killed PID ${id}.`;
        }
        await runPs(
          `Get-Process -Name ${psQuote((name as string).replace(/\.exe$/i, ""))} -ErrorAction SilentlyContinue | Stop-Process -Force`,
        );
        return `Killed processes named "${name}".`;
      }

      case "start": {
        const name = arg(args, "name");
        const extra = argOpt(args, "args") ?? "";
        const host = name
          .replace(/\\/g, "/")
          .split("/")
          .pop()!
          .toLowerCase()
          .replace(/\.(exe|cmd|bat|com)$/, "");
        if (ctx.guided && SCRIPT_HOSTS.has(host)) {
          return (
            `Error: guided mode does not run interpreters or scripts (${name}). ` +
            "Use the tests tool for a project's tests; switch to normal or expert mode for the raw shell."
          );
        }
        const cwdRaw = argOpt(args, "cwd")?.trim();
        const cwd = cwdRaw ? jailPath(cwdRaw) : null;
        const where = cwd ? ` in ${cwd}` : "";
        if (!(await ctx.approve(`start program "${name}"${where}`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would start ${name} ${extra}${where}`;
        const argPart = extra ? ` -ArgumentList ${psQuote(extra)}` : "";
        const dirPart = cwd ? ` -WorkingDirectory ${psQuote(cwd)}` : "";
        await runPs(`Start-Process -FilePath ${psQuote(name)}${argPart}${dirPart}`);
        return `Started ${name}${extra ? ` ${extra}` : ""}${where}. Output is not captured; use a log file if you need it.`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
