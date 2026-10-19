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
import { mcp } from "../mcp.js";
import { sandboxEnabled } from "../sandbox.js";

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

/**
 * Why the scripting tools are withheld while the sandbox is on. A script reaches
 * anywhere the user can - it cannot be confined to a folder by looking at its
 * text - so the sandbox closes the two scripting tools rather than pretending to
 * police them. Everything a small model needs has a structured tool.
 */
export const SANDBOX_NO_SCRIPTS =
  "the sandbox is on, so scripts are not run";
export const SANDBOX_HINT =
  "use the structured tools instead (files, system, services, processes, network, " +
  "registry, scheduled_tasks), or switch the sandbox off in Settings";

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

  // The sandbox keeps file paths inside the working directory; the two scripting
  // tools are the way around that, so they are taken off the menu while it is on.
  // (After the custom tools are registered, or there would be nothing to withhold.)
  // Read live from the settings - the same switch jailPath() obeys - so the fence
  // and the catalogue can never disagree about whether the sandbox is on.
  if (sandboxEnabled()) {
    // `withhold()` keeps the first reason, so in guided mode the shell keeps the
    // guided explanation - that is the accurate one there, and its way out ("use
    // the structured tools") is the right advice. The sandbox reason then only
    // appears for tools that were not already withheld for another reason.
    const already = new Set(registry.withheld().map((entry) => entry.name));
    registry.withhold(
      ["powershell", "custom"].filter((name) => !already.has(name)),
      SANDBOX_NO_SCRIPTS,
      SANDBOX_HINT,
    );
  }

  return registry.filter(options.enabledTools ?? null);
}
