import type { ToolSchema } from "../llm.js";
import { parseToolArguments } from "../util/json.js";

/** Per-execution context handed to every tool. */
export interface ToolContext {
  /** When true, destructive tools must report what they would do instead of doing it. */
  dryRun: boolean;
  /** Ask the user to approve a destructive action. Resolves false if denied. */
  approve(summary: string): Promise<boolean>;
}

export interface Tool {
  schema: ToolSchema;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/* -------------------------------------------------------------------------- */
/* Argument helpers - small models produce loose JSON, so validate generously. */
/* -------------------------------------------------------------------------- */

export function arg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  throw new Error(`missing required string argument "${key}"`);
}

export function argOpt(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function argNum(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function argBool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value)) return true;
    if (/^(false|no|0)$/i.test(value)) return false;
  }
  return fallback;
}

export function argEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = arg(args, key);
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw new Error(`unknown ${key} "${value}". Valid values: ${allowed.join(", ")}`);
  }
  return match;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export type Approval = (summary: string) => Promise<boolean>;

/** Levenshtein distance, used only for "did you mean" hints. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(
    private readonly approval: Approval,
    private readonly dryRun = false,
  ) {}

  register(tool: Tool): this {
    this.tools.set(tool.schema.function.name, tool);
    return this;
  }

  /** Keep only the named tools. Pass null to keep everything. */
  filter(keep: string[] | null): this {
    if (!keep) return this;
    for (const name of [...this.tools.keys()]) {
      if (!keep.includes(name)) this.tools.delete(name);
    }
    return this;
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Markdown-ish catalog injected into the system prompt to guide small models. */
  describe(options: { verbose?: boolean } = {}): string {
    const lines: string[] = ["Available tools (call them exactly by name):"];
    for (const tool of this.tools.values()) {
      const fn = tool.schema.function;
      const params = fn.parameters as {
        properties?: Record<string, { enum?: string[]; description?: string }>;
        required?: string[];
      };
      const actions = params.properties?.action?.enum;
      lines.push(`- ${fn.name}: ${fn.description}`);
      if (actions) lines.push(`    action must be one of: ${actions.join(", ")}`);
      if (options.verbose) {
        // A small model copies argument names much more reliably when they are
        // listed, and it cannot read the JSON schema it is sent.
        const required = new Set(params.required ?? []);
        const names = Object.keys(params.properties ?? {}).filter((name) => name !== "action");
        if (names.length > 0) {
          const spelled = names.map((name) => (required.has(name) ? `${name} (required)` : name));
          lines.push(`    arguments: ${spelled.join(", ")}`);
        }
      }
    }
    lines.push("");
    lines.push("Always pass arguments as a single JSON object. Prefer these tools over guessing commands.");
    lines.push(
      [
        "If you cannot call functions directly, reply with one fenced JSON block and nothing else:",
        "```json",
        '{"tool": "<tool name>", "arguments": {"action": "...", "...": "..."}}',
        "```",
        "The result comes back as a tool message; then answer in plain text.",
      ].join("\n"),
    );
    return lines.join("\n");
  }

  /**
   * The tool whose name is closest to `name`, for a "did you mean" hint. Small
   * models misspell `services` as `service` or `scheduledtasks`; naming the tool
   * they wanted is far more useful than a list of everything.
   */
  closestName(name: string): string | null {
    const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!wanted) return null;
    let best: { name: string; distance: number } | null = null;
    for (const candidate of this.tools.keys()) {
      const flat = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
      const distance = editDistance(wanted, flat);
      if (best === null || distance < best.distance) best = { name: candidate, distance };
    }
    if (!best) return null;
    if (best.distance <= 2) return best.name;
    if (name.length >= 4 && best.name.toLowerCase().includes(name.toLowerCase())) return best.name;
    if (best.name.toLowerCase().startsWith(name.toLowerCase().slice(0, 4))) return best.name;
    return null;
  }

  /** Execute a tool by name. Errors are returned as text so the model can react. */
  async execute(name: string, rawArguments: string): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      const suggestion = this.closestName(name);
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
      return `Error: unknown tool "${name}".${hint} Available tools: ${this.names().join(", ")}`;
    }

    const parsed = parseToolArguments<Record<string, unknown>>(rawArguments);
    if (!parsed) {
      return `Error: arguments for "${name}" were not valid JSON: ${rawArguments}`;
    }
    const args = parsed.value;

    const ctx: ToolContext = {
      dryRun: this.dryRun,
      approve: this.approval,
    };

    try {
      return await tool.run(args, ctx);
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }
}
