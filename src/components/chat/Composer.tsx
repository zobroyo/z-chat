import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, ImagePlus, Loader2, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, validateImage } from "@/lib/media";
import { cn } from "@/lib/utils";

type ReplyingTo = {
  senderName: string;
  snippet: string;
} | null;

type MentionOption = { kind: "person"; id: string; name: string } | { kind: "time"; label: string };

type Props = {
  onSend: (body: string, file: File | null) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  placeholder?: string;
  replyingTo?: ReplyingTo;
  onCancelReply?: () => void;
  mentionCandidates?: Array<{ id: string; name: string }>;
};

export function Composer({
  onSend,
  onTypingChange,
  placeholder,
  replyingTo,
  onCancelReply,
  mentionCandidates = [],
}: Props) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [visibleReply, setVisibleReply] = useState<ReplyingTo>(replyingTo ?? null);
  const [replyClosing, setReplyClosing] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const replySenderName = replyingTo?.senderName;
  const replySnippet = replyingTo?.snippet;
  const replyPreview = replyingTo ?? visibleReply;

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const query = (mention?.query ?? "").toLowerCase();
    const people = mentionCandidates
      .filter((candidate) => candidate.name.toLowerCase().includes(query))
      .slice(0, 6)
      .map((candidate) => ({ kind: "person" as const, id: candidate.id, name: candidate.name }));
    const time =
      mention && "time".startsWith(query) && query.length <= 4
        ? [{ kind: "time" as const, label: "Time" }]
        : [];
    return [...people, ...time];
  }, [mentionCandidates, mention]);

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,32})$/.exec(before);
    if (!match) return null;
    const query = match[2] ?? "";
    return { query, start: caret - query.length - 1 };
  };

  const insertMention = (option: MentionOption) => {
    const textarea = textareaRef.current;
    if (!textarea || !mention) return;
    const token =
      option.kind === "time" ? `<t:${Math.floor(Date.now() / 1000)}>` : `<@${option.id}>`;
    const caret = textarea.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}${token} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      textarea.focus();
      const position = mention.start + token.length + 1;
      textarea.setSelectionRange(position, position);
    });
  };

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

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const submit = async () => {
    if (sending) return;
    if (!value.trim() && !file) return;
    setMention(null);

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
    <div className="ios-safe-bottom relative shrink-0 bg-chat px-4 pt-1 pb-4">
      {replyPreview && (
        <div
          className={cn(
            "mb-2 flex items-center justify-between gap-2 rounded-md border-l-4 border-blurple bg-elevated px-3 py-2",
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
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-rail hover:text-foreground active:scale-95"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {preview && (
        <div className="message-reply-enter relative mb-2 inline-block">
          <img src={preview} alt="Selected" className="h-20 rounded-lg object-cover" />
          <button
            type="button"
            onClick={clearFile}
            aria-label="Remove image"
            className="absolute -top-2 -right-2 rounded-full bg-rail p-1 text-muted-foreground ring-1 ring-black/30 transition-transform hover:text-foreground active:scale-90"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {mention && mentionOptions.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-md border border-black/30 bg-rail shadow-xl">
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            {mentionOptions.some((option) => option.kind === "time") ? "Members & Time" : "Members"}
          </p>
          {mentionOptions.map((option, index) => (
            <button
              key={option.kind === "time" ? "time" : option.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(option)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                index === mentionIndex
                  ? "bg-blurple/20 text-foreground"
                  : "text-muted-foreground hover:bg-elevated",
              )}
            >
              {option.kind === "time" ? (
                <>
                  <Clock className="size-3.5" />
                  <span>@time</span>
                  <span className="text-[11px] text-muted-foreground">live timestamp</span>
                </>
              ) : (
                <>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blurple/20 text-[10px] font-bold text-blurple">
                    {option.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{option.name}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 rounded-lg bg-elevated px-3 py-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-blurple/50"
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

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            onTypingChange?.(Boolean(nextValue.trim()));
            const caret = event.target.selectionStart ?? nextValue.length;
            setMention(detectMention(nextValue, caret));
            setMentionIndex(0);
          }}
          onKeyDown={(event) => {
            if (mention && mentionOptions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex((index) => (index + 1) % mentionOptions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (index) => (index - 1 + mentionOptions.length) % mentionOptions.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(mentionOptions[mentionIndex] ?? mentionOptions[0]!);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          onBlur={() => setMention(null)}
          rows={1}
          maxLength={2000}
          placeholder={placeholder ?? "Write a message"}
          style={{ fontSize: 16 }}
          className="max-h-32 min-h-11 resize-none border-0 bg-transparent px-0 py-2.5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-base"
        />

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Add image"
            onClick={() => inputRef.current?.click()}
            className="text-muted-foreground hover:bg-rail hover:text-foreground"
          >
            <ImagePlus className="size-5" />
          </Button>

          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={sending}
            className="bg-blurple text-white hover:bg-blurple-hover"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SendHorizontal className="size-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
