import type { CustomTool } from "../settings.js";
import { explainPowerShellError, psQuote, runPowerShell } from "../util/ps.js";
import { argEnum, argOpt, type Tool } from "./registry.js";

/**
 * Exposes user-defined commands (added from the web UI or the terminal) as a
 * single tool named "custom". The script is PowerShell; the optional `arg`
 * argument is available inside it as `$arg`.
 */
export function createCustomTool(tools: CustomTool[]): Tool {
  const names = tools.map((t) => t.name);

  return {
    schema: {
      type: "function",
      function: {
        name: "custom",
        description:
          "Run user-defined commands. actions: " +
          names.join(", ") +
          ". Each one is a PowerShell script; an optional 'arg' string is available as $arg.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: names },
            arg: { type: "string", description: "Optional argument, available as $arg in the script." },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
    },

    async run(args, ctx) {
      const action = argEnum(args, "action", names);
      const tool = tools.find((t) => t.name === action);
      if (!tool) throw new Error(`unknown custom command "${action}"`);
      const argValue = argOpt(args, "arg") ?? "";

      if (!(await ctx.approve(`run custom command "${action}"`))) return "Cancelled by user.";
      if (ctx.dryRun) return `DRY RUN: would run custom command "${action}".`;

      const script = `$arg = ${psQuote(argValue)}; ${tool.script}`;
      const res = await runPowerShell(script);
      const output = `${res.stdout}${res.stderr}`.trim() || "(no output)";
      return res.code === 0 ? output : `exit code ${res.code}\n${explainPowerShellError(output)}`;
    },
  };
}
