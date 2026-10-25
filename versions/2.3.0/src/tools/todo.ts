import { argNum, argOpt, type Tool } from "./registry.js";
import { clearTodos, markTodo, renderTodos, setTodoTexts, todoSummary, todos } from "../todo.js";

const ACTIONS = ["set", "list", "done", "doing", "reopen", "clear"] as const;

/** What a model types instead of the word we documented. */
const ALIASES: Record<string, (typeof ACTIONS)[number]> = {
  plan: "set",
  create: "set",
  write: "set",
  show: "list",
  get: "list",
  status: "list",
  complete: "done",
  completed: "done",
  finish: "done",
  finished: "done",
  check: "done",
  start: "doing",
  begin: "doing",
  working: "doing",
  progress: "doing",
  undone: "reopen",
  todo: "reopen",
  uncheck: "reopen",
  reset: "clear",
  delete: "clear",
  remove: "clear",
};

/**
 * The model's own checklist. It changes nothing on disk and needs no approval: it is
 * a tool because that is the only way a small model writes something down, and it is
 * a *call* because the page can then show the plan (and its progress) while the turn
 * is still running.
 */
export const todoTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "todo",
      description:
        "Write down the steps of the task you were given and tick them off as you go. " +
        "Nothing on the machine is changed. Use it when the request has two or more parts: " +
        '"set" the steps first, then mark each one "done". The user sees this list.',
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [...ACTIONS],
            description:
              'set = replace the whole list, list = show it, done/doing/reopen = change one item, clear = empty it',
          },
          items: {
            type: "array",
            items: { type: "string" },
            description: 'For "set": the steps, in order, one short sentence each.',
          },
          text: {
            type: "string",
            description: 'For "set": alternative to items - the steps separated by newlines.',
          },
          id: {
            type: "number",
            description: 'For done/doing/reopen: the item number (1 is the first).',
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args) {
    const raw = (argOpt(args, "action") ?? "list").trim().toLowerCase();
    const action = (ACTIONS as readonly string[]).includes(raw) ? (raw as (typeof ACTIONS)[number]) : ALIASES[raw];
    if (!action) {
      return `Error: unknown action "${raw}". Use one of: ${ACTIONS.join(", ")}`;
    }

    if (action === "list") {
      if (todos().length === 0) return "The checklist is empty.";
      return `${todoSummary()}\n${renderTodos()}`;
    }

    if (action === "clear") {
      clearTodos();
      return "The checklist is empty.";
    }

    if (action === "set") {
      const texts = itemsFrom(args);
      if (texts.length === 0) {
        return 'Error: give the steps in "items" (an array) or "text" (one step per line).';
      }
      setTodoTexts(texts);
      return `${todoSummary()}\n${renderTodos()}`;
    }

    const id = Math.trunc(argNum(args, "id", 0));
    if (id <= 0) {
      return `Error: action "${action}" needs the item "id" (1 is the first). ${renderTodos()}`;
    }
    const status = action === "done" ? "done" : action === "doing" ? "doing" : "todo";
    try {
      markTodo(id, status);
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
    const note = status === "done" ? "done" : status === "doing" ? "in progress" : "open again";
    return `Item ${id} is ${note}.\n${todoSummary()}\n${renderTodos()}`;
  },
};

/**
 * `items` is the documented shape, but small models send a string, a string with
 * newlines, or an array of `{"text": ...}` objects. All of them mean a list of steps,
 * so all of them are accepted instead of bounced back as an error.
 */
function itemsFrom(args: Record<string, unknown>): string[] {
  const value = args.items ?? args.text ?? args.steps ?? args.list;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return cleanStep(entry);
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const text = record.text ?? record.title ?? record.step ?? record.name;
          return typeof text === "string" ? cleanStep(text) : "";
        }
        return "";
      })
      .filter((text) => text.trim() !== "");
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => cleanStep(line))
      .filter((line) => line.trim() !== "");
  }
  return [];
}

/** "1. do this" / "- do this" / "• do this" all mean "do this". */
function cleanStep(text: string): string {
  return text.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "");
}
