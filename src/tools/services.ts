import { arg, argEnum, argOpt, type Tool } from "./registry.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

const ACTIONS = ["list", "status", "start", "stop", "restart", "enable", "disable"] as const;

const STARTUP_TYPES: Record<string, string> = {
  enable: "Automatic",
  disable: "Disabled",
};

export const servicesTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "services",
      description:
        "Manage Windows services without remembering sc.exe syntax. " +
        "actions: list, status (one service), start, stop, restart, enable (auto-start), disable. " +
        "Use the short service name, e.g. 'Spooler' or 'wuauserv'.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          name: { type: "string", description: "Service name." },
          filter: { type: "string", description: "Wildcard name filter for list, e.g. 'win*'." },
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
        const filter = argOpt(args, "filter");
        const where = filter ? ` | Where-Object { $_.Name -like ${psQuote(filter)} }` : "";
        const data = await runPsJson(
          `Get-Service${where} | Select-Object Name,DisplayName,` +
            "@{n='Status';e={$_.Status.ToString()}},@{n='StartType';e={$_.StartType.ToString()}} | " +
            "Sort-Object Name",
        );
        return JSON.stringify(data, null, 2);
      }

      case "status": {
        const name = arg(args, "name");
        const data = await runPsJson(
          `Get-Service -Name ${psQuote(name)} -ErrorAction Stop | ` +
            "Select-Object Name,DisplayName," +
            "@{n='Status';e={$_.Status.ToString()}},@{n='StartType';e={$_.StartType.ToString()}}",
        );
        return JSON.stringify(data, null, 2);
      }

      case "start": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`start service "${name}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would start service ${name}.`;
        await runPs(`Start-Service -Name ${psQuote(name)}`);
        return `Service ${name} started.`;
      }

      case "stop": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`stop service "${name}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would stop service ${name}.`;
        await runPs(`Stop-Service -Name ${psQuote(name)} -Force`);
        return `Service ${name} stopped.`;
      }

      case "restart": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`restart service "${name}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would restart service ${name}.`;
        await runPs(`Restart-Service -Name ${psQuote(name)} -Force`);
        return `Service ${name} restarted.`;
      }

      case "enable":
      case "disable": {
        const name = arg(args, "name");
        const startup = STARTUP_TYPES[action];
        if (!(await ctx.approve(`set service "${name}" startup to ${startup}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would set ${name} startup to ${startup}.`;
        await runPs(`Set-Service -Name ${psQuote(name)} -StartupType ${startup}`);
        return `Service ${name} startup set to ${startup}.`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
