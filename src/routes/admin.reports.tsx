import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Ban, Clock, Loader2, RefreshCw, ShieldX, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/reports")({
  component: AdminReports,
});

type ReportRow = {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  conversation_id: string;
  message_id: string;
  reporter_id: string;
  messages: { id: string; body: string | null; sender_id: string; created_at: string } | null;
};

type ContextMessage = { id: string; body: string | null; sender_id: string; created_at: string };

function AdminReports() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [contexts, setContexts] = useState<Record<string, ContextMessage[]>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("message_reports")
      .select(
        "id, reason, status, created_at, conversation_id, message_id, reporter_id, messages (id, body, sender_id, created_at)",
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    const list = (data ?? []) as unknown as ReportRow[];
    setRows(list);

    const ids = new Set<string>();
    list.forEach((report) => {
      if (report.messages?.sender_id) ids.add(report.messages.sender_id);
      ids.add(report.reporter_id);
    });
    if (ids.size) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [...ids]);
      const map: Record<string, string> = {};
      (people ?? []).forEach((person) => {
        map[person.id] = person.display_name;
      });
      setNames(map);
    }

    const ctx: Record<string, ContextMessage[]> = {};
    for (const report of list) {
      if (!report.messages) continue;
      const { data: before } = await supabase
        .from("messages")
        .select("id, body, sender_id, created_at")
        .eq("conversation_id", report.conversation_id)
        .lt("created_at", report.messages.created_at)
        .order("created_at", { ascending: false })
        .limit(15);
      ctx[report.id] = (before ?? []).slice().reverse();
    }
    setContexts(ctx);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(async (report: ReportRow, resolution: string) => {
    const { data: me } = await supabase.auth.getUser();
    await supabase
      .from("message_reports")
      .update({
        status: "resolved",
        resolution,
        resolved_by: me.user?.id ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", report.id);
    setRows((current) => current.filter((row) => row.id !== report.id));
  }, []);

  const deleteMessage = async (report: ReportRow) => {
    if (!report.messages) return;
    setBusyId(report.id);
    const { error } = await supabase.from("messages").delete().eq("id", report.messages.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Message deleted");
    await resolve(report, "message deleted");
  };

  const timeoutSender = async (report: ReportRow) => {
    if (!report.messages) return;
    setBusyId(report.id);
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("profiles")
      .update({ timeout_until: until, timeout_reason: "reported message" })
      .eq("id", report.messages.sender_id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Sender timed out for 24h");
    await resolve(report, "sender timed out");
  };

  const banSender = async (report: ReportRow) => {
    if (!report.messages) return;
    setBusyId(report.id);
    const { error } = await supabase.rpc("admin_set_banned", {
      _target: report.messages.sender_id,
      _value: true,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Sender banned");
    await resolve(report, "sender banned");
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Reported messages with the last 15 messages of context before each one.
          </p>
        </div>
        <Button variant="outline" className="h-9 px-3" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </header>

      {rows.length === 0 && !loading && (
        <p className="rounded-2xl bg-surface-2 p-6 text-sm text-muted-foreground">
          No open reports. The chat is behaving.
        </p>
      )}

      <div className="space-y-4">
        {rows.map((report) => (
          <article key={report.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ShieldX className="size-3.5 text-destructive" />
              <span>
                Reported by <strong className="text-foreground">{names[report.reporter_id] ?? "someone"}</strong>{" "}
                &middot; {new Date(report.created_at).toLocaleString()}
              </span>
              {report.reason && <span className="rounded-full bg-surface-2 px-2 py-0.5">“{report.reason}”</span>}
            </div>

            {report.messages && (
              <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-center gap-2">
                  <UserAvatar name={names[report.messages.sender_id] ?? "?"} className="size-6" />
                  <span className="text-sm font-semibold">
                    {names[report.messages.sender_id] ?? "Unknown"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(report.messages.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {report.messages.body ?? "(photo)"}
                </p>
              </div>
            )}

            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Show 15 messages before this one
              </summary>
              <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-surface-2 p-3">
                {(contexts[report.id] ?? []).map((line) => (
                  <p key={line.id} className="text-xs leading-5">
                    <span className="font-semibold text-foreground">
                      {names[line.sender_id] ?? "Unknown"}:
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {(line.body ?? "(photo)").slice(0, 200)}
                    </span>
                  </p>
                ))}
                {(contexts[report.id] ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">(no earlier messages)</p>
                )}
              </div>
            </details>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="h-8 px-3" disabled={busyId === report.id} onClick={() => void deleteMessage(report)}>
                <Trash2 className="mr-1 size-3.5" /> Delete message
              </Button>
              <Button
                variant="outline"
                className="h-8 px-3"
                disabled={busyId === report.id}
                onClick={() => void timeoutSender(report)}
              >
                <Clock className="mr-1 size-3.5" /> Timeout 24h
              </Button>
              <Button
                variant="outline"
                className="h-8 px-3 text-destructive"
                disabled={busyId === report.id}
                onClick={() => void banSender(report)}
              >
                <Ban className="mr-1 size-3.5" /> Ban
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3"
                disabled={busyId === report.id}
                onClick={() => void resolve(report, "dismissed")}
              >
                <X className="mr-1 size-3.5" /> Dismiss
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
