import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Flag, Reply } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import { CHAT_BUCKET, useSignedUrl } from "@/lib/media";
import type { Message, MessageReceipt, Profile } from "@/lib/chat";
import { renderMessageBody } from "@/lib/messageFormat";
import {
  fetchLinkPreview,
  findMessageLinks,
  uniquePreviewUrls,
  type LinkPreview,
} from "@/lib/messageLinks";
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
  onReport?: (() => void) | undefined;
  onOpenProfile?: ((userId: string) => void) | undefined;
  onJumpToReply?: (() => void) | undefined;
  receipts?: MessageReceipt[] | undefined;
  groupChat?: boolean | undefined;
  animateIn?: boolean | undefined;
  mentionNames?: Record<string, string> | undefined;
};

export function MessageBubble({
  message,
  self,
  sender,
  showSender,
  replyPreview,
  onReply,
  onReport,
  onOpenProfile,
  onJumpToReply,
  receipts = [],
  groupChat = false,
  animateIn = false,
  mentionNames,
}: Props) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [previewIsVisible, setPreviewIsVisible] = useState(false);
  const [previews, setPreviews] = useState<Record<string, LinkPreview | null>>({});
  const [previewIconErrors, setPreviewIconErrors] = useState<Record<string, boolean>>({});
  const body = message.body ?? "";
  const links = useMemo(() => findMessageLinks(body), [body]);
  const previewUrls = useMemo(() => uniquePreviewUrls(links), [links]);
  const isLinkOnly = !message.image_url && links.length === 1 && body.trim() === links[0]?.text;
  const imageUrl = useSignedUrl(CHAT_BUCKET, message.image_url);
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "numeric",
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
    void Promise.all(
      previewUrls.map(async (url) => [url, await fetchLinkPreview(url)] as const),
    ).then((results) => {
      if (active) setPreviews((current) => ({ ...current, ...Object.fromEntries(results) }));
    });
    return () => {
      active = false;
    };
  }, [previewIsVisible, previewUrls]);

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group relative -mx-3 flex items-start gap-3 rounded px-3 py-0.5 transition-colors hover:bg-surface-2/40",
        showSender ? "mt-3" : "mt-0.5",
        animateIn && "message-enter",
      )}
    >
      <div className="w-10 shrink-0">
        {showSender && (
          <button
            type="button"
            onClick={() => onOpenProfile?.(message.sender_id)}
            aria-label={`View ${sender?.display_name ?? "member"} profile`}
            className="rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserAvatar name={sender?.display_name} path={sender?.avatar_url} className="size-10" />
          </button>
        )}
      </div>
      {!showSender && (
        <span className="pointer-events-none absolute top-0.5 left-3 w-10 pr-1 text-right text-[9px] leading-4 whitespace-nowrap text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {time}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {showSender && (
          <div className="flex items-center gap-2 px-0.5">
            <button
              type="button"
              onClick={() => onOpenProfile?.(message.sender_id)}
              className="text-[15px] font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sender?.display_name ?? "Someone"}
            </button>
            <span className="text-[11px] text-muted-foreground">{time}</span>
            {self && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
                aria-label={receiptStatus}
                title={receiptStatus}
              >
                {readCount > 0 ? (
                  <CheckCheck className="size-3 text-primary" />
                ) : deliveredCount > 0 ? (
                  <CheckCheck className="size-3" />
                ) : (
                  <Check className="size-3" />
                )}
                {groupChat && messageReceipts.length > 1 && (
                  <span>
                    {receiptStatus.replace(/^Delivered /, "D ").replace(" · Read ", " · R ")}
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        <div className="flex items-start gap-1">
          <div
            ref={bubbleRef}
            className={cn(
              "message-bubble min-w-0 flex-1 text-[15px] leading-relaxed text-foreground",
            )}
          >
            {replyPreview !== undefined && (
              <button
                type="button"
                onClick={onJumpToReply}
                className="mb-0.5 block w-full border-l-2 border-foreground/30 pl-2 text-left text-xs text-muted-foreground hover:text-foreground"
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
                className="mt-1 max-h-72 w-full rounded-xl bg-surface object-cover"
              />
            )}
            {message.body && (
              <>
                {!isLinkOnly && (
                  <div className="whitespace-pre-wrap break-words">
                    {" "}
                    {renderMessageBody(body, mentionNames)}
                  </div>
                )}
                {previewUrls.map((url) => {
                  const preview = previews[url];
                  if (!preview && !isLinkOnly) return null;
                  const hostname = new URL(url).hostname.replace(/^www\./, "");
                  return (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 flex max-w-[22rem] items-center gap-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 px-3 py-2.5 text-left text-foreground shadow-sm transition-colors hover:border-primary/35 hover:from-primary/20"
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/15 bg-background/70 text-primary shadow-sm">
                        {preview?.icon && !previewIconErrors[url] ? (
                          <img
                            src={preview.icon}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="size-7 object-contain"
                            onError={() =>
                              setPreviewIconErrors((current) => ({ ...current, [url]: true }))
                            }
                          />
                        ) : (
                          <span className="font-display text-lg font-bold">
                            {hostname.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-snug">
                          {preview?.title || preview?.siteName || hostname}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {hostname}
                        </span>
                      </span>
                    </a>
                  );
                })}
              </>
            )}
          </div>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              className="mt-1 shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100 active:opacity-100"
            >
              <Reply className="size-3.5" />
            </button>
          )}
          {onReport && !self && (
            <button
              type="button"
              onClick={onReport}
              aria-label="Report message"
              className="mt-1 shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100 active:opacity-100"
            >
              <Flag className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
