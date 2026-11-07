import fs from "node:fs";
import path from "node:path";

/**
 * Images the model can see.
 *
 * The conversation stores images as base64 next to the message text, so a reload
 * (or a reopened archived conversation) still shows them. The OpenAI-compatible
 * wire format is built from the same object in `llm.ts`.
 *
 * Nothing here trusts a browser-supplied MIME type: the bytes are sniffed, and a
 * file that claims to be a PNG but starts with something else is rejected.
 */

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 20_000;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ImageAttachment {
  mimeType: ImageMime;
  /** Base64, without a `data:` prefix. */
  data: string;
  /** Original file name, for the UI. Never used as a path. */
  name?: string;
  width?: number;
  height?: number;
}

const MIME_ALIASES: Record<string, ImageMime> = {
  "image/png": "image/png",
  "image/x-png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/webp": "image/webp",
};

function asMime(value: unknown): ImageMime | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return MIME_ALIASES[raw] ?? null;
}

/** Read the real format from the first bytes. */
export function sniffImageMime(buffer: Buffer): ImageMime | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function positiveDimension(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.min(MAX_IMAGE_DIMENSION, Math.round(number));
}

/** Width and height from the file header, when the format makes it cheap. */
export function imageDimensions(buffer: Buffer, mimeType: ImageMime): { width?: number; height?: number } {
  if (mimeType === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") {
    let index = 2;
    while (index + 9 < buffer.length) {
      if (buffer[index] !== 0xff) {
        index += 1;
        continue;
      }
      const marker = buffer[index + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        index += 2;
        continue;
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        index += 2;
        continue;
      }
      const size = buffer.readUInt16BE(index + 2);
      if (size < 2) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (index + 9 <= buffer.length) {
          return { height: buffer.readUInt16BE(index + 5), width: buffer.readUInt16BE(index + 7) };
        }
        break;
      }
      index += 2 + size;
    }
  }
  if (mimeType === "image/webp" && buffer.length >= 30 && buffer.toString("ascii", 12, 16) === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  return {};
}

/**
 * Validate and normalise an `images` array from the web UI or the HTTP API.
 *
 * Accepts either a bare base64 string plus `mimeType`, or a full data URL. The
 * returned data is canonical base64, so two spellings of the same image compare
 * equal and the wire format is predictable.
 */
export function normalizeImages(value: unknown): ImageAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("images must be an array");
  if (value.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(`at most ${MAX_IMAGES_PER_MESSAGE} images can be sent at once`);
  }

  const images: ImageAttachment[] = [];
  let total = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("each image must be an object");
    }
    const item = entry as Record<string, unknown>;
    let declared = asMime(item.mimeType ?? item.type);
    let raw = String(item.data ?? item.url ?? "").trim();
    const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(raw);
    if (dataUrl) {
      declared = asMime(dataUrl[1]);
      raw = dataUrl[2];
    }
    if (!declared) throw new Error("image mimeType must be image/png, image/jpeg or image/webp");
    raw = raw.replace(/\s+/g, "");
    if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      throw new Error("image data must be base64");
    }
    const buffer = Buffer.from(raw, "base64");
    if (buffer.length === 0) throw new Error("image data is empty");
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`one image may be at most ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
    }
    total += buffer.length;
    if (total > MAX_IMAGE_TOTAL_BYTES) {
      throw new Error(`images may total at most ${Math.round(MAX_IMAGE_TOTAL_BYTES / 1024 / 1024)} MB`);
    }
    const actual = sniffImageMime(buffer);
    if (!actual) throw new Error("image data is not a PNG, JPEG or WebP");
    if (actual !== declared) {
      throw new Error(`image data is ${actual}, not ${declared}`);
    }
    const name = String(item.name ?? "").trim().slice(0, 120);
    const measured = imageDimensions(buffer, actual);
    const width = positiveDimension(item.width) ?? positiveDimension(measured.width);
    const height = positiveDimension(item.height) ?? positiveDimension(measured.height);
    images.push({
      mimeType: actual,
      data: buffer.toString("base64"),
      ...(name ? { name } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  return images;
}

/** A `data:` URL for an `<img>` tag or an OpenAI vision request. */
export function imageDataUrl(image: ImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/** OpenAI's image part, used inside a message `content` array. */
export function imagePart(image: ImageAttachment): Record<string, unknown> {
  return { type: "image_url", image_url: { url: imageDataUrl(image) } };
}

/**
 * Rough token cost of one image. OpenAI charges by tiles; a conservative
 * 750-pixels-per-token estimate with the usual 85..1600 range is close enough
 * for context budgeting. Without dimensions, assume a high-detail screenshot.
 */
export function estimateImageTokens(image: ImageAttachment): number {
  if (!image.width || !image.height) return 1024;
  return Math.max(85, Math.min(1600, Math.ceil((image.width * image.height) / 750)));
}

/** Read an image from disk, with the same validation as an uploaded one. */
export function readImageFile(file: string, name = path.basename(file)): ImageAttachment {
  const stat = fs.statSync(file);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`image is ${(stat.size / 1024 / 1024).toFixed(1)} MB; the limit is ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  }
  const buffer = fs.readFileSync(file);
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) throw new Error("the file is not a PNG, JPEG or WebP image");
  return normalizeImages([{ mimeType, data: buffer.toString("base64"), name }])[0];
}
