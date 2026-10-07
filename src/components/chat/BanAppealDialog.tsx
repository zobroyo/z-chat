import { useCallback, useEffect, useState } from "react";
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
import { APPEAL_MAX_LENGTH, fetchMyAppeals, submitAppeal, type BanAppeal } from "@/lib/appeals";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
};

export function BanAppealDialog({ open, onOpenChange, userId }: Props) {
  const [appeals, setAppeals] = useState<BanAppeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setAppeals(await fetchMyAppeals(userId));
    } catch {
      setAppeals([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await submitAppeal(userId, message);
      setMessage("");
      toast.success("Appeal submitted — a moderator will review it");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send your appeal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="discord-portal max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Your account is banned</DialogTitle>
          <DialogDescription>
            You can&apos;t send messages while banned, but this channel stays open. Tell us what
            happened and a moderator will review your case.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="appeal-message" className="text-sm font-medium">
              Your appeal
            </label>
            <Textarea
              id="appeal-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={APPEAL_MAX_LENGTH}
              rows={4}
              placeholder="Explain why the ban was a mistake, or what you'd like reviewed…"
              className="resize-none rounded-xl border-border bg-surface-2"
            />
            <p className="text-right text-xs text-muted-foreground">
              {message.length}/{APPEAL_MAX_LENGTH}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Your appeals
            </p>

            {loading ? (
              <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </p>
            ) : appeals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No appeals yet. Messages you send here are visible to moderators.
              </p>
            ) : (
              <ul className="scroll-slim max-h-48 space-y-2 overflow-y-auto pr-1">
                {appeals.map((appeal) => (
                  <li key={appeal.id} className="rounded-xl bg-surface-2 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(appeal.created_at).toLocaleString()}
                      </span>
                      <span
                        className={
                          appeal.resolved
                            ? "rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary"
                            : "rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400"
                        }
                      >
                        {appeal.resolved ? "Reviewed" : "Under review"}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{appeal.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !message.trim()}>
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            Send appeal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
