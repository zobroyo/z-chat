import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Reply } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import { CHAT_BUCKET, useSignedUrl } from "@/lib/media";
import type { Message, MessageReceipt, Profile } from "@/lib/chat";
import { fetchLinkPreview, findMessageLinks, uniquePreviewUrls, type LinkPreview } from "@/lib/messageLinks";
import { cn } from "@/lib/utils";

type ReplyPreview = {
  senderName: string;
  snippet: string;
} | null;

type Props = {
  message: Message;
  self: boolean;
  sender: Profile | undefined;
  showSender: boolean;
  replyPreview?: ReplyPreview | undefined;
  onReply?: (() => void) | undefined;
  onJumpToReply?: (() => void) | undefined;
  receipts?: MessageReceipt[] | undefined;
  groupChat?: boolean | undefined;
  animateIn?: boolean | undefined;
};

export function MessageBubble({
  message,
  self,
  sender,
  showSender,
  replyPreview,
  onReply,
  onJumpToReply,
  receipts = [],
  groupChat = false,
  animateIn = false,
}: Props) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [previewIsVisible, setPreviewIsVisible] = useState(false);
  const [previews, setPreviews] = useState<Record<string, LinkPreview | null>>({});
  const [previewImageErrors, setPreviewImageErrors] = useState<Record<string, boolean>>({});
  const links = useMemo(() => findMessageLinks(message.body ?? ""), [message.body]);
  const previewUrls = useMemo(() => uniquePreviewUrls(links), [links]);
  const imageUrl = useSignedUrl(CHAT_BUCKET, message.image_url);
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const messageReceipts = receipts.filter((receipt) => receipt.message_id === message.id);
  const deliveredCount = messageReceipts.filter((receipt) => receipt.delivered_at).length;
  const readCount = messageReceipts.filter((receipt) => receipt.read_at).length;
  const receiptStatus = message.id.startsWith("temp-")
    ? "Sending"
    : groupChat && messageReceipts.length > 1
      ? `Delivered ${deliveredCount}/${messageReceipts.length} · Read ${readCount}/${messageReceipts.length}`
      : readCount > 0
        ? "Read"
        : deliveredCount > 0
          ? "Delivered"
          : "Sent";

  useEffect(() => {
    if (!previewUrls.length) return;
    const element = bubbleRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setPreviewIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPreviewIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "280px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewUrls.length]);

  useEffect(() => {
    if (!previewIsVisible || !previewUrls.length) return;
    let active = true;
    void Promise.all(previewUrls.map(async (url) => [url, await fetchLinkPreview(url)] as const)).then((results) => {
      if (active) setPreviews((current) => ({ ...current, ...Object.fromEntries(results) }));
    });
    return () => { active = false; };
  }, [previewIsVisible, previewUrls]);

  function renderLinkedMessage() {
    const body = message.body ?? "";
    if (!links.length) return body;
    const parts = [];
    let cursor = 0;
    for (const link of links) {
      if (link.start > cursor) parts.push(body.slice(cursor, link.start));
      parts.push(
        <a
          key={link.start}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          {link.text}
        </a>,
      );
      cursor = link.end;
    }
    if (cursor < body.length) parts.push(body.slice(cursor));
    return parts;
  }

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group flex items-end gap-2",
        animateIn && "message-enter",
        self ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div className="size-7">
        {showSender && !self && (
          <UserAvatar name={sender?.display_name} path={sender?.avatar_url} className="size-7" />
        )}
      </div>

      <div className={cn("max-w-[76%] space-y-1", self && "items-end text-right")}>
        {showSender && !self && (
          <p className="px-1 text-[11px] font-medium text-muted-foreground">
            {sender?.display_name ?? "Someone"}
          </p>
        )}

        <div className={cn("flex items-end gap-1", self ? "flex-row-reverse" : "flex-row")}>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              className="mb-1 shrink-0 rounded-full p-1.5 text-muted-foreground opacity-60 transition-opacity hover:bg-surface-2 hover:opacity-100 active:opacity-100"
            >
              <Reply className="size-3.5" />
            </button>
          )}

          <div
            ref={bubbleRef}
            className={cn(
              "message-bubble overflow-hidden rounded-2xl text-sm leading-relaxed",
              self
                ? "bg-bubble text-bubble-foreground rounded-br-md"
                : "bg-surface-2 text-foreground rounded-bl-md",
            )}
          >
            {replyPreview !== undefined && (
              <button
                type="button"
                onClick={onJumpToReply}
                className={cn(
                  "block w-full border-l-2 px-3 pt-2 pb-1 text-left text-xs opacity-80 hover:opacity-100",
                  self ? "border-bubble-foreground/40" : "border-foreground/30",
                )}
              >
                <span className="block font-medium">
                  {replyPreview?.senderName ?? "Original message"}
                </span>
                <span className="block truncate">
                  {replyPreview?.snippet ?? "This message is no longer available."}
                </span>
              </button>
            )}

            {message.image_url && (
              <img
                src={imageUrl ?? undefined}
                alt="Shared image"
                loading="lazy"
                className="max-h-72 w-full bg-surface object-cover"
              />
            )}
            {message.body && (
              <>
                <p className="px-3.5 py-2 whitespace-pre-wrap break-words">{renderLinkedMessage()}</p>
                {previewUrls.map((url) => {
                  const preview = previews[url];
                  if (!preview) return null;
                  return (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mx-2.5 mb-2.5 flex max-w-[22rem] items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-background/50 p-2 text-left transition-colors hover:bg-background/75"
                    >
                      {preview.image && !previewImageErrors[url] && (
                        <img
                          src={preview.image}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="size-16 shrink-0 rounded-lg bg-surface object-cover"
                          onError={() =>
                            setPreviewImageErrors((current) => ({ ...current, [url]: true }))
                          }
                        />
                      )}
                      <span className="min-w-0 flex-1 text-foreground">
                        <span className="block truncate text-xs font-semibold">
                          {preview.title || preview.siteName}
                        </span>
                        {preview.description && (
                          <span className="mt-0.5 line-clamp-2 block break-words text-[11px] leading-snug text-muted-foreground">
                            {preview.description}
                          </span>
                        )}
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">{preview.siteName}</span>
                      </span>
                    </a>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <p className={cn("flex items-center gap-1 px-1 text-[10px] text-muted-foreground", self && "justify-end")}>
          {time}
          {self && (
            <span className="inline-flex items-center gap-0.5" aria-label={receiptStatus} title={receiptStatus}>
              {readCount > 0 ? <CheckCheck className="size-3 text-primary" /> : deliveredCount > 0 ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
              {groupChat && messageReceipts.length > 1 ? <span>{receiptStatus.replace(/^Delivered /, "D ").replace(" · Read ", " · R ")}</span> : <span>{receiptStatus}</span>}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
