import { Fragment, useEffect, useState, type ReactNode } from "react";

import { findMessageLinks } from "@/lib/messageLinks";

const MAX_FORMAT_DEPTH = 8;

const LINK_CLASSES =
  "break-all text-primary underline decoration-current/40 underline-offset-2 hover:decoration-current";
const INLINE_CODE_CLASSES = "rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]";
const CODE_BLOCK_CLASSES = "my-1 overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-sm";
const SPOILER_CLASSES =
  "cursor-pointer rounded bg-foreground/80 text-transparent transition-colors [&.revealed]:bg-surface-2 [&.revealed]:text-inherit";
const MENTION_CLASSES = "rounded bg-primary/15 px-1 font-medium text-primary";

type TimestampSuffix = "t" | "T" | "d" | "D" | "f" | "F" | "R";

function relativeTime(date: Date, now: Date): string {
  const diff = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [31536000, "year"],
    [2592000, "month"],
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  for (const [seconds, label] of units) {
    if (abs >= seconds || label === "second") {
      const value = Math.round(diff / seconds) || 0;
      const plural = Math.abs(value) === 1 ? "" : "s";
      return value >= 0 ? `in ${value} ${label}${plural}` : `${-value} ${label}${plural} ago`;
    }
  }
  return "now";
}

function formatTimestamp(unix: number, suffix: TimestampSuffix): string {
  const date = new Date(unix * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = (withSeconds = false) =>
    date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
    });

  switch (suffix) {
    case "t":
      return time();
    case "T":
      return time(true);
    case "d":
      return date.toLocaleDateString();
    case "D":
      return date.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
    case "F":
      return `${date.toLocaleDateString([], {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })} at ${time()}`;
    case "R":
      return relativeTime(date, now);
    default: {
      const day =
        date.toDateString() === now.toDateString()
          ? "Today"
          : date.toDateString() === yesterday.toDateString()
            ? "Yesterday"
            : date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
      return `${day} at ${time()}`;
    }
  }
}

function Timestamp({ unix, suffix }: { unix: number; suffix: TimestampSuffix }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (suffix !== "R") return;
    const id = window.setInterval(() => force((value) => value + 1), 30000);
    return () => window.clearInterval(id);
  }, [suffix]);

  return (
    <span
      className="rounded bg-surface-2 px-1 text-[0.95em]"
      title={new Date(unix * 1000).toLocaleString()}
    >
      {formatTimestamp(unix, suffix)}
    </span>
  );
}

