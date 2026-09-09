import { UserAvatar } from "@/components/UserAvatar";
import { CHAT_BUCKET, useSignedUrl } from "@/lib/media";
import type { Message, Profile } from "@/lib/chat";
import { cn } from "@/lib/utils";

type Props = {
  message: Message;
  self: boolean;
  sender: Profile | undefined;
  showSender: boolean;
};

export function MessageBubble({ message, self, sender, showSender }: Props) {
  const imageUrl = useSignedUrl(CHAT_BUCKET, message.image_url);
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex items-end gap-2", self ? "flex-row-reverse" : "flex-row")}>
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
        <div
          className={cn(
            "overflow-hidden rounded-2xl text-sm leading-relaxed",
            self
              ? "bg-bubble text-bubble-foreground rounded-br-md"
              : "bg-surface-2 text-foreground rounded-bl-md",
          )}
        >
          {message.image_url && (
            <img
              src={imageUrl ?? undefined}
              alt="Shared image"
              loading="lazy"
              className="max-h-72 w-full bg-surface object-cover"
            />
          )}
          {message.body && <p className="px-3.5 py-2 whitespace-pre-wrap break-words">{message.body}</p>}
        </div>
        <p className="px-1 text-[10px] text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
