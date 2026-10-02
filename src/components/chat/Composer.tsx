import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, validateImage } from "@/lib/media";
import { cn } from "@/lib/utils";

type ReplyingTo = {
  senderName: string;
  snippet: string;
} | null;

type Props = {
  onSend: (body: string, file: File | null) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  placeholder?: string;
  replyingTo?: ReplyingTo;
  onCancelReply?: () => void;
};

export function Composer({ onSend, onTypingChange, placeholder, replyingTo, onCancelReply }: Props) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [visibleReply, setVisibleReply] = useState<ReplyingTo>(replyingTo ?? null);
  const [replyClosing, setReplyClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const replySenderName = replyingTo?.senderName;
  const replySnippet = replyingTo?.snippet;
  const replyPreview = replyingTo ?? visibleReply;

  useEffect(() => {
    if (replySenderName !== undefined && replySnippet !== undefined) {
      setVisibleReply((current) =>
        current?.senderName === replySenderName && current.snippet === replySnippet
          ? current
          : { senderName: replySenderName, snippet: replySnippet },
      );
      setReplyClosing(false);
      return;
    }

    setReplyClosing(true);
    const timer = window.setTimeout(() => {
      setVisibleReply(null);
      setReplyClosing(false);
    }, 130);
    return () => window.clearTimeout(timer);
  }, [replySenderName, replySnippet]);

  const clearFile = () => {
    setFile(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const submit = async () => {
    if (sending) return;
    if (!value.trim() && !file) return;

    const body = value;
    const pickedFile = file;
    const hasImage = Boolean(pickedFile);

    onTypingChange?.(false);
    // Clear immediately so the composer feels instant. Image sends still show
    // a brief sending state since the upload itself takes real time.
    setValue("");
    clearFile();
    onCancelReply?.();
    if (hasImage) setSending(true);

    try {
      await onSend(body, pickedFile);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message failed to send");
    } finally {
      if (hasImage) setSending(false);
    }
  };

  return (
    <div className="ios-safe-bottom shrink-0 border-t border-border bg-surface/80 px-3 py-3 backdrop-blur">
      {replyPreview && (
        <div
          className={cn(
            "mb-2 flex items-center justify-between gap-2 rounded-xl border-l-2 border-primary bg-surface-2 px-3 py-2",
            replyClosing ? "reply-preview-exit" : "message-reply-enter",
          )}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              Replying to {replyPreview.senderName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{replyPreview.snippet}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-surface active:scale-95"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {preview && (
        <div className="message-reply-enter relative mb-2 inline-block">
          <img src={preview} alt="Selected" className="h-20 rounded-xl object-cover" />
          <button
            type="button"
            onClick={clearFile}
            aria-label="Remove image"
            className="absolute -top-2 -right-2 rounded-full bg-surface-2 p-1 text-muted-foreground ring-1 ring-border transition-transform active:scale-90"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            if (!picked) return;
            try {
              validateImage(picked, MAX_IMAGE_BYTES);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "That file can't be used");
              clearFile();
              return;
            }
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = URL.createObjectURL(picked);
            setFile(picked);
            setPreview(previewUrlRef.current);
          }}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add image"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="size-5" />
        </Button>

        <Textarea
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            onTypingChange?.(Boolean(nextValue.trim()));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder ?? "Write a message"}
          style={{ fontSize: 16 }}
          className="max-h-32 min-h-11 resize-none rounded-2xl border-border bg-surface-2 md:text-base"
        />

        <Button type="submit" size="icon" aria-label="Send message" disabled={sending}>
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
