import type { BomKind } from "./json.js";

/**
 * Decoding text files the way Windows actually writes them.
 *
 * A .txt file on Windows is not necessarily UTF-8:
 *
 * - Notepad's "Unicode" save option writes **UTF-16 LE** with a BOM.
 * - Windows PowerShell's `Out-File`, `Set-Content` and `>` redirection defaulted
 *   to **UTF-16 LE** until PowerShell 6.
 * - Many tools still start UTF-8 files with a **UTF-8 BOM**.
 *
 * Reading those bytes as UTF-8 produces `h\0e\0l\0l\0o` (or replacement
 * characters), which is useless to a model and looks like the tool is broken.
 * These helpers sniff the byte-order mark (and, failing that, the NUL pattern)
 * and decode accordingly, and they can put the bytes back the same way so an
 * edit does not silently change a file's encoding.
 */

export type TextEncoding = "utf8" | "utf16le" | "utf16be";

export interface DecodedText {
  /** The decoded text, byte-order mark removed. */
  text: string;
  encoding: TextEncoding;
  /** The byte-order mark that was found, if any. */
  bom: BomKind | null;
  /** True when the bytes are not text at all (embedded NULs after decoding). */
  binary: boolean;
}

/** How many leading bytes are inspected when there is no byte-order mark. */
const SNIFF_BYTES = 512;

/** Decide how a buffer is encoded, without consuming it. */
export function detectEncoding(buf: Buffer): { encoding: TextEncoding; bom: BomKind | null } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: "utf8", bom: "utf8" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: "utf16le", bom: "utf16le" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: "utf16be", bom: "utf16be" };
  }

  // No BOM. UTF-16 text is full of NUL bytes (every ASCII character is 00 xx or
  // xx 00), which plain UTF-8 text never contains, so the position of the NULs
  // gives the byte order away.
  const window = buf.subarray(0, SNIFF_BYTES);
  let evenNuls = 0;
  let oddNuls = 0;
  for (let i = 0; i < window.length; i++) {
    if (window[i] === 0) {
      if (i % 2 === 0) evenNuls += 1;
      else oddNuls += 1;
    }
  }
  if (evenNuls > 0 || oddNuls > 0) {
    if (evenNuls >= oddNuls) return { encoding: "utf16be", bom: null };
    return { encoding: "utf16le", bom: null };
  }
  return { encoding: "utf8", bom: null };
}

/** Decode a buffer that may be UTF-8, UTF-16 LE or UTF-16 BE. */
export function decodeText(buf: Buffer): DecodedText {
  const { encoding, bom } = detectEncoding(buf);
  const body = bom ? buf.subarray(bom === "utf8" ? 3 : 2) : buf;
  let text: string;
  if (encoding === "utf16le") {
    text = body.toString("utf16le");
  } else if (encoding === "utf16be") {
    const swapped = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
    swapped.swap16();
    text = swapped.toString("utf16le");
  } else {
    text = body.toString("utf8");
  }
  return { text, encoding, bom, binary: /\u0000/.test(text) };
}

/** Put text back into the bytes it came from, byte-order mark included. */
export function encodeText(text: string, encoding: TextEncoding, withBom = false): Buffer {
  let body: Buffer;
  if (encoding === "utf16le") {
    body = Buffer.from(text, "utf16le");
  } else if (encoding === "utf16be") {
    body = Buffer.from(text, "utf16le");
    body.swap16();
  } else {
    body = Buffer.from(text, "utf8");
  }
  if (!withBom) return body;
  const mark =
    encoding === "utf16le"
      ? Buffer.from([0xff, 0xfe])
      : encoding === "utf16be"
        ? Buffer.from([0xfe, 0xff])
        : Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([mark, body]);
}

/** Human-readable name of an encoding, for messages. */
export function encodingLabel(encoding: TextEncoding, bom: BomKind | null): string {
  const name = encoding === "utf8" ? "UTF-8" : encoding === "utf16le" ? "UTF-16 LE" : "UTF-16 BE";
  return bom ? `${name} with BOM` : name;
}
