import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  fetchAdminStats,
  fetchAdminConversations,
  type AdminStats,
  type ConversationSummary,
} from "@/lib/admin";

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

  const cards = [
    { label: "Total users", value: stats.users },
    { label: "Total conversations", value: stats.conversations },
    { label: "Total messages", value: stats.messages },
    { label: "Total groups", value: stats.groups },
    { label: "Total DMs", value: stats.dms },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">ZChat Admin</h1>
        <p className="text-sm text-muted-foreground">Read-only overview of your ZChat instance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-2xl font-bold text-foreground">{c.value.toLocaleString()}</div>
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
                  {c.name ?? kindLabel(c.kind)}
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
