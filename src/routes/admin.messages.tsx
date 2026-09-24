import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { searchAdminMessages, PAGE_SIZE, type AdminMessageRow } from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";

export const Route = createFileRoute("/admin/messages")({
  component: AdminMessages,
});

type Enriched = AdminMessageRow & { senderName: string; conversationName: string };

function AdminMessages() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Enriched[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    let cancelled = false;
    (async () => {
      try {
        const { rows, count } = await searchAdminMessages(page, query);
        if (cancelled) return;
        setCount(count);

        const senderIds = [...new Set(rows.map((m) => m.sender_id))];
        const convIds = [...new Set(rows.map((m) => m.conversation_id))];
        const [{ data: profs }, { data: convs }] = await Promise.all([
          senderIds.length
            ? supabase.from("profiles").select("id, display_name").in("id", senderIds)
            : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
          convIds.length
            ? supabase.from("conversations").select("id, kind, name").in("id", convIds)
            : Promise.resolve({ data: [] as { id: string; kind: string; name: string | null }[] }),
        ]);
        if (cancelled) return;
        const profMap = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
        const convMap = new Map(
          (convs ?? []).map((c) => [
            c.id,
            c.name ?? (c.kind === "public" ? "General" : c.kind === "dm" ? "DM" : "Group"),
          ]),
        );
        setRows(
          rows.map((m) => ({
            ...m,
            senderName: profMap.get(m.sender_id) ?? "Deleted user",
            conversationName: convMap.get(m.conversation_id) ?? "Deleted conversation",
          })),
        );
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? "Search failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, query]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold text-foreground">Messages</h1>

      <div className="relative max-w-md">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setPage(0);
            setQuery(e.target.value);
          }}
          placeholder="Search message text"
          className="pl-8"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!rows ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No messages found.</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.map((m) => (
            <div key={m.id} className="px-4 py-3">
              <Link
                to="/admin/conversations/$id"
                params={{ id: m.conversation_id }}
                className="block hover:bg-surface-2 -mx-2 rounded-md px-2 py-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{m.senderName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{m.conversationName}</div>
                {m.body && <p className="mt-1 truncate text-sm text-foreground">"{m.body}"</p>}
              </Link>
              <TechnicalDetails
                items={[
                  { label: "Message UUID", value: m.id },
                  { label: "Conversation UUID", value: m.conversation_id },
                  { label: "Sender UUID", value: m.sender_id },
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
  );
}
