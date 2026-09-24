import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import {
  fetchAdminConversations,
  PAGE_SIZE,
  type ConversationSummary,
} from "@/lib/admin";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/conversations")({
  component: AdminConversations,
});

const FILTERS = [
  { key: "all", label: "All" },
  { key: "dm", label: "DMs" },
  { key: "group", label: "Groups" },
  { key: "public", label: "General" },
] as const;

function icon(kind: string) {
  if (kind === "dm") return "👤";
  if (kind === "public") return "💬";
  return "👥";
}

function label(c: ConversationSummary) {
  if (c.name) return c.name;
  return c.kind === "public"
    ? "General"
    : c.kind === "dm"
      ? "Direct message"
      : "Group";
}

function AdminConversations() {
  const [filter, setFilter] =
    useState<(typeof FILTERS)[number]["key"]>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ConversationSummary[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);

    let cancelled = false;

    fetchAdminConversations(page, filter, search)
      .then(({ rows, count }) => {
        if (cancelled) return;
        setRows(rows);
        setCount(count);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message ?? "Failed to load conversations");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, filter, search]);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-bold text-foreground">
            Conversations
          </h1>

          <div className="relative w-full max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              value={search}
              onChange={(e) => {
                setPage(0);
                setSearch(e.target.value);
              }}
              placeholder="Search by name"
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setPage(0);
                setFilter(f.key);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!rows ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No conversations found.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {icon(c.kind)} {label(c)}
                    </div>

                    <div className="text-xs text-muted-foreground">
                      {c.memberCount} members • {c.messageCount} messages
                      {c.lastMessageAt &&
                        ` • Last activity ${new Date(
                          c.lastMessageAt,
                        ).toLocaleString()}`}
                    </div>
                  </div>

                  <Link
                    to="/admin/conversations/$id"
                    params={{ id: c.id }}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                  >
                    Open conversation
                  </Link>
                </div>

                <TechnicalDetails
                  items={[
                    {
                      label: "Conversation UUID",
                      value: c.id,
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        )}

        {count > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>

            <span>
              Page {page + 1} of {Math.ceil(count / PAGE_SIZE)}
            </span>

            <button
              disabled={(page + 1) * PAGE_SIZE >= count}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <Outlet />
    </>
  );
}