import { promises as fs } from "node:fs";
import path from "node:path";
import { arg, argEnum, argNum, argOpt, type Tool } from "./registry.js";

/**
 * Web access: search, fetch a page, or download a file.
 *
 * This is the piece that lets the agent answer questions that are not about the
 * local machine. `fetch` returns readable text extracted from HTML (or pretty
 * JSON) so small models do not have to read raw markup.
 */

const ACTIONS = ["search", "fetch", "download"] as const;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Hard cap so a huge page cannot blow up the request. */
const MAX_BYTES = 3_000_000;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  middot: "·",
  copy: "©",
  reg: "®",
  deg: "°",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

/** Strip tags and collapse whitespace: HTML in, readable text out. */
function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1\s*>/gi, " ");
  const spaced = withoutBlocks
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*hr\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*(h[1-6])[^>]*>/gi, "\n\n")
    .replace(/<\s*\/\s*(p|div|section|article|li|tr|table|ul|ol|h[1-6]|blockquote|pre|form)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(spaced)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

/** Turn a link from a search page into the real destination URL. */
function resolveResultUrl(href: string, base: string): string {
  try {
    const url = new URL(href, base);
    const redirect =
      url.searchParams.get("uddg") ?? url.searchParams.get("url") ?? url.searchParams.get("q");
    if (redirect && /^https?:/i.test(redirect)) return redirect;
    const encoded = url.searchParams.get("u");
    if (encoded && /^a1/i.test(encoded)) {
      try {
        const decoded = Buffer.from(encoded.slice(2), "base64").toString("utf8");
        if (/^https?:/i.test(decoded)) return decoded;
      } catch {
        /* not base64 after all */
      }
    }
    return url.href;
  } catch {
    return href;
  }
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Pull result rows out of a search page (Bing, DuckDuckGo, then anything). */
function parseSearchResults(html: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];

  // Bing: every organic result is an <li class="b_algo"> ...
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const link =
      /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ??
      /<a[^>]+class="[^"]*tilk[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    hits.push({
      title: htmlToText(link[2]).replace(/\n+/g, " "),
      url: resolveResultUrl(link[1], base),
      snippet: snippet ? htmlToText(snippet[1]).replace(/\n+/g, " ").slice(0, 220) : "",
    });
  }

  // DuckDuckGo / generic: any anchor with a real title that leaves the site.
  if (hits.length === 0) {
    const host = (() => {
      try {
        return new URL(base).hostname;
      } catch {
        return "";
      }
    })();
    for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = resolveResultUrl(match[1], base);
      if (!/^https?:/i.test(url)) continue;
      if (host && new URL(url).hostname === host) continue;
      const title = htmlToText(match[2]).replace(/\n+/g, " ");
      if (title.length < 6) continue;
      hits.push({ title, url, snippet: "" });
    }
  }

  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (!hit.url || seen.has(hit.url)) return false;
    seen.add(hit.url);
    return true;
  });
}

interface FetchResult {
  status: number;
  url: string;
  contentType: string;
  body: string;
}

interface HttpOptions {
  method?: string;
  body?: string;
  /** Send the body as JSON (adds the Content-Type header). */
  json?: boolean;
}

