import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/applications")({
  component: AdminApplications,
});

type Application = {
  id: string;
  display_name: string;
  username: string | null;
  created_at: string;
};

function AdminApplications() {
  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, username, created_at")
      .eq("application_status", "pending")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Application[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    const { error } = await supabase.rpc("review_application", {
      _user_id: id,
      _approve: approve,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(approve ? "Application approved" : "Application rejected");
    setRows((current) => current.filter((row) => row.id !== id));
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-sm text-muted-foreground">
            People waiting to join. Review hours: usually 3:30pm&ndash;7pm on weekdays.
          </p>
        </div>
        <Button variant="outline" className="h-9 px-3" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </header>

      {rows.length === 0 && !loading && (
        <p className="rounded-2xl bg-surface-2 p-6 text-sm text-muted-foreground">
          No pending applications right now.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
          >
            <UserAvatar name={row.display_name} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{row.display_name || "New user"}</p>
              <p className="truncate text-xs text-muted-foreground">
                @{row.username ?? "no-username"} &middot; applied{" "}
                {new Date(row.created_at).toLocaleString()}
              </p>
            </div>
            <Button
              className="h-9 px-3"
              disabled={busyId === row.id}
              onClick={() => void decide(row.id, true)}
            >
              <Check className="mr-1 size-4" /> Approve
            </Button>
            <Button
              variant="outline"
              className="h-9 px-3"
              disabled={busyId === row.id}
              onClick={() => void decide(row.id, false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
