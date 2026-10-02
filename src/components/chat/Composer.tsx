import { useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, validateImage } from "@/lib/media";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const clearFile = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

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
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border-l-2 border-primary bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              Replying to {replyingTo.senderName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{replyingTo.snippet}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-surface"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {preview && (
        <div className="relative mb-2 inline-block">
          <img src={preview} alt="Selected" className="h-20 rounded-xl object-cover" />
          <button
            type="button"
            onClick={clearFile}
            aria-label="Remove image"
            className="absolute -top-2 -right-2 rounded-full bg-surface-2 p-1 text-muted-foreground ring-1 ring-border"
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
            setFile(picked);
            setPreview(URL.createObjectURL(picked));
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
