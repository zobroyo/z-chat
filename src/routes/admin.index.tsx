import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  fetchAdminStats,
  fetchAdminConversations,
  type AdminStats,
  type ConversationSummary,
} from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

function kindLabel(kind: string) {
  if (kind === "public") return "General";
  if (kind === "dm") return "DM";
  return "Group";
}

function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recent, setRecent] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{
    pendingApps: number;
    openReports: number;
    messages24h: number;
    users7d: number;
    onlineNow: number;
    uploads30d: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const since = (ms: number) => new Date(Date.now() - ms).toISOString();
    void Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("application_status", "pending"),
      supabase.from("message_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("messages").select("id", { count: "exact", head: true }).gte("created_at", since(24 * 3600 * 1000)),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since(7 * 24 * 3600 * 1000)),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen", since(5 * 60 * 1000)),
      supabase.from("upload_log").select("id", { count: "exact", head: true }).gte("created_at", since(30 * 24 * 3600 * 1000)),
    ]).then((results) => {
      if (cancelled) return;
      setPulse({
        pendingApps: results[0].count ?? 0,
        openReports: results[1].count ?? 0,
        messages24h: results[2].count ?? 0,
        users7d: results[3].count ?? 0,
        onlineNow: results[4].count ?? 0,
        uploads30d: results[5].count ?? 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAdminStats(), fetchAdminConversations(0, "all", "")])
      .then(([s, c]) => {
        if (cancelled) return;
        setStats(s);
        setRecent(c.rows.slice(0, 8));
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">Couldn't load the dashboard: {error}</p>;
  }

  if (!stats || !recent) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cards: { label: string; value: number | undefined }[] = [
    { label: "Total users", value: stats.users },
    { label: "Total conversations", value: stats.conversations },
    { label: "Total messages", value: stats.messages },
    { label: "Total groups", value: stats.groups },
    { label: "Total DMs", value: stats.dms },
    { label: "Online now (5 min)", value: pulse?.onlineNow },
    { label: "Messages (24h)", value: pulse?.messages24h },
    { label: "New users (7 days)", value: pulse?.users7d },
    { label: "Pending applications", value: pulse?.pendingApps },
    { label: "Open reports", value: pulse?.openReports },
    { label: "Uploads (30 days)", value: pulse?.uploads30d },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">ZChat Admin</h1>
        <p className="text-sm text-muted-foreground">
          Live overview of the whole organisation — activity, growth and moderation at a glance.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-2xl font-bold text-foreground">
              {typeof c.value === "number" ? c.value.toLocaleString() : "—"}
            </div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent conversations</h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-surface">
          {recent.map((c) => (
            <Link
              key={c.id}
              to="/admin/conversations/$id"
              params={{ id: c.id }}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">
                  {c.name ??
                    (c.kind === "dm" && c.participantNames?.length
                      ? c.participantNames.join(" ↔ ")
                      : kindLabel(c.kind))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {kindLabel(c.kind)} • {c.memberCount} members • {c.messageCount} messages
                </div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : "No messages"}
              </div>
            </Link>
          ))}
          {recent.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No conversations yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
