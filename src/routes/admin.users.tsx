import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search, X, ShieldCheck, ShieldOff, Ban, CircleCheck, Pencil } from "lucide-react";
import { toast } from "sonner";

import {
  fetchAdminUsers,
  setUserBanned,
  setUserAdmin,
  updateUserProfile,
  PAGE_SIZE,
  type AdminProfile,
} from "@/lib/admin";
import { useAuth } from "@/hooks/use-auth";
import { UserAvatar } from "@/components/UserAvatar";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});

function fmtJoined(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function AdminUsers() {
  const { user: me } = useAuth();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminProfile[] | null>(null);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<AdminProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const reload = () => {
    setRows(null);
    fetchAdminUsers(page, search)
      .then(({ rows, count }) => {
        setRows(rows);
        setCount(count);
      })
      .catch((e) => setError(e.message ?? "Failed to load users"));
  };

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

  const isSelf = selected?.id === me?.id;

  const toggleBan = async () => {
    if (!selected) return;
    const next = !selected.banned;
    const verb = next ? "ban" : "unban";
    if (
      !window.confirm(
        `${next ? "Ban" : "Unban"} ${selected.display_name || "this user"}? ${next ? "This will prevent this account from using ZChat." : "This restores their ability to send messages and create conversations."}`,
      )
    )
      return;
    setBusy(true);
    try {
      await setUserBanned(selected.id, next);
      setSelected({ ...selected, banned: next });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${verb} user`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAdmin = async () => {
    if (!selected) return;
    const next = !selected.is_admin;
    if (
      !window.confirm(
        `${next ? "Grant" : "Remove"} admin access ${next ? "to" : "from"} ${selected.display_name || "this user"}?`,
      )
    )
      return;
    setBusy(true);
    try {
      await setUserAdmin(selected.id, next);
      setSelected({ ...selected, is_admin: next });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update admin status");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!selected || !nameDraft.trim()) return;
    setBusy(true);
    try {
      await updateUserProfile(selected.id, { display_name: nameDraft.trim() });
      setSelected({ ...selected, display_name: nameDraft.trim() });
      setEditingName(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update name");
    } finally {
      setBusy(false);
    }
  };

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
              onClick={() => {
                setSelected(u);
                setEditingName(false);
                setNameDraft(u.display_name);
              }}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left hover:bg-surface-2"
            >
              <UserAvatar name={u.display_name} path={u.avatar_url} className="size-10" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                  {u.display_name || "Unnamed"}
                  {u.is_admin && <ShieldCheck className="size-3.5 shrink-0 text-primary" />}
                  {u.banned && <Ban className="size-3.5 shrink-0 text-destructive" />}
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
                  {editingName ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        className="h-7 w-36 text-sm"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        className="h-7 px-2"
                        disabled={busy}
                        onClick={() => void saveName()}
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <div className="font-medium text-foreground">
                        {selected.display_name || "Unnamed"}
                      </div>
                      <button
                        onClick={() => setEditingName(true)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Edit name"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                  )}
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

            <div className="mt-2 flex gap-1.5">
              {selected.is_admin && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <ShieldCheck className="size-3" /> Admin
                </span>
              )}
              {selected.banned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  <Ban className="size-3" /> Banned
                </span>
              )}
            </div>

            {isSelf ? (
              <p className="mt-4 text-xs text-muted-foreground">
                You can't ban yourself or change your own admin status here.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant={selected.banned ? "outline" : "destructive"}
                  size="sm"
                  disabled={busy}
                  onClick={() => void toggleBan()}
                  className={cn("gap-1.5")}
                >
                  {selected.banned ? (
                    <CircleCheck className="size-3.5" />
                  ) : (
                    <Ban className="size-3.5" />
                  )}
                  {selected.banned ? "Unban user" : "Ban user"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void toggleAdmin()}
                  className="gap-1.5"
                >
                  {selected.is_admin ? (
                    <ShieldOff className="size-3.5" />
                  ) : (
                    <ShieldCheck className="size-3.5" />
                  )}
                  {selected.is_admin ? "Remove admin" : "Make admin"}
                </Button>
              </div>
            )}

            <TechnicalDetails items={[{ label: "User UUID", value: selected.id }]} />
          </div>
        </div>
      )}
    </div>
  );
}