const HEADING_SIZE_CLASSES: Record<1 | 2 | 3, string> = {
  1: "text-lg",
  2: "text-base",
  3: "text-[0.95rem]",
};

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; content: string }
  | { kind: "heading"; level: 1 | 2 | 3; content: string }
  | { kind: "subtext"; content: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };

  const flushQuote = () => {
    if (quote.length) {
      blocks.push({ kind: "quote", lines: quote });
      quote = [];
    }
  };

  const flushPending = () => {
    flushParagraph();
    flushQuote();
  };

  for (const line of text.split("\n")) {
    if (code) {
      if (line.startsWith("```")) {
        blocks.push({ kind: "code", content: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushPending();
      const rest = line.slice(3);
      const closing = rest.indexOf("```");
      if (closing === -1) {
        code = [];
      } else {
        blocks.push({ kind: "code", content: rest.slice(0, closing) });
      }
      continue;
    }

    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      flushPending();
      blocks.push({
        kind: "heading",
        level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
        content: heading[2] ?? "",
      });
      continue;
    }

    const subtext = /^-# (.*)$/.exec(line);
    if (subtext) {
      flushPending();
      blocks.push({ kind: "subtext", content: subtext[1] ?? "" });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      quote.push(line.slice(1).replace(/^ /, ""));
      continue;
    }

    flushQuote();
    paragraph.push(line);
  }

  if (code) blocks.push({ kind: "code", content: code.join("\n") });
  flushPending();
  return blocks;
}

function findClosingMarker(input: string, from: number, marker: string): number {
  if (!input.charAt(from) || /\s/.test(input.charAt(from))) return -1;
  let index = input.indexOf(marker, from);
  while (index !== -1) {
    if (index > from && !/\s/.test(input.charAt(index - 1))) return index;
    index = input.indexOf(marker, index + 1);
  }
  return -1;
}

function toggleRevealed(element: HTMLElement) {
  element.classList.toggle("revealed");
}

function parseInline(
  input: string,
  keyPrefix: string,
  depth = 0,
  mentions?: Record<string, string>,
): ReactNode[] {
  if (!input) return [];
  if (depth > MAX_FORMAT_DEPTH) return [input];

  const nodes: ReactNode[] = [];
  let plain = "";
  let index = 0;

  const flushPlain = () => {
    if (plain) {
      nodes.push(plain);
      plain = "";
    }
  };

  while (index < input.length) {
    const char = input.charAt(index);
    const next = input.charAt(index + 1);

    if (char === "<") {
      const mention = /^<@([0-9a-fA-F-]{36})>/.exec(input.slice(index));
      if (mention) {
        flushPlain();
        const id = mention[1] ?? "";
        nodes.push(
          <span key={`${keyPrefix}-mention-${index}`} className={MENTION_CLASSES}>
            @{mentions?.[id] ?? "user"}
          </span>,
        );
        index += mention[0].length;
        continue;
      }
      const timestamp = /^<t:(\d{9,13})(?::([tTdDfFR]))?>/.exec(input.slice(index));
      if (timestamp) {
        flushPlain();
        nodes.push(
          <Timestamp
            key={`${keyPrefix}-time-${index}`}
            unix={Number(timestamp[1])}
            suffix={(timestamp[2] as TimestampSuffix | undefined) ?? "f"}
          />,
        );
        index += timestamp[0].length;
        continue;
      }
    }

    if (char === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        flushPlain();
        nodes.push(
          <code key={`${keyPrefix}-code-${index}`} className={INLINE_CODE_CLASSES}>
            {input.slice(index + 1, end)}
          </code>,
        );
        index = end + 1;
        continue;
      }
    }

    if (char === "|" && next === "|") {
      const end = input.indexOf("||", index + 2);
      if (end > index + 2) {
        flushPlain();
        const inner = input.slice(index + 2, end);
        nodes.push(
          <span
            key={`${keyPrefix}-spoiler-${index}`}
            role="button"
            tabIndex={0}
            className={SPOILER_CLASSES}
            onClick={(event) => toggleRevealed(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleRevealed(event.currentTarget);
              }
            }}
          >
            {parseInline(inner, `${keyPrefix}-spoiler-${index}`, depth + 1, mentions)}
          </span>,
        );
        index = end + 2;
        continue;
      }
    }

    if (char === "*" && next === "*") {
      const end = findClosingMarker(input, index + 2, "**");
      if (end > index + 2) {
        flushPlain();
        nodes.push(
          <strong key={`${keyPrefix}-bold-${index}`}>
            {parseInline(
              input.slice(index + 2, end),
              `${keyPrefix}-bold-${index}`,
              depth + 1,
              mentions,
            )}
          </strong>,
        );
        index = end + 2;
        continue;
      }
    }

    if (char === "_" && next === "_") {
      const end = findClosingMarker(input, index + 2, "__");
      if (end > index + 2) {
        flushPlain();
        nodes.push(
          <u key={`${keyPrefix}-underline-${index}`}>
            {parseInline(
              input.slice(index + 2, end),
              `${keyPrefix}-underline-${index}`,
              depth + 1,
              mentions,
            )}
          </u>,
        );
        index = end + 2;
        continue;
      }
    }

    if (char === "~" && next === "~") {
      const end = findClosingMarker(input, index + 2, "~~");
      if (end > index + 2) {
        flushPlain();
        nodes.push(
          <s key={`${keyPrefix}-strike-${index}`}>
            {parseInline(
              input.slice(index + 2, end),
              `${keyPrefix}-strike-${index}`,
              depth + 1,
              mentions,
            )}
          </s>,
        );
        index = end + 2;
        continue;
      }
    }

    if (char === "*" && next !== "*") {
      const end = findClosingMarker(input, index + 1, "*");
      if (end > index + 1) {
        flushPlain();
        nodes.push(
          <em key={`${keyPrefix}-italic-${index}`}>
            {parseInline(
              input.slice(index + 1, end),
              `${keyPrefix}-italic-${index}`,
              depth + 1,
              mentions,
            )}
          </em>,
        );
        index = end + 1;
        continue;
      }
    }

    if (char === "_" && next !== "_") {
      const before = index === 0 ? "" : input.charAt(index - 1);
      const insideWord = before !== "" && /[\w]/.test(before);
      if (!insideWord) {
        const end = findClosingMarker(input, index + 1, "_");
        if (end > index + 1) {
          flushPlain();
          nodes.push(
            <em key={`${keyPrefix}-italic-${index}`}>
              {parseInline(
                input.slice(index + 1, end),
                `${keyPrefix}-italic-${index}`,
                depth + 1,
                mentions,
              )}
            </em>,
          );
          index = end + 1;
          continue;
        }
      }
    }

    plain += char;
    index += 1;
  }

  flushPlain();
  return nodes;
}

