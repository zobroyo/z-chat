import { Reply } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import { CHAT_BUCKET, useSignedUrl } from "@/lib/media";
import type { Message, Profile } from "@/lib/chat";
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
};

export function MessageBubble({
  message,
  self,
  sender,
  showSender,
  replyPreview,
  onReply,
  onJumpToReply,
}: Props) {
  const imageUrl = useSignedUrl(CHAT_BUCKET, message.image_url);
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group flex animate-in items-end gap-2 fade-in slide-in-from-bottom-1 duration-200",
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
            className={cn(
              "overflow-hidden rounded-2xl text-sm leading-relaxed",
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
              <p className="px-3.5 py-2 whitespace-pre-wrap break-words">{message.body}</p>
            )}
          </div>
        </div>

        <p className="px-1 text-[10px] text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
