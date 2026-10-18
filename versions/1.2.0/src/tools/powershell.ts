import { arg, argBool, type Tool } from "./registry.js";
import { runPowerShell } from "../util/ps.js";

/**
 * Escape hatch: run an arbitrary PowerShell script. Only use when no structured
 * tool fits. Always requires approval (unless flagged readOnly in --yes mode).
 */
export const powershellTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "powershell",
      description:
        "Run a raw PowerShell script. Use this ONLY when no other tool fits the task. " +
        "Prefer the structured tools (files, system, processes, services, network, etc.).",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "The PowerShell script to execute." },
          readOnly: {
            type: "boolean",
            description: "Set true only if the script changes nothing (read-only).",
          },
        },
        required: ["script"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const script = arg(args, "script");
    const readOnly = argBool(args, "readOnly", false);

    if (!readOnly && !(await ctx.approve(`run a custom PowerShell script:\n${script}`))) {
      return "Cancelled by user.";
    }
    if (ctx.dryRun) return `DRY RUN: would run PowerShell:\n${script}`;

    const { code, stdout, stderr } = await runPowerShell(script);
    const output = `${stdout}${stderr}`.trim();
    const body = output || "(no output)";
    return code === 0 ? body : `PowerShell exited with code ${code}:\n${body}`;
  },
};
