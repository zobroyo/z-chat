import { useEffect, useState } from "react";
import { Download, Plus, Share, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isAppleTouchDevice, isInstalled } from "@/lib/notifications";

const DISMISS_KEY = "zchat-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Add to Home Screen" nudge. Shown to Apple touch devices in Safari (it opens
 * full-screen, gets an icon and — unlike a tab — can receive push alerts), and
 * to Chromium/Android via the native install prompt. Hidden once installed or
 * dismissed.
 */
export function InstallPrompt() {
  const [apple, setApple] = useState(false);
  const [installer, setInstaller] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isInstalled()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* private mode: still offer it */
    }

    if (isAppleTouchDevice()) {
      setApple(true);
      setVisible(true);
      return;
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstaller(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setVisible(false);
    setInstaller(null);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!installer) return;
    await installer.prompt();
    await installer.userChoice.catch(() => undefined);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-2 z-[90] flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 shadow-2xl"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      role="dialog"
      aria-label="Install Z Chat"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-lg font-extrabold text-primary-foreground">
        Z
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Install Z Chat</p>
        {apple ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Tap the <Share className="inline size-3.5 -translate-y-px" aria-label="Share" /> Share
            button, then{" "}
            <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
              <Plus className="size-3.5" aria-hidden /> Add to Home Screen
            </span>
            . It opens full-screen and can send you alerts.
          </p>
        ) : (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Add Z Chat to your home screen for the full app experience — full-screen and
            notifications.
          </p>
        )}

        {!apple && (
          <Button size="sm" className="mt-2 h-8" onClick={() => void install()}>
            <Download className="mr-1.5 size-3.5" />
            Install app
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
