import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import { fetchAdminUsers, PAGE_SIZE, type AdminProfile } from "@/lib/admin";
import { UserAvatar } from "@/components/UserAvatar";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});

function fmtJoined(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function AdminUsers() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminProfile[] | null>(null);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<AdminProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    let cancelled = false;
    fetchAdminUsers(page, search)
      .then(({ rows, count }) => {
        if (cancelled) return;
        setRows(rows);
        setCount(count);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load users"));
    return () => {
      cancelled = true;
    };
  }, [page, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold text-foreground">Users</h1>
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!rows ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No users found.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelected(u)}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left hover:bg-surface-2"
            >
              <UserAvatar name={u.display_name} path={u.avatar_url} className="size-10" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {u.display_name || "Unnamed"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Joined {fmtJoined(u.created_at)}
                </div>
              </div>
            </button>
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

      {selected && (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={selected.display_name}
                  path={selected.avatar_url}
                  className="size-12"
                />
                <div>
                  <div className="font-medium text-foreground">
                    {selected.display_name || "Unnamed"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Joined {fmtJoined(selected.created_at)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Last seen {new Date(selected.last_seen).toLocaleString()}
            </p>
            <TechnicalDetails items={[{ label: "User UUID", value: selected.id }]} />
          </div>
        </div>
      )}
    </div>
  );
}
