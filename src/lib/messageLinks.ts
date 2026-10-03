export type MessageLink = {
  text: string;
  href: string;
  previewUrl: string;
  start: number;
  end: number;
};

export type LinkPreview = {
  title: string | null;
  description: string | null;
  image: string | null;
  icon: string | null;
  siteName: string;
};

const linkPattern =
  /https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?<![\w@.-])(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*[a-z\d](?:[a-z\d-]*[a-z\d])?\.(?:com|org|net|edu|gov|mil|int|io|ai|co|app|dev|info|biz|me|tv|uk|us|ca|au|nz|de|fr|es|it|nl|se|no|fi|dk|ch|at|be|ie|jp|cn|in|br|ru|ua|pl|cz|pt|gr|il|sg|hk|kr|za|xyz|online|site|tech|store|cloud|life|news|world|blog|pro|cc|gg|ly|sh|fm)(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/gi;

function trimUrlPunctuation(value: string) {
  let end = value.length;
  while (end > 0 && /[.,!?;:]/.test(value[end - 1] ?? "")) end -= 1;

  const pairs: Array<[string, string]> = [
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ];
  let changed = true;
  while (changed && end > 0) {
    changed = false;
    for (const [closing, opening] of pairs) {
      if (value[end - 1] === closing) {
        const fragment = value.slice(0, end);
        const closeCount = fragment.split(closing).length - 1;
        const openCount = fragment.split(opening).length - 1;
        if (closeCount > openCount) {
          end -= 1;
          changed = true;
        }
      }
    }
  }
  return value.slice(0, end);
}

export function findMessageLinks(text: string): MessageLink[] {
  const links: MessageLink[] = [];
  for (const match of text.matchAll(linkPattern)) {
    const matchText = match[0];
    const matchStart = match.index ?? 0;
    const previous = text[matchStart - 1] ?? "";
    if (previous && /[\w@.-]/i.test(previous)) continue;

    const linkText = trimUrlPunctuation(matchText);
    if (!linkText) continue;
    const next = text[matchStart + linkText.length] ?? "";
    if (next && /[\w@-]/i.test(next)) continue;

    const rawHref =
      /^www\./i.test(linkText) || !/^https?:\/\//i.test(linkText)
        ? `https://${linkText}`
        : linkText;

    try {
      const parsed = new URL(rawHref);
      if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      ) {
        continue;
      }
      const preview = new URL(parsed.href);
      preview.hash = "";
      links.push({
        text: linkText,
        href: parsed.href,
        previewUrl: preview.href,
        start: matchStart,
        end: matchStart + linkText.length,
      });
    } catch {
      // Invalid URL-like text stays ordinary message text.
    }
  }
  return links;
}

export function uniquePreviewUrls(links: MessageLink[]) {
  return [...new Set(links.map((link) => link.previewUrl))].slice(0, 2);
}

const previewCache = new Map<string, { expiresAt: number; promise: Promise<LinkPreview | null> }>();

export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const cached = previewCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
    headers: { Accept: "application/json" },
    credentials: "omit",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("preview" in result)) return null;
      const preview = (result as { preview?: unknown }).preview;
      if (!preview || typeof preview !== "object") return null;

      const value = preview as Record<string, unknown>;
      const safeText = (input: unknown, max: number) =>
        typeof input === "string"
          ? [...input]
              .map((character) => {
                const code = character.charCodeAt(0);
                return code < 32 || code === 127 ? " " : character;
              })
              .join("")
              .trim()
              .slice(0, max)
          : null;
      let image: string | null = null;
      const rawImage = safeText(value["image"], 2048);
      if (rawImage) {
        try {
          const parsedImage = new URL(rawImage);
          if (parsedImage.protocol === "https:" && !parsedImage.username && !parsedImage.password) {
            image = parsedImage.href;
          }
        } catch {
          image = null;
        }
      }

      let icon: string | null = null;
      const rawIcon = safeText(value["icon"], 2048);
      if (rawIcon) {
        try {
          const parsedIcon = new URL(rawIcon);
          if (parsedIcon.protocol === "https:" && !parsedIcon.username && !parsedIcon.password) {
            icon = parsedIcon.href;
          }
        } catch {
          icon = null;
        }
      }

      const title = safeText(value["title"], 160);
      const description = safeText(value["description"], 320);
      const siteName = safeText(value["siteName"], 80);
      if (!title && !description && !image && !icon) return null;
      return { title, description, image, icon, siteName: siteName || new URL(url).hostname };
    })
    .catch(() => null);

  previewCache.set(url, { expiresAt: Date.now() + 10 * 60_000, promise });
  if (previewCache.size > 300) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) previewCache.delete(oldestKey);
  }
  return promise;
}
