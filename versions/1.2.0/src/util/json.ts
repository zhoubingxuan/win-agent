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
