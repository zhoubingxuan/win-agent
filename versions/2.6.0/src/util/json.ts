/**
 * JSON helpers for the files this agent writes and humans edit.
 *
 * Windows is full of ways to smuggle bytes into a `.json` file:
 *
 * - **UTF-8 BOM.** Notepad, older PowerShell (`Set-Content -Encoding UTF8`),
 *   `Out-File`, Visual Studio and plenty of editors start a UTF-8 file with
 *   `EF BB BF`. `JSON.parse` rejects it outright, so a perfectly good settings file
 *   would look broken.
 * - **UTF-16.** Notepad's "Unicode" save option. Same story.
 *
 * `parseJson` removes the byte-order mark before parsing and remembers what it had to
 * do, so callers can tell the user *which* file was subtly wrong instead of silently
 * falling back to the defaults.
 */

export type BomKind = "utf8" | "utf16le" | "utf16be";

export interface ParsedJson<T> {
  value: T;
  /** The byte-order mark that had to be removed, if any. */
  bom: BomKind | null;
}

/** Detect and strip a byte-order mark. Returns the text plus what was found. */
export function stripBom(text: string): { text: string; bom: BomKind | null } {
  if (text.charCodeAt(0) === 0xfeff) return { text: text.slice(1), bom: "utf8" };
  if (text.startsWith("\xff\xfe")) return { text: text.slice(2), bom: "utf16le" };
  if (text.startsWith("\xfe\xff")) return { text: text.slice(2), bom: "utf16be" };
  return { text, bom: null };
}

/** Parse JSON that came from a file, tolerating a byte-order mark. */
export function parseJsonWithBom<T = unknown>(text: string): ParsedJson<T> {
  const { text: clean, bom } = stripBom(text);
  return { value: JSON.parse(clean) as T, bom };
}

/**
 * Parse JSON that may have been written by a human, throwing a message that says what
 * is actually wrong: a BOM is harmless (it is removed), a trailing comma or a comment
 * is a real error and the caller should show it.
 */
export function parseJson<T = unknown>(text: string): T {
  return parseJsonWithBom<T>(text).value;
}

/** Human-readable name of a BOM, for notices. */
export function bomLabel(bom: BomKind): string {
  if (bom === "utf8") return "UTF-8 BOM";
  if (bom === "utf16le") return "UTF-16 LE BOM";
  return "UTF-16 BE BOM";
}

/* -------------------------------------------------------------------------- */
/* Repairing JSON that a small model wrote by hand                            */
/* -------------------------------------------------------------------------- */

export interface RepairedJson<T> {
  value: T;
  /** What had to be fixed, or null when the text was already valid JSON. */
  repair: string | null;
}

/**
 * Tool arguments come from a language model, not from a serializer, and a 7B
 * model reliably produces a few specific mistakes:
 *
 * - a trailing comma (`{"action": "list",}`)
 * - an unquoted key (`{action: "list"}`)
 * - single quotes (`{'path': 'C:\\temp'}`)
 * - Windows paths with a raw backslash where an escape is not valid
 *   (`C:\Users\Name` - `\U` and `\N` are not JSON escapes)
 *
 * Each of these is repaired, but only when the strict parse already failed and
 * only in ways that cannot change a *different* valid meaning: `\t` or `\n`
 * (a real escape) is left alone, and a string is never re-quoted when it already
 * contains double quotes. Returns null when the text is beyond repair.
 */
export function parseToolArguments<T = Record<string, unknown>>(text: string): RepairedJson<T> | null {
  const candidates: Array<{ text: string; repair: string | null }> = [];

  const trimmed = text.trim();
  if (!trimmed) return { value: {} as T, repair: null };

  // A fenced block, which is how the text tool-call fallback is documented.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fence ? fence[1] : trimmed).trim();

  // The text as written first, then progressively more invasive repairs.
  candidates.push({ text: body, repair: null });

  const escaped = body.replace(
    /\\(?![\\/"bfnrt]|u[0-9a-fA-F]{4})/g,
    (whole) => `\\${whole}`,
  );
  if (escaped !== body) candidates.push({ text: escaped, repair: "escaped backslashes" });

  const noTrailingComma = escaped.replace(/,(\s*[}\]])/g, "$1");
  if (noTrailingComma !== escaped) candidates.push({ text: noTrailingComma, repair: "removed a trailing comma" });

  // Single quotes only when there is no double quote at all, so a string that
  // legitimately contains an apostrophe cannot be mangled.
  if (body.includes("'") && !body.includes('"')) {
    candidates.push({
      text: noTrailingComma.replace(/'/g, '"'),
      repair: "used double quotes",
    });
    candidates.push({ text: escaped.replace(/'/g, '"'), repair: "used double quotes" });
  }

  // Unquoted keys: {action: "list"} - \w+ followed by a colon right after { or ,.
  const quotedKeys = noTrailingComma.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  if (quotedKeys !== noTrailingComma) candidates.push({ text: quotedKeys, repair: "quoted the keys" });

  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate.text) as T, repair: candidate.repair };
    } catch {
      // try the next shape
    }
  }
  return null;
}
