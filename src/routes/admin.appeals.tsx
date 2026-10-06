import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { fetchAllAppeals, setAppealResolved, type AdminBanAppeal } from "@/lib/appeals";
import { setUserBanned } from "@/lib/admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/appeals")({
  component: AdminAppealsPage,
});

type Filter = "open" | "resolved" | "all";

function AdminAppealsPage() {
  const [appeals, setAppeals] = useState<AdminBanAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAppeals(await fetchAllAppeals());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load appeals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleResolved = async (appeal: AdminBanAppeal) => {
    setBusyId(appeal.id);
    try {
      const next = !appeal.resolved;
      await setAppealResolved(appeal.id, next);
      setAppeals((current) =>
        current.map((item) => (item.id === appeal.id ? { ...item, resolved: next } : item)),
      );
      toast.success(next ? "Appeal marked as reviewed" : "Appeal reopened");
    } catch {
      toast.error("Could not update that appeal");
    } finally {
      setBusyId(null);
    }
  };

  const toggleBan = async (appeal: AdminBanAppeal) => {
    const name = appeal.display_name ?? "this user";
    const next = !appeal.user_banned;
    if (
      !window.confirm(next ? `Ban ${name}?` : `Unban ${name}? They will be able to message again.`)
    ) {
      return;
    }
    setBusyId(appeal.id);
    try {
      await setUserBanned(appeal.user_id, next);
      setAppeals((current) =>
        current.map((item) =>
          item.user_id === appeal.user_id ? { ...item, user_banned: next } : item,
        ),
      );
      toast.success(next ? `${name} banned` : `${name} unbanned`);
    } catch {
      toast.error("Could not change that ban");
    } finally {
      setBusyId(null);
    }
  };

  const visible = appeals.filter((appeal) =>
    filter === "all" ? true : filter === "open" ? !appeal.resolved : appeal.resolved,
  );

  const openCount = appeals.filter((appeal) => !appeal.resolved).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold">Ban appeals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages from banned users — this is the channel they can still write to.
          {openCount > 0 && (
            <span className="ml-1.5 font-medium text-foreground">{openCount} open</span>
          )}
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            { value: "open", label: "Open" },
            { value: "resolved", label: "Reviewed" },
            { value: "all", label: "All" },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={filter === tab.value ? "default" : "outline"}
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading appeals…
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface/50 px-4 py-10 text-center">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filter === "open" ? "No open appeals. All caught up." : "Nothing here yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((appeal) => (
            <li
              key={appeal.id}
              className="rounded-xl border border-border bg-surface/50 p-4 shadow-sm"
            >
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <UserAvatar
                  name={appeal.display_name ?? undefined}
                  path={appeal.avatar_url}
                  className="size-8"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {appeal.display_name ?? "Unknown user"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(appeal.created_at).toLocaleString()}
                  </p>
                </div>

                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase",
                    appeal.resolved
                      ? "bg-primary/15 text-primary"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {appeal.resolved ? "Reviewed" : "Open"}
                </span>

                {appeal.user_banned && (
                  <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-destructive">
                    <ShieldAlert className="size-3" />
                    Banned
                  </span>
                )}
              </div>

              <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">
                {appeal.message}
              </p>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === appeal.id}
                  onClick={() => void toggleResolved(appeal)}
                >
                  {appeal.resolved ? (
                    <>
                      <RotateCcw className="mr-1.5 size-4" />
                      Reopen
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1.5 size-4" />
                      Mark reviewed
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant={appeal.user_banned ? "default" : "destructive"}
                  disabled={busyId === appeal.id}
                  onClick={() => void toggleBan(appeal)}
                >
                  {appeal.user_banned ? (
                    <>
                      <ShieldCheck className="mr-1.5 size-4" />
                      Unban user
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="mr-1.5 size-4" />
                      Ban user
                    </>
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
