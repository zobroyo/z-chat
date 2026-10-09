import { useEffect, useState } from "react";
import { BadgeCheck, Crown, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type PlanId = "free" | "pro" | "max";

const PLANS: Array<{
  id: PlanId;
  name: string;
  price: string;
  tagline: string;
  icon: React.ReactNode;
  perks: string[];
}> = [
  {
    id: "free",
    name: "Free",
    price: "0 AED",
    tagline: "Everything Z Chat has today.",
    icon: <Sparkles className="size-4" />,
    perks: ["Chats, groups and calls", "Games, slides and all services", "Standard call quality"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "10 AED / month",
    tagline: "For regulars who want to give back.",
    icon: <BadgeCheck className="size-4" />,
    perks: ["Everything in Free", "Pro supporter badge on your profile", "Priority for new features"],
  },
  {
    id: "max",
    name: "Max",
    price: "15 AED / month",
    tagline: "Maximum support for the black box.",
    icon: <Crown className="size-4" />,
    perks: ["Everything in Pro", "Max supporter badge", "First in line for experiments"],
  },
];

async function callBilling(path: "checkout" | "portal", plan?: PlanId) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const response = await fetch(`/api/stripe/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(plan ? { plan } : {}),
  });
  const payload = (await response.json().catch(() => null)) as {
    url?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.url) {
    const reason = payload?.error;
    if (reason === "billing_not_configured") {
      throw new Error("Billing isn't switched on yet — the owner needs to run the Stripe setup.");
    }
    if (reason === "no_customer") throw new Error("No subscription found on this account yet.");
    throw new Error(reason || "Billing request failed");
  }
  return payload.url;
}

/** Plans & billing card on the profile page. */
export function BillingPlans() {
  const [plan, setPlan] = useState<PlanId>("free");
  const [status, setStatus] = useState<string | null>(null);
  const [renewsAt, setRenewsAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from("profiles")
      .select("plan, plan_status, plan_renews_at")
      .eq("id", userId)
      .maybeSingle();
    const row = data as { plan?: string; plan_status?: string | null; plan_renews_at?: string | null } | null;
    setPlan((row?.plan as PlanId | undefined) ?? "free");
    setStatus(row?.plan_status ?? null);
    setRenewsAt(row?.plan_renews_at ?? null);
  };

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      toast.success("Subscription started — syncing your plan…");
      const timer = window.setTimeout(() => void load(), 4000);
      return () => window.clearTimeout(timer);
    }
    if (params.get("billing") === "cancelled") {
      toast.info("Checkout cancelled");
    }
    return undefined;
  }, []);

  const upgrade = async (target: PlanId) => {
    setBusy(target);
    try {
      const url = await callBilling("checkout", target);
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
      setBusy(null);
    }
  };

  const manage = async () => {
    setBusy("portal");
    try {
      const url = await callBilling("portal");
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open billing");
      setBusy(null);
    }
  };

  return (
    <section className="mb-5" aria-labelledby="billing-title">
      <h2 id="billing-title" className="mb-3 px-1 text-sm font-semibold text-muted-foreground">
        Plans
      </h2>
      <div className="space-y-3">
        {PLANS.map((entry) => {
          const current = entry.id === plan;
          return (
            <div
              key={entry.id}
              className={cn(
                "surface-panel rounded-2xl p-4 shadow-lift",
                current && "border-primary/50",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground",
                      current && "bg-primary text-primary-foreground",
                    )}
                  >
                    {entry.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      {entry.name}
                      {current && (
                        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                          Current
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{entry.price}</p>
                  </div>
                </div>
                {current ? (
                  entry.id !== "free" ? (
                    <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void manage()}>
                      {busy === "portal" ? "Opening…" : "Manage billing"}
                    </Button>
                  ) : null
                ) : (
                  <Button size="sm" disabled={busy !== null} onClick={() => void upgrade(entry.id)}>
                    {busy === entry.id ? "Opening…" : entry.id === "max" ? "Get Max" : `Get ${entry.name}`}
                  </Button>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{entry.tagline}</p>
              <ul className="mt-2 space-y-1">
                {entry.perks.map((perk) => (
                  <li key={perk} className="flex items-center gap-1.5 text-xs text-foreground/80">
                    <BadgeCheck className="size-3.5 shrink-0 text-primary" />
                    {perk}
                  </li>
                ))}
              </ul>
              {current && entry.id !== "free" && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {status ? `Status: ${status}` : ""}
                  {renewsAt ? ` · Renews ${new Date(renewsAt).toLocaleDateString()}` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
