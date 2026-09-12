
import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Plus, Share } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  getNotificationState,
  isInstalled,
  isTouchDevice,
  needsHomeScreenFirst,
  registerNotificationWorker,
  requestNotificationPermission,
  subscribeToPush,
  type NotificationState,
} from "@/lib/notifications";

/**
 * Shows the alerts prompt every time the app opens until alerts are on.
 * Declining never hides the bell — it stays available for accidental taps.
 */
const PROMPTED_KEY = "zchat-alerts-prompted";

function NotificationGate({ userId }: { userId?: string }) {
  const [state, setState] = useState<NotificationState>("default");
  const [open, setOpen] = useState(false);
  const [touch, setTouch] = useState(false);
  const [installNeeded, setInstallNeeded] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const current = getNotificationState();

    setState(current);
    setTouch(isTouchDevice());
    setInstallNeeded(needsHomeScreenFirst());
    setInstalled(isInstalled());

    void registerNotificationWorker();

    if (current === "granted" && userId) {
      void subscribeToPush(userId, supabase).catch((error) => {
        console.error("[NotificationGate] Failed to subscribe:", error);
      });
    }

    const alreadyAsked =
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(PROMPTED_KEY) === "1";

    if (current !== "granted" && !alreadyAsked) {
      try {
        sessionStorage.setItem(PROMPTED_KEY, "1");
      } catch {
        /* private mode: prompt just once per mount instead */
      }
      const timer = window.setTimeout(() => setOpen(true), 600);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [userId]);


  const ask = async () => {
    const next = await requestNotificationPermission();

    setState(next);

    if (next === "granted") {
      setOpen(false);

      if (userId) {
        try {
          await subscribeToPush(userId, supabase);
          console.log("[NotificationGate] Push subscription saved");
        } catch (error) {
          console.error(
            "[NotificationGate] Failed to save push subscription:",
            error,
          );
        }
      }
    }
  };

  const on = state === "granted";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={on ? "Alerts are on" : "Turn on alerts"}
        onClick={() => setOpen(true)}
        className={on ? "text-online" : "text-muted-foreground"}
      >
        {on ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <span className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Bell className="size-5" />
            </span>

            <DialogTitle className="font-display text-xl">
              Never miss a message
            </DialogTitle>

            <DialogDescription>
              {on
                ? "Alerts are on for this device."
                : "Turn on alerts and ZChat will ping you the moment someone writes."}
            </DialogDescription>
          </DialogHeader>

          {!on && installNeeded && (
            <ol className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
              <li className="flex gap-3">
                <span className="mt-0.5 text-muted-foreground">
                  <Share className="size-4" />
                </span>
                <span>
                  Tap <strong>Share</strong> in your browser bar.
                </span>
              </li>

              <li className="flex gap-3">
                <span className="mt-0.5 text-muted-foreground">
                  <Plus className="size-4" />
                </span>
                <span>
                  Choose <strong>Add to Home Screen</strong>.
                </span>
              </li>

              <li className="flex gap-3">
                <span className="mt-0.5 text-muted-foreground">
                  <Check className="size-4" />
                </span>
                <span>
                  Open ZChat from your home screen, then tap{" "}
                  <strong>Allow</strong> here.
                </span>
              </li>
            </ol>
          )}

          {!on && !installNeeded && touch && !installed && (
            <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">
              Tip: add ZChat to your home screen from your browser menu so it
              opens like a real app.
            </p>
          )}

          {state === "denied" && (
            <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">
              Alerts are blocked in your device settings for this site. Allow
              notifications there, then tap Allow again.
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {installNeeded && !on ? "Got it" : "Not now"}
            </Button>

            {!on && !installNeeded && (
              <Button type="button" onClick={ask}>
                Allow alerts
              </Button>
            )}
          </DialogFooter>

        </DialogContent>
      </Dialog>
    </>
  );
}
export { NotificationGate };