function renderInline(
  line: string,
  keyPrefix: string,
  mentions?: Record<string, string>,
): ReactNode[] {
  const links = findMessageLinks(line);
  if (!links.length) return parseInline(line, keyPrefix, 0, mentions);

  const nodes: ReactNode[] = [];
  let cursor = 0;

  links.forEach((link, index) => {
    if (link.start > cursor) {
      nodes.push(
        ...parseInline(line.slice(cursor, link.start), `${keyPrefix}-before-${index}`, 0, mentions),
      );
    }
    nodes.push(
      <a
        key={`${keyPrefix}-link-${index}`}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASSES}
      >
        {link.text}
      </a>,
    );
    cursor = link.end;
  });

  if (cursor < line.length) {
    nodes.push(...parseInline(line.slice(cursor), `${keyPrefix}-after`, 0, mentions));
  }

  return nodes;
}

function renderLines(
  lines: string[],
  keyPrefix: string,
  mentions?: Record<string, string>,
): ReactNode[] {
  const nodes: ReactNode[] = [];

  lines.forEach((line, index) => {
    if (index > 0) nodes.push("\n");
    nodes.push(
      <Fragment key={`${keyPrefix}-line-${index}`}>
        {renderInline(line, `${keyPrefix}-line-${index}`, mentions)}
      </Fragment>,
    );
  });

  return nodes;
}

export function renderMessageBody(text: string, mentions?: Record<string, string>): ReactNode {
  return parseBlocks(text).map((block, index) => {
    const key = `block-${index}`;

    switch (block.kind) {
      case "code":
        return (
          <pre key={key} className={CODE_BLOCK_CLASSES}>
            <code>{block.content}</code>
          </pre>
        );
      case "heading":
        return (
          <p key={key} className={`font-bold text-foreground ${HEADING_SIZE_CLASSES[block.level]}`}>
            {renderInline(block.content, key, mentions)}
          </p>
        );
      case "subtext":
        return (
          <span key={key} className="block text-xs text-muted-foreground">
            {renderInline(block.content, key, mentions)}
          </span>
        );
      case "quote":
        return (
          <blockquote key={key} className="border-l-2 border-border pl-2 text-muted-foreground">
            {renderLines(block.lines, key, mentions)}
          </blockquote>
        );
      case "paragraph":
        return <Fragment key={key}>{renderLines(block.lines, key, mentions)}</Fragment>;
    }
  });
}
