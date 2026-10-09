import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  Search,
  X,
  ShieldCheck,
  ShieldOff,
  Ban,
  CircleCheck,
  Pencil,
  Clock,
  Fingerprint,
} from "lucide-react";
import { toast } from "sonner";

import {
  fetchAdminUsers,
  setUserBanned,
  setUserAdmin,
  updateUserProfile,
  PAGE_SIZE,
  type AdminProfile,
} from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { UserAvatar } from "@/components/UserAvatar";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});

const TIMEOUT_OPTIONS = [
  { label: "60s", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "10m", seconds: 600 },
  { label: "1h", seconds: 3600 },
  { label: "1d", seconds: 86400 },
  { label: "1w", seconds: 604800 },
];

type AdminUserRow = AdminProfile & {
  timeout_until: string | null;
  timeout_reason: string | null;
  moderation_strikes: number;
};

function isTimedOut(u: { timeout_until: string | null }) {
  return u.timeout_until !== null && new Date(u.timeout_until).getTime() > Date.now();
}

function fmtRemaining(iso: string | null) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "0m";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ${hours % 24}h`;
  return `${Math.floor(days / 7)}w`;
}

function fmtJoined(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

async function fetchUsersWithTimeouts(page: number, search: string) {
  const { rows, count } = await fetchAdminUsers(page, search);
  const timeouts = new Map<
    string,
    { timeout_until: string | null; timeout_reason: string | null; moderation_strikes: number }
  >();
  if (rows.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, timeout_until, timeout_reason, moderation_strikes")
      .in(
        "id",
        rows.map((u) => u.id),
      );
    if (error) throw error;
    for (const row of data ?? []) {
      timeouts.set(row.id, {
        timeout_until: row.timeout_until,
        timeout_reason: row.timeout_reason,
        moderation_strikes: row.moderation_strikes,
      });
    }
  }
  return {
    rows: rows.map((u): AdminUserRow => ({
      ...u,
      timeout_until: timeouts.get(u.id)?.timeout_until ?? null,
      timeout_reason: timeouts.get(u.id)?.timeout_reason ?? null,
      moderation_strikes: timeouts.get(u.id)?.moderation_strikes ?? 0,
    })),
    count,
  };
}

// ------------------------------------------------------- hardware bans ----
// The banned-devices panel used to go through fetchHardwareBans() in
// @/lib/auth-security, which pulled `supabase.from` into a bare variable and
// called it unbound. SupabaseClient.from() then evaluates `this.rest` with
// `this === undefined` and throws
// "Cannot read properties of undefined (reading 'rest')" — the section showed
// that error instead of the list (and the lifted toggle appeared to crash).
// Keep the data access here, always calling methods on the client object, and
// normalise every field so a malformed row can never break the render.

type HardwareBan = {
  id: string;
  fingerprint: string;
  reason: string;
  source: string;
  user_id: string | null;
  active: boolean;
  created_at: string | null;
  unbanned_at: string | null;
};

type UntypedResult = { data: unknown; error: { message: string } | null };
type UntypedQuery = {
  select(columns: string): {
    order(column: string, options: { ascending: boolean }): Promise<UntypedResult>;
  };
};
type UntypedRpc = (fn: string, args?: Record<string, unknown>) => Promise<UntypedResult>;

const hardwareBansClient = supabase as unknown as {
  from(table: string): UntypedQuery;
  rpc: UntypedRpc;
};

function normalizeHardwareBan(row: unknown): HardwareBan | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  if (!id) return null;
  return {
    id,
    fingerprint: typeof r["fingerprint"] === "string" ? r["fingerprint"] : "",
    reason: typeof r["reason"] === "string" ? r["reason"] : "",
    source: typeof r["source"] === "string" ? r["source"] : "unknown",
    user_id: typeof r["user_id"] === "string" ? r["user_id"] : null,
    active: r["active"] === true,
    created_at: typeof r["created_at"] === "string" ? r["created_at"] : null,
    unbanned_at: typeof r["unbanned_at"] === "string" ? r["unbanned_at"] : null,
  };
}

/** Masks the middle of a fingerprint: ab12…ef90. */
function maskFingerprint(fingerprint: string): string {
  if (!fingerprint) return "unknown";
  if (fingerprint.length <= 10) return fingerprint;
  return `${fingerprint.slice(0, 4)}…${fingerprint.slice(-4)}`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

async function fetchHardwareBansSafe(): Promise<HardwareBan[]> {
  const { data, error } = await hardwareBansClient
    .from("hardware_bans")
    .select("id, fingerprint, reason, source, user_id, active, created_at, unbanned_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map(normalizeHardwareBan).filter((ban): ban is HardwareBan => ban !== null);
}

async function liftHardwareBan(id: string): Promise<void> {
  const { error } = await hardwareBansClient.rpc("admin_unban_hardware", { _id: id });
  if (error) throw new Error(error.message);
}

function AdminUsers() {
  const { user: me } = useAuth();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [r6Draft, setR6Draft] = useState("");
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [timeoutReason, setTimeoutReason] = useState("");
  const [hardwareBans, setHardwareBans] = useState<HardwareBan[] | null>(null);
  const [hwError, setHwError] = useState<string | null>(null);
  const [hwBusyId, setHwBusyId] = useState<string | null>(null);
  const [showLifted, setShowLifted] = useState(false);
  const [hwNames, setHwNames] = useState<Record<string, string>>({});
  const [hwReload, setHwReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHwError(null);
    setHardwareBans(null);
    fetchHardwareBansSafe()
      .then(async (rows) => {
        if (cancelled) return;
        setHardwareBans(rows);
        const ids = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => !!id))];
        if (ids.length) {
          const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
          if (!cancelled && data) {
            setHwNames(
              Object.fromEntries(
                (data as { id: string; display_name: string }[]).map((p) => [
                  p.id,
                  p.display_name || "Unnamed",
                ]),
              ),
            );
          }
        }
      })
      .catch((e) => {
        if (!cancelled)
          setHwError(e instanceof Error ? e.message : "Failed to load banned devices");
      });
    return () => {
      cancelled = true;
    };
  }, [hwReload]);

  const unbanDevice = async (ban: HardwareBan) => {
    if (
      !window.confirm(
        `Lift the device ban for ${maskFingerprint(ban.fingerprint)}? This device will be allowed to sign in and sign up again.`,
      )
    )
      return;
    setHwBusyId(ban.id);
    try {
      await liftHardwareBan(ban.id);
      setHardwareBans(
        (rows) =>
          rows?.map((row) =>
            row.id === ban.id
              ? { ...row, active: false, unbanned_at: new Date().toISOString() }
              : row,
          ) ?? null,
      );
      toast.success("Device ban lifted");
      // Re-read from the database so the list is authoritative even if the
      // optimistic update above missed something.
      setHwReload((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to lift device ban");
    } finally {
      setHwBusyId(null);
    }
  };

  const reload = () => {
    setRows(null);
    fetchUsersWithTimeouts(page, search)
      .then(({ rows, count }) => {
        setRows(rows);
        setCount(count);
      })
      .catch((e) => setError(e.message ?? "Failed to load users"));
  };

  useEffect(() => {
    setRows(null);
    let cancelled = false;
    fetchUsersWithTimeouts(page, search)
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
      // Banning a user also records their device, and unbanning lifts the
      // active hardware bans recorded for the account, so refresh the list.
      setHwReload((n) => n + 1);
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

  useEffect(() => {
    if (!selected) {
      setR6Draft("");
      return;
    }
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("r6_profile")
      .eq("id", selected.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setR6Draft((data as unknown as { r6_profile?: string | null } | null)?.r6_profile ?? "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const saveR6 = async () => {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_r6", {
      _target: selected.id,
      _url: r6Draft.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("R6 tracker link saved");
  };

  const assignPlan = async (plan: "free" | "pro" | "max") => {
    if (!selected || selected.plan === plan) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_plan", {
      _target: selected.id,
      _plan: plan,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      plan === "free"
        ? `${selected.display_name || "User"} is back on Free`
        : `${selected.display_name || "User"} gifted ${plan.toUpperCase()} (no charge)`,
    );
    setSelected({ ...selected, plan, plan_status: plan === "free" ? null : "comped" });
    reload();
  };

  const applyTimeout = async (seconds: number, label: string) => {
    if (!selected) return;
    const timeoutUntil = new Date(Date.now() + seconds * 1000).toISOString();
    const reason = timeoutReason.trim() || null;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ timeout_until: timeoutUntil, timeout_reason: reason })
        .eq("id", selected.id);
      if (error) throw error;
      toast.success(`${selected.display_name || "User"} timed out for ${label}`);
      setTimeoutOpen(false);
      setTimeoutReason("");
      setSelected({ ...selected, timeout_until: timeoutUntil, timeout_reason: reason });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to time out user");
    } finally {
      setBusy(false);
    }
  };

  const removeTimeout = async () => {
    if (!selected) return;
    if (!window.confirm(`Remove the timeout for ${selected.display_name || "this user"}?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ timeout_until: null, timeout_reason: null, moderation_strikes: 0 })
        .eq("id", selected.id);
      if (error) throw error;
      toast.success("Timeout removed");
      setSelected({
        ...selected,
        timeout_until: null,
        timeout_reason: null,
        moderation_strikes: 0,
      });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove timeout");
    } finally {
      setBusy(false);
    }
  };

  const visibleBans = (hardwareBans ?? []).filter((ban) => showLifted || ban.active);
  const activeBanCount = (hardwareBans ?? []).filter((ban) => ban.active).length;

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
                setTimeoutOpen(false);
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
                {isTimedOut(u) && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                    <Clock className="size-2.5" /> Timed out · {fmtRemaining(u.timeout_until)}
                  </span>
                )}
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

      <section className="mt-8 space-y-3 border-t border-border pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="size-4 text-muted-foreground" />
            <h2 className="font-display text-base font-bold text-foreground">Banned devices</h2>
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
              {activeBanCount}
            </span>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showLifted}
              onChange={(e) => setShowLifted(e.target.checked)}
              className="accent-primary"
            />
            Show lifted
          </label>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Device fingerprints are browser-derived hashes (never IP addresses). A banned device
          can&apos;t sign in or create new accounts. Unbanning a user above also lifts the bans
          recorded for their account.
        </p>

        {hwError && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-sm text-destructive">{hwError}</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setHwReload((n) => n + 1)}
            >
              Retry
            </Button>
          </div>
        )}

        {hwError ? null : !hardwareBans ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : visibleBans.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No {showLifted ? "" : "active "}device bans.
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleBans.map((ban) => (
              <li
                key={ban.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface p-3"
              >
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground"
                  title={ban.fingerprint || undefined}
                >
                  <Fingerprint className="size-3.5 text-muted-foreground" />
                  {maskFingerprint(ban.fingerprint)}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    ban.active
                      ? "bg-destructive/10 text-destructive"
                      : "bg-surface-2 text-muted-foreground",
                  )}
                >
                  {ban.active ? "Banned" : "Lifted"}
                </span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {ban.source}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ban.user_id ? (hwNames[ban.user_id] ?? "Unknown user") : "—"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ban.active
                    ? `Banned ${fmtWhen(ban.created_at)}`
                    : `Lifted ${fmtWhen(ban.unbanned_at) || fmtWhen(ban.created_at)}`}
                </span>
                {ban.reason && (
                  <span className="w-full text-xs text-muted-foreground">{ban.reason}</span>
                )}
                {ban.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={hwBusyId === ban.id}
                    onClick={() => void unbanDevice(ban)}
                    className="ml-auto h-7 gap-1.5 text-xs"
                  >
                    {hwBusyId === ban.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CircleCheck className="size-3.5" />
                    )}
                    Lift ban
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

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
                  <div className="mt-2 flex w-full items-center gap-1.5">
                    <Input
                      value={r6Draft}
                      onChange={(event) => setR6Draft(event.target.value)}
                      placeholder="R6 tracker profile URL"
                      className="h-8 flex-1 text-xs"
                    />
                    <Button
                      className="h-8 px-2 text-xs"
                      onClick={() => void saveR6()}
                      disabled={busy}
                    >
                      Save R6
                    </Button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelected(null);
                  setTimeoutOpen(false);
                }}
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
              {isTimedOut(selected) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                  <Clock className="size-3" /> Timed out · {fmtRemaining(selected.timeout_until)}{" "}
                  left
                </span>
              )}
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Plan
              </p>
              <div className="flex gap-1.5">
                {(["free", "pro", "max"] as const).map((plan) => (
                  <Button
                    key={plan}
                    size="sm"
                    variant={selected.plan === plan ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => void assignPlan(plan)}
                    className="h-7 flex-1 px-2 text-xs capitalize"
                  >
                    {plan}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selected.plan === "free"
                  ? "No paid plan."
                  : selected.plan_status === "comped"
                    ? "Gifted by an admin - no charge."
                    : `Stripe - ${selected.plan_status ?? "active"}`}
              </p>
            </div>

            {isTimedOut(selected) && selected.timeout_reason && (
              <p className="mt-2 text-xs text-muted-foreground">
                Timeout reason: {selected.timeout_reason}
              </p>
            )}

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
                {isTimedOut(selected) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void removeTimeout()}
                    className="gap-1.5"
                  >
                    <CircleCheck className="size-3.5" />
                    Remove timeout
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setTimeoutReason("");
                      setTimeoutOpen(true);
                    }}
                    className="gap-1.5"
                  >
                    <Clock className="size-3.5" />
                    Timeout
                  </Button>
                )}
              </div>
            )}

            <TechnicalDetails items={[{ label: "User UUID", value: selected.id }]} />
          </div>
        </div>
      )}

      {selected && timeoutOpen && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setTimeoutOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              Timeout {selected.display_name || "user"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              They won't be able to send messages until the timeout ends.
            </p>
            <Input
              value={timeoutReason}
              onChange={(e) => setTimeoutReason(e.target.value)}
              placeholder="Reason (optional)"
              className="mt-3 h-8"
            />
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {TIMEOUT_OPTIONS.map((option) => (
                <Button
                  key={option.seconds}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void applyTimeout(option.seconds, option.label)}
                  className="h-8 text-xs"
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setTimeoutOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
