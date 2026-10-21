import type { AgentMode, CustomTool } from "../settings.js";
import type { Approval } from "./registry.js";
import { ToolRegistry } from "./registry.js";
import { filesTool } from "./files.js";
import { systemTool } from "./system.js";
import { processesTool } from "./processes.js";
import { servicesTool } from "./services.js";
import { networkTool } from "./network.js";
import { scheduledTasksTool, registryTool } from "./automation.js";
import { uiTool } from "./ui.js";
import { powershellTool } from "./powershell.js";
import { createWebTool } from "./web.js";
import { createCustomTool } from "./custom.js";
import { skillsTool } from "./skills.js";
import { mcp } from "../mcp.js";

export { ToolRegistry } from "./registry.js";
export type { Approval, Tool, ToolContext } from "./registry.js";

export interface ToolOptions {
  dryRun?: boolean;
  /** null / undefined = every tool; otherwise only these names. */
  enabledTools?: string[] | null;
  /** User-defined commands, exposed through the "custom" tool. */
  customTools?: CustomTool[];
  /** Search page template (`{q}` = query) for the web tool. */
  webSearchUrl?: string;
  /** In `guided` mode the raw shell is withheld (see GUIDED_NO_SHELL). */
  agentMode?: AgentMode;
}

/**
 * Why `powershell` is not offered in guided mode. The tool still exists, so a model
 * that calls it anyway gets this instead of "unknown tool": the point is to push a
 * small model towards the structured actions rather than let it improvise a script.
 */
export const GUIDED_NO_SHELL =
  "the raw shell is switched off in guided mode";
export const GUIDED_NO_SHELL_HINT =
  'do not write commands or scripts. Use the structured tools instead: system (action ' +
  '"disk" for free space), files, services, processes, network, registry, scheduled_tasks';

/** Build the Windows tool set, honouring the enabled/custom configuration. */
export function createWindowsTools(approval: Approval, options: ToolOptions = {}): ToolRegistry {
  const registry = new ToolRegistry(approval, options.dryRun ?? false)
    .register(filesTool)
    .register(systemTool)
    .register(processesTool)
    .register(servicesTool)
    .register(networkTool)
    .register(createWebTool({ searchUrl: options.webSearchUrl }))
    .register(scheduledTasksTool)
    .register(registryTool)
    .register(uiTool)
    .register(skillsTool)
    .register(powershellTool);

  // Guided mode is for small models: they fail at inventing PowerShell, and every
  // structured action they need exists as a tool, so the shell is not offered at all.
  if (options.agentMode === "guided") {
    registry.withhold(["powershell"], GUIDED_NO_SHELL, GUIDED_NO_SHELL_HINT);
  }

  if (options.customTools && options.customTools.length > 0) {
    registry.register(createCustomTool(options.customTools));
  }

  // Tools offered by MCP servers (see src/mcp.ts). They are refreshed separately
  // - `mcp.ensureFresh()` - so building the tool set stays synchronous.
  for (const tool of mcp.tools(approval, options.dryRun ?? false)) registry.register(tool);

  return registry.filter(options.enabledTools ?? null);
}
