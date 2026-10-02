import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { expiresAt: number; preview: Preview | null }>();

type Preview = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string;
};

type PinnedAddress = { address: string; family: number };

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return false;
    const [a = 0, b = 0, c = 0] = parts;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
  // Public IPv6 unicast is in 2000::/3. Documentation and transition ranges are excluded.
  return (
    /^[23]/.test(normalized) &&
    !normalized.startsWith("2001:db8:") &&
    !normalized.startsWith("2002:") &&
    !normalized.startsWith("2001:0000:")
  );
}

async function resolvePublicTarget(url: URL): Promise<PinnedAddress> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host.includes(".") ||
    isIP(host) !== 0 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))
  ) {
    throw new Error("Unsupported target");
  }

  const addresses = await dnsLookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Unsupported target");
  }
  const first = addresses[0];
  if (!first) throw new Error("Unsupported target");
  return { address: first.address, family: first.family };
}

function requestHtml(
  url: URL,
  pinned: PinnedAddress,
): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "User-Agent": "ZChatLinkPreview/1.0",
        },
        servername: url.hostname,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const rawContentType = response.headers["content-type"];
        const contentType = Array.isArray(rawContentType)
          ? (rawContentType[0] ?? "")
          : (rawContentType ?? "");
        const rawLocation = response.headers.location;
        const location = Array.isArray(rawLocation)
          ? (rawLocation[0] ?? null)
          : (rawLocation ?? null);
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({ status, location, contentType, body: "" });
          return;
        }
        if (
          status < 200 ||
          status >= 300 ||
          !/^(text\/html|application\/xhtml\+xml)/i.test(contentType)
        ) {
          response.resume();
          resolve({ status, location: null, contentType, body: "" });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let tail = "";
        const finish = (body: string) => {
          if (settled) return;
          settled = true;
          resolve({ status, location: null, contentType, body });
        };
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = MAX_HTML_BYTES - size;
          if (remaining <= 0) {
            finish(Buffer.concat(chunks).toString("utf8"));
            response.destroy();
            return;
          }

          const bounded = bytes.subarray(0, remaining);
          chunks.push(bounded);
          size += bounded.length;
          const tailAndText = tail + bounded.toString("utf8");
          const reachedHeadEnd = tailAndText.toLowerCase().includes("</head>");
          tail = tailAndText.slice(-6);

          if (reachedHeadEnd || size === MAX_HTML_BYTES) {
            finish(Buffer.concat(chunks).toString("utf8"));
            response.destroy();
          }
        });
        response.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
        response.on("error", (error) => {
          if (!settled) reject(error);
        });
      },
    );
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
    request.end();
  });
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_match, code: string) => {
      const number = code.toLowerCase().startsWith("x")
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : "";
    })
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
          "&#39;": "'",
        })[entity.toLowerCase()] ?? entity,
    )
    .replace(/[\t\n\r]/g, " ")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const body = tag.replace(/^<\w+|\/?\s*>$/g, "");
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of body.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase();
    if (name) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function parseMetadata(html: string, finalUrl: URL): Preview | null {
  const headEnd = html.toLowerCase().indexOf("</head>");
  const head = (headEnd >= 0 ? html.slice(0, headEnd) : html).slice(0, MAX_HTML_BYTES);
  const meta = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = getAttributes(match[0]);
    const key = attributes["property"] ?? attributes["name"];
    const content = attributes["content"];
    if (key && content && !meta.has(key.toLowerCase())) meta.set(key.toLowerCase(), content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  const title =
    meta.get("og:title") ??
    meta.get("twitter:title") ??
    (titleTag ? decodeEntities(titleTag.replace(/<[^>]*>/g, "")) : null);
  const description =
    meta.get("og:description") ??
    meta.get("twitter:description") ??
    meta.get("description") ??
    null;
  const imageValue = meta.get("og:image") ?? meta.get("twitter:image") ?? null;
  let image: string | null = null;
  if (imageValue) {
    try {
      const candidate = new URL(imageValue, finalUrl);
      if (candidate.protocol === "https:" && !candidate.username && !candidate.password)
        image = candidate.href.slice(0, 2048);
    } catch {
      /* Ignore invalid image URLs. */
    }
  }
  const clean = (value: string | null, limit: number) =>
    value ? decodeEntities(value).slice(0, limit) || null : null;
  const result = {
    title: clean(title, 160),
    description: clean(description, 320),
    image,
    siteName:
      clean(meta.get("og:site_name") ?? meta.get("application-name") ?? finalUrl.hostname, 80) ??
      finalUrl.hostname,
  };
  return result.title || result.description || result.image ? result : null;
}

async function fetchPreview(input: string): Promise<Preview | null> {
  let current = new URL(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (current.protocol !== "https:" && current.protocol !== "http:")
      throw new Error("Unsupported protocol");
    const pinned = await resolvePublicTarget(current);
    const result = await requestHtml(current, pinned);
    if (result.location) {
      if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects");
      current = new URL(result.location, current);
      continue;
    }
    return result.body ? parseMetadata(result.body, current) : null;
  }
  return null;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.writeHead(405).end();
    return;
  }
  const input = new URL(request.url ?? "/", "https://zchat.invalid").searchParams.get("url");
  if (!input || input.length > 2048) {
    response
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ preview: null }));
    return;
  }
  let url: URL;
  try {
    url = new URL(input);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
      throw new Error("Invalid URL");
    url.hash = "";
  } catch {
    response
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ preview: null }));
    return;
  }

  const cached = cache.get(url.href);
  let preview = cached?.expiresAt && cached.expiresAt > Date.now() ? cached.preview : undefined;
  if (preview === undefined) {
    try {
      preview = await fetchPreview(url.href);
    } catch {
      preview = null;
    }
    cache.set(url.href, { expiresAt: Date.now() + CACHE_TTL_MS, preview });
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ preview }));
}