async function httpGet(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
  options: HttpOptions = {},
): Promise<FetchResult> {
  let target: URL;
  try {
    target = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw new Error(`"${url}" is not a valid URL (include http:// or https://)`);
  }
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error(`only http and https URLs are supported, got "${target.protocol}"`);
  }

  let res: Response;
  try {
    res = await fetch(target.href, {
      method: options.method ?? "GET",
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
        ...(options.body && options.json !== false ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: options.body,
      signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs, 1_000), 120_000)),
    });
  } catch (error) {
    const err = error as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error(`timed out after ${timeoutMs} ms fetching ${target.href}`);
    }
    throw new Error(`could not reach ${target.href} (${err.message})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const body = buffer.subarray(0, MAX_BYTES).toString("utf8");
  return {
    status: res.status,
    url: res.url || target.href,
    contentType: res.headers.get("content-type") ?? "",
    body,
  };
}

/** Slice to a window so a long page still fits in the model's context. */
function windowText(text: string, maxChars: number, offset: number): string {
  const total = text.length;
  const slice = text.slice(offset, offset + maxChars);
  const parts = [slice];
  if (offset > 0 || total > offset + maxChars) {
    parts.push(`... (chars ${offset}-${Math.min(total, offset + maxChars)} of ${total})`);
  }
  return parts.join("\n");
}

export interface WebToolOptions {
  /** Search page template; `{q}` becomes the query. Defaults to Bing. */
  searchUrl?: string;
}

export function createWebTool(options: WebToolOptions = {}): Tool {
  const searchUrl = options.searchUrl?.trim() || "https://www.bing.com/search?q={q}";

  return {
    schema: {
      type: "function",
      function: {
        name: "web",
        description:
          "Access the internet: search the web, read a page or API, or download a file. " +
          "actions: search (find pages), fetch (GET/POST a URL and return readable text, " +
          "pretty JSON or raw HTML), download (save a URL to disk).",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: [...ACTIONS] },
            query: { type: "string", description: "Search text (search)." },
            url: { type: "string", description: "Absolute http(s) URL (fetch/download)." },
            path: { type: "string", description: "Where to save the download." },
            format: {
              type: "string",
              enum: ["text", "html", "json"],
              description: "fetch: text (default, readable), html (raw) or json (pretty).",
            },
            method: { type: "string", description: "fetch: HTTP method. Default GET." },
            body: { type: "string", description: "fetch: request body for POST/PUT." },
            headers: {
              type: "object",
              description: "fetch: extra request headers as key/value pairs.",
            },
            maxChars: { type: "number", description: "fetch: max characters to return. Default 6000." },
            offset: { type: "number", description: "fetch: skip this many characters first." },
            count: { type: "number", description: "search: how many results. Default 8." },
            timeoutMs: { type: "number", description: "Timeout in ms. Default 20000." },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
    },

    async run(args, ctx) {
      const action = argEnum(args, "action", ACTIONS);

      switch (action) {
        case "search": {
          const query = arg(args, "query");
          const count = Math.min(Math.max(argNum(args, "count", 8), 1), 25);
          const timeoutMs = argNum(args, "timeoutMs", 20_000);
          const url = searchUrl.includes("{q}")
            ? searchUrl.replaceAll("{q}", encodeURIComponent(query))
            : `${searchUrl}${searchUrl.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;

          const page = await httpGet(url, timeoutMs);
          if (page.status >= 400) {
            return `Error: the search page answered HTTP ${page.status}. Check webSearchUrl in settings (${searchUrl}).`;
          }
          const hits = parseSearchResults(page.body, page.url).slice(0, count);
          if (hits.length === 0) {
            return `No results found for "${query}". The search page layout may have changed — try fetch on a known URL instead.`;
          }
          const lines = [`Search results for "${query}" (${hits.length}):`];
          hits.forEach((hit, index) => {
            lines.push(`${index + 1}. ${hit.title}`);
            lines.push(`   ${hit.url}`);
            if (hit.snippet) lines.push(`   ${hit.snippet}`);
          });
          return lines.join("\n");
        }

        case "fetch": {
          const url = arg(args, "url");
          const format = (argOpt(args, "format") ?? "text").toLowerCase();
          const maxChars = Math.min(Math.max(argNum(args, "maxChars", 6_000), 200), 100_000);
          const offset = Math.max(argNum(args, "offset", 0), 0);
          const method = (argOpt(args, "method") ?? "GET").toUpperCase();
          const timeoutMs = argNum(args, "timeoutMs", 20_000);
          const extraHeaders = (args.headers ?? {}) as Record<string, unknown>;

          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(extraHeaders)) headers[String(key)] = String(value);

          const body = argOpt(args, "body");
          const result = await httpGet(
            url,
            timeoutMs,
            headers,
            method === "GET" || method === "HEAD" ? { method } : { method, body },
          );

          const head =
            `HTTP ${result.status}  ${result.contentType || "unknown type"}  ${result.url}`;

          if (format === "html") {
            return `${head}\n\n${windowText(result.body, maxChars, offset)}`;
          }

          if (format === "json" || result.contentType.includes("json")) {
            let pretty = result.body;
            try {
              pretty = JSON.stringify(JSON.parse(result.body), null, 2);
            } catch {
              /* not valid JSON: show it as-is */
            }
            return `${head}\n\n${windowText(pretty, maxChars, offset)}`;
          }

          const looksHtml = /<html|<!doctype|<body|<div|<p[ >]/i.test(result.body.slice(0, 2_000));
          const title = looksHtml ? pageTitle(result.body) : "";
          const text = looksHtml ? htmlToText(result.body) : result.body;
          if (!text) return `${head}\n\n(the page had no readable text)`;
          return `${head}${title ? `\n${title}` : ""}\n\n${windowText(text, maxChars, offset)}`;
        }

        case "download": {
          const url = arg(args, "url");
          const target = path.resolve(process.cwd(), arg(args, "path"));
          if (!(await ctx.approve(`download ${url} to ${target}`))) return "Cancelled by user.";
          if (ctx.dryRun) return `DRY RUN: would download ${url} to ${target}`;

          let res: Response;
          try {
            res = await fetch(url, { redirect: "follow", headers: { "User-Agent": DEFAULT_UA } });
          } catch (error) {
            throw new Error(`could not reach ${url} (${(error as Error).message})`);
          }
          if (!res.ok) return `Error: ${url} answered HTTP ${res.status}`;
          const buffer = Buffer.from(await res.arrayBuffer());
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, buffer);
          return `Downloaded ${buffer.length} bytes from ${url} to ${target}`;
        }

        default:
          throw new Error(`unhandled action ${action as string}`);
      }
    },
  };
}
