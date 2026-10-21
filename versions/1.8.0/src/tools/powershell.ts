import { arg, argBool, type Tool } from "./registry.js";
import { scanScript } from "../sandbox.js";
import { explainPowerShellError, runPowerShell } from "../util/ps.js";

/**
 * Escape hatch: run an arbitrary PowerShell script. Only use when no structured
 * tool fits. Always requires approval (unless flagged readOnly in --yes mode).
 * While the sandbox is on, the script is read first and refused if it names a path
 * outside the working directory (see scanScript in src/sandbox.ts).
 */
export const powershellTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "powershell",
      description:
        "Run a raw PowerShell script. Use this ONLY when no other tool fits the task. " +
        "Prefer the structured tools (files, system, processes, services, network, etc.). " +
        "With the sandbox on, every path in the script has to point inside the working directory.",
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

    // Before anyone is asked to approve it: a path outside the folder is a dead end,
    // not a decision, and the answer says which one and why.
    const verdict = scanScript(script);
    if (!verdict.ok) return `Refused: ${verdict.reason}`;

    if (!readOnly && !(await ctx.approve(`run a custom PowerShell script:\n${script}`))) {
      return "Cancelled by user.";
    }
    if (ctx.dryRun) return `DRY RUN: would run PowerShell:\n${script}`;

    const { code, stdout, stderr } = await runPowerShell(script);
    const output = `${stdout}${stderr}`.trim();
    const body = output || "(no output)";
    // The one tool whose effect cannot be described, only quoted: the audit log
    // records the script itself (first 200 characters), tagged as not undoable.
    ctx.record({
      action: "run",
      summary: `ran PowerShell: ${script.replace(/\s+/g, " ").trim().slice(0, 200)}`,
    });
    // The escape hatch is exactly where a Windows hint matters most: "access is
    // denied" is obvious to a human and a dead end for a model.
    return code === 0 ? body : `PowerShell exited with code ${code}:\n${explainPowerShellError(body)}`;
  },
};
