import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, ImagePlus, Loader2, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { exactEmoji, searchEmoji, type EmojiMatch } from "@/lib/emoji";
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
  /**
   * Handles the `/call` slash command: starts/joins the call for the open
   * conversation and shares the guest invite link.
   */
  onCallCommand?: () => void | Promise<void>;
};

export function Composer({
  onSend,
  onTypingChange,
  placeholder,
  replyingTo,
  onCancelReply,
  mentionCandidates = [],
  onCallCommand,
}: Props) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [visibleReply, setVisibleReply] = useState<ReplyingTo>(replyingTo ?? null);
  const [replyClosing, setReplyClosing] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emoji, setEmoji] = useState<{ query: string; start: number } | null>(null);
  const [emojiIndex, setEmojiIndex] = useState(0);
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

  const emojiOptions = useMemo<EmojiMatch[]>(
    () => (emoji ? searchEmoji(emoji.query) : []),
    [emoji],
  );

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,32})$/.exec(before);
    if (!match) return null;
    const query = match[2] ?? "";
    return { query, start: caret - query.length - 1 };
  };

  const detectEmoji = (text: string, caret: number) => {
    const before = text.slice(0, caret).toLowerCase();
    const match = /(^|\s):([a-z0-9_+-]{1,32})$/.exec(before);
    if (!match) return null;
    const query = match[2] ?? "";
    return { query, start: caret - query.length - 1 };
  };

  const insertEmoji = (option: EmojiMatch) => {
    const textarea = textareaRef.current;
    if (!textarea || !emoji) return;
    const caret = textarea.selectionStart ?? value.length;
    const insert = `${option.emoji} `;
    const next = `${value.slice(0, emoji.start)}${insert}${value.slice(caret)}`;
    setValue(next);
    setEmoji(null);
    requestAnimationFrame(() => {
      textarea.focus();
      const position = emoji.start + insert.length;
      textarea.setSelectionRange(position, position);
    });
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

    // Slash command: `/call` starts (or joins) the call for this conversation
    // and copies a shareable guest link instead of sending a message.
    if (value.trim().toLowerCase() === "/call" && onCallCommand) {
      setMention(null);
      setEmoji(null);
      setValue("");
      clearFile();
      onTypingChange?.(false);
      onCancelReply?.();
      try {
        await onCallCommand();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not start the call");
      }
      return;
    }

    if (!value.trim() && !file) return;
    setMention(null);
    setEmoji(null);

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
    <div className="ios-safe-bottom relative shrink-0 border-t border-border bg-surface/80 px-3 py-3 backdrop-blur">
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
          <img src={preview} alt="Selected" className="h-20 rounded-xl object-contain" />
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

      {mention && mentionOptions.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-xl">
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
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-surface",
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
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                    {option.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{option.name}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {emoji && emojiOptions.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-xl">
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            Emoji · Tab to insert
          </p>
          {emojiOptions.map((option, index) => (
            <button
              key={option.name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertEmoji(option)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                index === emojiIndex
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-surface",
              )}
            >
              <span className="text-base leading-none">{option.emoji}</span>
              <span className="truncate">:{option.name}:</span>
            </button>
          ))}
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
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            onTypingChange?.(Boolean(nextValue.trim()));
            const caret = event.target.selectionStart ?? nextValue.length;
            setMention(detectMention(nextValue, caret));
            setMentionIndex(0);
            setEmoji(detectEmoji(nextValue, caret));
            setEmojiIndex(0);
          }}
          onKeyDown={(event) => {
            if (emoji && emojiOptions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setEmojiIndex((index) => (index + 1) % emojiOptions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setEmojiIndex((index) => (index - 1 + emojiOptions.length) % emojiOptions.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertEmoji(emojiOptions[emojiIndex] ?? emojiOptions[0]!);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setEmoji(null);
                return;
              }
            }
            if (event.key === "Tab") {
              // Full shortcode already typed (":sob:") -> Tab turns it into 😭.
              const caret = textareaRef.current?.selectionStart ?? value.length;
              const complete = /(^|\s):([a-z0-9_+-]{1,32}):$/.exec(value.slice(0, caret).toLowerCase());
              const name = complete?.[2];
              if (name) {
                const found = exactEmoji(name);
                if (found) {
                  event.preventDefault();
                  const start = caret - name.length - 2;
                  const next = `${value.slice(0, start)}${found} ${value.slice(caret)}`;
                  setValue(next);
                  setEmoji(null);
                  requestAnimationFrame(() => {
                    const textarea = textareaRef.current;
                    if (!textarea) return;
                    textarea.focus();
                    const position = start + found.length + 1;
                    textarea.setSelectionRange(position, position);
                  });
                  return;
                }
              }
            }
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
          onBlur={() => {
            setMention(null);
            setEmoji(null);
          }}
          rows={1}
          maxLength={2000}
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
