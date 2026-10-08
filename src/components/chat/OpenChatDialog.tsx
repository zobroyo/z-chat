import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  OPEN_CHAT_MAX_LENGTH,
  fetchThreadMessages,
  sendThreadMessage,
  type OpenChatMessage,
} from "@/lib/appeals";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  meId?: string;
  isModerator?: boolean;
};

export function OpenChatDialog({ open, onOpenChange, userId, meId, isModerator = false }: Props) {
  const senderId = meId ?? userId;
  const [messages, setMessages] = useState<OpenChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setMessages(await fetchThreadMessages(userId));
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !userId) return;
    const channel = supabase
      .channel(`open-chat-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ban_appeal_messages",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const message = payload.new as OpenChatMessage;
          setMessages((current) =>
            current.some((item) => item.id === message.id) ? current : [...current, message],
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, userId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const message = await sendThreadMessage(userId, senderId, text, isModerator);
      setText("");
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Open chat</DialogTitle>
          <DialogDescription>
            {isModerator
              ? "Reply to this user about their ban. They can see everything here."
              : "You're banned, so you can't post in chats — but this channel stays open. Talk to the moderators about why you should be unbanned."}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={listRef}
          className="scroll-slim h-72 space-y-2 overflow-y-auto rounded-xl bg-surface-2 p-3"
        >
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Say why you think the ban should be lifted.
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  message.is_moderator
                    ? "bg-surface text-foreground"
                    : "ml-auto bg-primary text-primary-foreground",
                )}
              >
                {message.is_moderator && (
                  <p className="mb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Moderator
                  </p>
                )}
                <p className="whitespace-pre-wrap">{message.body}</p>
                <p
                  className={cn(
                    "mt-1 text-[10px]",
                    message.is_moderator ? "text-muted-foreground" : "text-primary-foreground/70",
                  )}
                >
                  {new Date(message.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={OPEN_CHAT_MAX_LENGTH}
            rows={2}
            placeholder="Explain why you should be unbanned…"
            className="resize-none rounded-xl border-border bg-surface-2"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {text.length}/{OPEN_CHAT_MAX_LENGTH}
            </span>
            <Button onClick={() => void send()} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
