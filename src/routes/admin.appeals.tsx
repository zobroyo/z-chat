import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessagesSquare, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { OpenChatDialog } from "@/components/chat/OpenChatDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { fetchAdminThreads, setThreadResolved, type AdminThread } from "@/lib/appeals";
import { setUserBanned } from "@/lib/admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/appeals")({
  component: AdminOpenChat,
});

type Filter = "open" | "reviewed" | "all";

function AdminOpenChat() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<AdminThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<AdminThread | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setThreads(await fetchAdminThreads());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load open chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleResolved = async (thread: AdminThread) => {
    setBusyId(thread.user_id);
    try {
      const next = !thread.resolved;
      await setThreadResolved(thread.user_id, next);
      setThreads((current) =>
        current.map((item) => (item.user_id === thread.user_id ? { ...item, resolved: next } : item)),
      );
      toast.success(next ? "Marked as reviewed" : "Reopened");
    } catch {
      toast.error("Could not update that thread");
    } finally {
      setBusyId(null);
    }
  };

  const toggleBan = async (thread: AdminThread) => {
    const name = thread.display_name ?? "this user";
    const next = !thread.user_banned;
    if (!window.confirm(next ? `Ban ${name}?` : `Unban ${name}? They will be able to chat again.`)) {
      return;
    }
    setBusyId(thread.user_id);
    try {
      await setUserBanned(thread.user_id, next);
      setThreads((current) =>
        current.map((item) =>
          item.user_id === thread.user_id ? { ...item, user_banned: next } : item,
        ),
      );
      toast.success(next ? `${name} banned` : `${name} unbanned`);
    } catch {
      toast.error("Could not change that ban");
    } finally {
      setBusyId(null);
    }
  };

  const visible = threads.filter((thread) =>
    filter === "all" ? true : filter === "open" ? !thread.resolved : thread.resolved,
  );
  const openCount = threads.filter((thread) => !thread.resolved).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold">Open chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Banned users can talk to you here — this is the one channel they still have.
          {openCount > 0 && (
            <span className="ml-1.5 font-medium text-foreground">{openCount} open</span>
          )}
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            { value: "open", label: "Open" },
            { value: "reviewed", label: "Reviewed" },
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
          Loading open chats…
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface/50 px-4 py-10 text-center">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filter === "open" ? "No open chats. All caught up." : "Nothing here yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((thread) => (
            <li key={thread.user_id} className="rounded-xl border border-border bg-surface/50 p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <UserAvatar
                  name={thread.display_name ?? undefined}
                  path={thread.avatar_url}
                  className="size-8"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{thread.display_name ?? "Unknown user"}</p>
                  <p className="text-xs text-muted-foreground">
                    {thread.last_at ? new Date(thread.last_at).toLocaleString() : "—"} · {thread.count} message
                    {thread.count === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase",
                    thread.resolved
                      ? "bg-primary/15 text-primary"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {thread.resolved ? "Reviewed" : "Open"}
                </span>
                {thread.user_banned && (
                  <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-destructive">
                    <ShieldAlert className="size-3" />
                    Banned
                  </span>
                )}
              </div>

              {thread.last_body && (
                <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">
                  {thread.last_body}
                </p>
              )}

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" onClick={() => setOpenThread(thread)}>
                  <MessagesSquare className="mr-1.5 size-4" />
                  Open chat
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === thread.user_id}
                  onClick={() => void toggleResolved(thread)}
                >
                  {thread.resolved ? (
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
                  variant={thread.user_banned ? "default" : "destructive"}
                  disabled={busyId === thread.user_id}
                  onClick={() => void toggleBan(thread)}
                >
                  {thread.user_banned ? (
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

      {openThread && (
        <OpenChatDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) {
              setOpenThread(null);
              void load();
            }
          }}
          userId={openThread.user_id}
          meId={user?.id ?? ""}
          isModerator={true}
        />
      )}
    </div>
  );
}
