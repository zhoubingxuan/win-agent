import { arg, argEnum, argNum, argOpt, type Tool } from "./registry.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

const ACTIONS = ["list", "find", "kill", "start"] as const;

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
        if (!(await ctx.approve(`start program "${name}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would start ${name} ${extra}`;
        const argPart = extra ? ` -ArgumentList ${psQuote(extra)}` : "";
        await runPs(`Start-Process -FilePath ${psQuote(name)}${argPart}`);
        return `Started ${name}.`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
