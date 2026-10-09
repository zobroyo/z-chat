import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, CreditCard, ImagePlus, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { CardCropDialog } from "@/components/lunch-card/CardCropDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, uploadLunchCardImage, validateImage } from "@/lib/media";

export const Route = createFileRoute("/lunch-card")({
  component: LunchCardPage,
});

const PRICE_AED = 35;

type Side = { blob: Blob | null; url: string | null };

function CardFace({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lift"
        style={{ aspectRatio: "85.6 / 54" }}
      >
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <ImagePlus className="size-5" />
            <span>{label}</span>
          </div>
        )}
      </div>
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

function LunchCardPage() {
  const { user, loading } = useAuth();
  const [front, setFront] = useState<Side>({ blob: null, url: null });
  const [back, setBack] = useState<Side>({ blob: null, url: null });
  const [crop, setCrop] = useState<{ file: File; side: "front" | "back" } | null>(null);
  const [fullName, setFullName] = useState("");
  const [studentClass, setStudentClass] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingArea, setMeetingArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const frontInput = useRef<HTMLInputElement>(null);
  const backInput = useRef<HTMLInputElement>(null);

  const setSide = (side: "front" | "back", blob: Blob) => {
    const url = URL.createObjectURL(blob);
    if (side === "front") {
      if (front.url) URL.revokeObjectURL(front.url);
      setFront({ blob, url });
    } else {
      if (back.url) URL.revokeObjectURL(back.url);
      setBack({ blob, url });
    }
  };

  const pick = (side: "front" | "back", file: File | null) => {
    if (!file) return;
    try {
      validateImage(file, MAX_IMAGE_BYTES);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That image can't be used");
      return;
    }
    setCrop({ file, side });
  };

  // Stripe redirects back with ?lc_session=<id>; confirm + notify the admin.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("lc_cancel")) toast.info("Payment cancelled");
    const session = params.get("lc_session");
    if (!session || !user) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const response = await fetch("/api/lunch-card/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ session_id: session }),
        });
        if (!response.ok) throw new Error("confirm_failed");
        if (!cancelled) {
          setDone(true);
          window.history.replaceState({}, "", "/lunch-card");
        }
      } catch {
        toast.error("We couldn't confirm the payment. Please contact us.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const ready = Boolean(
    front.blob &&
      back.blob &&
      fullName.trim() &&
      studentClass.trim() &&
      meetingTime.trim() &&
      meetingArea.trim(),
  );

  const order = async () => {
    if (!user || !ready || busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again");
      const frontPath = await uploadLunchCardImage(
        user.id,
        "front",
        new File([front.blob!], "front.png", { type: "image/png" }),
      );
      const backPath = await uploadLunchCardImage(
        user.id,
        "back",
        new File([back.blob!], "back.png", { type: "image/png" }),
      );
      const response = await fetch("/api/lunch-card/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          full_name: fullName.trim(),
          student_class: studentClass.trim(),
          meeting_time: meetingTime.trim(),
          meeting_area: meetingArea.trim(),
          front_url: frontPath,
          back_url: backPath,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "checkout_failed");
      window.location.assign(payload.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start checkout");
      setBusy(false);
    }
  };

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto min-h-screen w-full max-w-md px-5 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/chat">←</Link>
        </Button>
        <h1 className="font-display text-xl font-bold">Custom lunch card</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : done ? (
        <div className="surface-panel rounded-3xl p-6 text-center shadow-lift">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-green-500/15 text-green-500">
            <Check className="size-6" />
          </div>
          <h2 className="font-display text-lg font-bold">Order placed!</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks — your custom lunch card order is confirmed and the team has been notified. They
            will reach out to arrange handover at your meeting time and area.
          </p>
        </div>
      ) : !user ? (
        <p className="text-sm text-muted-foreground">Please sign in to order a lunch card.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Add a photo for the front and the back, fill in the details, and pay{" "}
            <span className="font-semibold text-foreground">{PRICE_AED} AED</span>. Includes a{" "}
            <span className="font-semibold text-foreground">2 month warranty</span>.
          </p>

          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Your card</h2>
            <div className="grid grid-cols-2 gap-3">
              <CardFace label="Front" url={front.url} />
              <CardFace label="Back" url={back.url} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => frontInput.current?.click()}
              >
                {front.url ? "Change front" : "Add front"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => backInput.current?.click()}
              >
                {back.url ? "Change back" : "Add back"}
              </Button>
            </div>
            <input
              ref={frontInput}
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                pick("front", e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <input
              ref={backInput}
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                pick("back", e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </section>

          <section className="mb-5 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Details</h2>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Full name</span>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Class</span>
              <Input value={studentClass} onChange={(e) => setStudentClass(e.target.value)} placeholder="e.g. 8B" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Meeting time <em className="text-muted-foreground/80">(must be during school break)</em>
              </span>
              <Input value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} placeholder="e.g. 11:00 break" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Meeting area</span>
              <Input value={meetingArea} onChange={(e) => setMeetingArea(e.target.value)} placeholder="e.g. canteen entrance" />
            </label>
          </section>

          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-green-500" />
            2 month warranty on every card
          </div>

          <Button className="w-full" disabled={!ready || busy} onClick={() => void order()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CreditCard className="mr-2 size-4" />}
            Order · {PRICE_AED} AED
          </Button>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Secure payment by card. After payment we send your two photos and details to the team.
          </p>
        </>
      )}

      <CardCropDialog
        file={crop?.file ?? null}
        open={Boolean(crop)}
        sideLabel={crop?.side === "front" ? "front" : "back"}
        onOpenChange={(open) => {
          if (!open) setCrop(null);
        }}
        onApply={(blob) => {
          if (crop) setSide(crop.side, blob);
          setCrop(null);
        }}
      />
    </main>
  );
}
