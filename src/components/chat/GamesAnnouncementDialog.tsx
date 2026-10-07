import { useEffect, useState } from "react";
import { Gamepad2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  userId: string;
};

const STORAGE_KEY_PREFIX = "zchat-games-announcement-v1:";

export function GamesAnnouncementDialog({ userId }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;

    try {
      if (window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`) === "1") return;
    } catch {
      // Keep the announcement available if browser storage is unavailable.
    }
    let observer: MutationObserver | undefined;
    const timer = window.setTimeout(() => {
      const showIfNoDialogIsOpen = () => {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return false;
        observer?.disconnect();
        setOpen(true);
        return true;
      };

      if (!showIfNoDialogIsOpen()) {
        observer = new MutationObserver(() => showIfNoDialogIsOpen());
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["data-state"],
          childList: true,
          subtree: true,
        });
      }
    }, 900);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [userId]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && userId) {
      try {
        window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, "1");
      } catch {
        // The dialog can still be dismissed when browser storage is unavailable.
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="discord-portal max-w-sm">
        <DialogHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Gamepad2 className="size-5" />
          </div>
          <DialogTitle className="font-display text-xl">
            THERE IS NOW GAMES IN Z CHAT
          </DialogTitle>
          <DialogDescription>
            Your games shortcut is ready. Here’s where to find it:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Desktop
            </p>
            <p className="mt-1 text-sm">Look at the bottom of the left sidebar.</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mobile / PWA
            </p>
            <p className="mt-1 text-sm">
              Tap the menu button in the top-left, then look at the bottom of the menu.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-semibold tracking-wide text-primary-foreground">
            <Gamepad2 className="size-4" />
            Z GAMES
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button className="w-full sm:w-auto">Got it</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
