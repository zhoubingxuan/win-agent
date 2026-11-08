/**
 * The checklist: the model writes down what it owes the user, then ticks the steps
 * off. It changes nothing on the machine - it is a promise made visible, which is
 * exactly what a small model is worst at keeping (it forgets the second half of a
 * two-part request and declares victory).
 *
 * The list lives in this module rather than inside the tool, because two readers
 * need it: the `todo` tool (the model edits it) and the agent loop (which refuses to
 * end a turn while items are still open). It is one process-wide board, because one
 * turn runs at a time; the server seeds it from the conversation and saves it back.
 */

export type TodoStatus = "todo" | "doing" | "done";

export interface TodoItem {
  /** 1-based position; the model names an item by it ("mark 2 done"). */
  id: number;
  text: string;
  status: TodoStatus;
}

/** More than this and it stops being a plan and becomes a second job. */
export const MAX_TODOS = 30;
/** Longer than this and the item is a paragraph, not a step. */
export const MAX_TODO_TEXT = 200;
/**
 * How many times the loop will point at unfinished items before letting the turn
 * end. Two is enough for a model that simply forgot; a model that is arguing with
 * the list should not be trapped in it.
 */
export const TODO_NUDGE_LIMIT = 2;

const STATUSES: TodoStatus[] = ["todo", "doing", "done"];

let items: TodoItem[] = [];
const listeners = new Set<(items: TodoItem[]) => void>();

/** A defensive copy: callers must not be able to edit the board by accident. */
export function todos(): TodoItem[] {
  return items.map((item) => ({ ...item }));
}

/** Items that are not done yet, in order. This is what the loop checks. */
export function unfinishedTodos(): TodoItem[] {
  return items.filter((item) => item.status !== "done").map((item) => ({ ...item }));
}

/**
 * Replace the board (new turn, loaded conversation, /reset). Unknown statuses and
 * blank texts are dropped rather than trusted: the list is written by a model.
 */
export function seedTodos(saved: TodoItem[] | undefined | null): void {
  const next: TodoItem[] = [];
  for (const entry of saved ?? []) {
    if (!entry || typeof entry.text !== "string") continue;
    const text = entry.text.trim();
    if (!text) continue;
    const status = STATUSES.find((value) => value === entry.status) ?? "todo";
    next.push({ id: next.length + 1, text: text.slice(0, MAX_TODO_TEXT), status });
    if (next.length >= MAX_TODOS) break;
  }
  commit(next, false);
}

/** `set`: the whole plan, in the model's own words. Replaces what was there. */
export function setTodoTexts(texts: string[]): string {
  const next: TodoItem[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    const text = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // A model that repeats a line usually means one step, not two.
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    next.push({ id: next.length + 1, text: text.slice(0, MAX_TODO_TEXT), status: "todo" });
    if (next.length >= MAX_TODOS) break;
  }
  if (next.length === 0) throw new Error("the checklist needs at least one non-empty item");
  commit(next);
  return renderTodos(next);
}

/** Mark one item (1-based id). Returns the rendered list so the model sees it. */
export function markTodo(id: number, status: TodoStatus): string {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(
      `there is no item ${id}. The checklist has ${items.length} item(s): ${items.map((entry) => entry.id).join(", ")}`,
    );
  }
  commit(items.map((entry) => (entry.id === id ? { ...entry, status } : entry)));
  return renderTodos(items);
}

/** Close the list (the conversation was reset, or the model started over). */
export function clearTodos(): void {
  commit([]);
}

/** Watch the board. The agent turns this into a live `todo` event for the page. */
export function subscribeTodos(listener: (items: TodoItem[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: TodoItem[], announce = true): void {
  items = next;
  if (!announce) return;
  for (const listener of [...listeners]) listener(todos());
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

const MARK: Record<TodoStatus, string> = { todo: "[ ]", doing: "[~]", done: "[x]" };

/** `1. [ ] text` - compact enough for a tool result, clear enough for a small model. */
export function renderTodos(list: TodoItem[] = items): string {
  if (list.length === 0) return "(the checklist is empty)";
  return list.map((item) => `${item.id}. ${MARK[item.status]} ${item.text}`).join("\n");
}

/** "Checklist: 2/4 done, 1 in progress" - one line above the list. */
export function todoSummary(list: TodoItem[] = items, language: string = "en"): string {
  const done = list.filter((item) => item.status === "done").length;
  const doing = list.filter((item) => item.status === "doing").length;
  if (language === "zh") {
    const parts = [`清单：${done}/${list.length} 项完成`];
    if (doing > 0) parts.push(`${doing} 项进行中`);
    return parts.join("，");
  }
  const parts = [`Checklist: ${done}/${list.length} done`];
  if (doing > 0) parts.push(`${doing} in progress`);
  return parts.join(", ");
}

/**
 * Sent (for one request only, never stored) when the model tries to end a turn with
 * items still open. It names them, because "you forgot something" is exactly the
 * kind of hint a small model cannot act on.
 */
export function todoNudge(language: string | undefined, open: TodoItem[]): string {
  const list = renderTodos(open);
  if (language === "zh") {
    return [
      `你的清单上还有 ${open.length} 项没有完成：`,
      list,
      "现在把它们做完（做完一项就用 todo 标记 done），或者如果某一项确实不再需要，就用 todo 把它标记 done 并说明原因。",
      "不要直接结束这一轮。",
    ].join("\n");
  }
  return [
    `${open.length} item(s) on your checklist are still open:`,
    list,
    "Do them now and mark each one done with the todo tool, or mark an item done and say why it is no longer needed.",
    "Do not end the turn yet.",
  ].join("\n");
}

/** What the user is told when the loop had to remind the model (the page shows it). */
export function todoNudgeNotice(language: string | undefined, open: number, attempt: number): string {
  if (language === "zh") {
    return `清单上还有 ${open} 项没完成，已提醒模型继续（第 ${attempt} 次）。`;
  }
  return `${open} checklist item(s) are still open — asked the model to finish them (reminder ${attempt}).`;
}
