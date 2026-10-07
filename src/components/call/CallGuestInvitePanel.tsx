import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";

type Props = {
  isHost: boolean;
  guestKey: string | null;
  conversationId: string | null;
  onEnsureKey: () => string | null;
};

/**
 * Shareable guest link panel: `<origin>/call/<conversationId>?k=<guestKey>`.
 * The host mints the key (lazily) and it is broadcast to the other members, so
 * any member can copy the same link. Guests themselves never see this panel.
 */
export function CallGuestInvitePanel({ isHost, guestKey, conversationId, onEnsureKey }: Props) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!guestKey && isHost) onEnsureKey();
  }, [guestKey, isHost, onEnsureKey]);

  const link =
    guestKey && conversationId && typeof window !== "undefined"
      ? `${window.location.origin}/call/${conversationId}?k=${encodeURIComponent(guestKey)}`
      : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
    }
  };

  return (
    <PopoverContent align="end" className="w-80">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        <Link2 className="size-3.5" />
        Guest join link
      </p>

      {link ? (
        <>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            Anyone with this link can join this call as a guest — no Z Chat account needed. They
            can only join this one call.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Input ref={inputRef} readOnly value={link} className="h-9 text-xs" />
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => void copy()}
              aria-label="Copy guest link"
              title="Copy guest link"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Keep it private: the link is the only thing guarding the call.
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {isHost
            ? "Preparing your link…"
            : "Waiting for the call host to enable guest invites."}
        </p>
      )}
    </PopoverContent>
  );
}
