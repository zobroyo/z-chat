import { useEffect, useMemo, useState } from "react";
import { Apple, ChevronLeft, ChevronRight, Download, Monitor, Smartphone, Tablet } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const WINDOWS_ZIP = "https://z-chat.men/media/downloads/ZChat-windows.zip?v=1";
const WINDOWS_EXE = "https://z-chat.men/media/downloads/ZChat.exe?v=1";

type Platform = "windows" | "macos" | "ios" | "android";
type Browser = "safari" | "chrome" | "firefox" | "samsung" | "edge" | "other";

const PLATFORMS: {
  id: Platform;
  name: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "windows", name: "Windows", hint: "Desktop app (zip / .exe)", icon: Monitor },
  { id: "macos", name: "macOS", hint: "Coming soon", icon: Apple },
  { id: "ios", name: "iPhone / iPad", hint: "Install as an app (PWA)", icon: Smartphone },
  { id: "android", name: "Android", hint: "Install as an app (PWA)", icon: Tablet },
];

function detectPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return null;
}

function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Edg\//i.test(ua)) return "edge";
  if (/Firefox|FxiOS/i.test(ua)) return "firefox";
  if (/CriOS|Chrome/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua)) return "safari";
  return "other";
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 text-sm text-foreground">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
            {index + 1}
          </span>
          <span className="min-w-0 leading-5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function PlatformDetail({
  platform,
  browser,
  onBack,
}: {
  platform: Platform;
  browser: Browser;
  onBack: () => void;
}) {
  const back = (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" />
      All platforms
    </button>
  );

  if (platform === "windows") {
    return (
      <div>
        {back}
        <div className="mt-1 flex flex-col gap-2">
          <a
            href={WINDOWS_ZIP}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-105"
          >
            <Download className="size-4" />
            Download for Windows (zip)
          </a>
          <a
            href={WINDOWS_EXE}
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            just ZChat.exe
          </a>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          No installer needed — unzip the folder and run <strong>ZChat.exe</strong>. Same chats, in a
          native window.
        </p>
      </div>
    );
  }

  if (platform === "macos") {
    return (
      <div>
        {back}
        <p className="mt-1 text-sm font-semibold text-foreground">Coming soon</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          The macOS app isn&apos;t ready yet. In the meantime, Z Chat works great in Safari or Chrome
          on your Mac.
        </p>
      </div>
    );
  }

  if (platform === "ios") {
    const safariFirst = browser !== "safari";
    return (
      <div>
        {back}
        <p className="mt-1 text-sm font-semibold text-foreground">Add Z Chat to your Home Screen</p>
        {safariFirst && (
          <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-500 dark:text-amber-300">
            On iPhone, only <strong>Safari</strong> can install apps. Open <strong>z-chat.men</strong>{" "}
            in Safari first, then follow the steps.
          </p>
        )}
        <div className="mt-3">
          <Steps
            items={[
              "Open z-chat.men in Safari.",
              "Tap the Share button (the square with an arrow pointing up).",
              "Scroll down and tap “Add to Home Screen”.",
              "Tap “Add” — Z Chat appears on your Home Screen and opens full-screen.",
            ]}
          />
        </div>
      </div>
    );
  }

  // android
  const chromeSteps = [
    "Open z-chat.men in Chrome.",
    "Tap the ⋮ menu (top-right).",
    "Tap “Install app” (or “Add to Home screen”).",
    "Confirm — Z Chat appears in your app drawer.",
  ];
  const samsungSteps = [
    "Open z-chat.men in Samsung Internet.",
    "Tap the ☰ menu (bottom-right).",
    "Tap “Add page to” → “Home screen”.",
    "Confirm — Z Chat is added like an app.",
  ];
  const firefoxSteps = [
    "Open z-chat.men in Firefox.",
    "Tap the ⋮ menu.",
    "Tap “Install”.",
    "Confirm — Z Chat is added to your Home Screen.",
  ];
  const steps =
    browser === "samsung"
      ? samsungSteps
      : browser === "firefox"
        ? firefoxSteps
        : chromeSteps;

  return (
    <div>
      {back}
      <p className="mt-1 text-sm font-semibold text-foreground">Install Z Chat on Android</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {browser === "samsung"
          ? "Samsung Internet"
          : browser === "firefox"
            ? "Firefox"
            : "Chrome / most browsers"}
      </p>
      <div className="mt-3">
        <Steps items={steps} />
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
        In another browser? Look for <strong>Install app</strong> or <strong>Add to Home screen</strong>{" "}
        in its menu.
      </p>
    </div>
  );
}

/** Controlled platform-picker dialog: Windows / macOS / iPhone / Android. */
export function DownloadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const detected = useMemo(() => detectPlatform(), []);
  const browser = useMemo(() => detectBrowser(), []);

  // Always start on the chooser.
  useEffect(() => {
    if (open) setPlatform(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{platform ? "Download Z Chat" : "Get Z Chat"}</DialogTitle>
          <DialogDescription>
            {platform
              ? "Follow the steps for your device below."
              : "Choose your device to download the app or install it as an app."}
          </DialogDescription>
        </DialogHeader>

        {platform === null ? (
          <div className="grid gap-2">
            {PLATFORMS.map((entry) => {
              const Icon = entry.icon;
              const isThisDevice = entry.id === detected;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setPlatform(entry.id)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{entry.name}</span>
                      {isThisDevice && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                          Your device
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{entry.hint}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        ) : (
          <PlatformDetail platform={platform} browser={browser} onBack={() => setPlatform(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Download" button that opens the platform picker. `className` styles the
 * trigger so it can match the primary sidebar button or the services panel.
 */
export function DownloadButton({
  className,
  children,
  "aria-label": ariaLabel,
}: {
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={cn(className)} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {children}
      </button>
      <DownloadDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
