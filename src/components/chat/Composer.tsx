import { useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  onSend: (body: string, file: File | null) => Promise<void>;
  placeholder?: string;
};

export function Composer({ onSend, placeholder }: Props) {
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
    setSending(true);
    try {
      await onSend(value, file);
      setValue("");
      clearFile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border bg-surface/80 px-3 py-3 backdrop-blur">
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
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            if (!picked) return;
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
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder ?? "Write a message"}
          className="max-h-32 min-h-11 resize-none rounded-2xl border-border bg-surface-2"
        />

        <Button type="submit" size="icon" aria-label="Send message" disabled={sending}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
