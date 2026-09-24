import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fetchConversationById, type AdminProfile } from "@/lib/admin";
import type { Conversation, Message } from "@/lib/chat";
import { UserAvatar } from "@/components/UserAvatar";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";

export const Route = createFileRoute("/admin/conversations/$id")({
  component: AdminConversationViewer,
});

function label(c: Conversation) {
  if (c.name) return c.name;
  return c.kind === "public" ? "General" : c.kind === "dm" ? "Direct message" : "Group";
}

function AdminConversationViewer() {
  const { id } = Route.useParams();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, AdminProfile>>(new Map());
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const conv = await fetchConversationById(id);
        if (cancelled) return;
        if (!conv) {
          setNotFound(true);
          return;
        }
        setConversation(conv);

        const { data: msgs, error: msgErr } = await supabase
          .from("messages")
          .select("id, conversation_id, sender_id, body, image_url, created_at")
          .eq("conversation_id", id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (msgErr) throw msgErr;
        const rows = ((msgs ?? []) as Message[]).slice().reverse();
        if (cancelled) return;
        setMessages(rows);

        const senderIds = [...new Set(rows.map((m) => m.sender_id))];
        if (senderIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, display_name, avatar_url, last_seen, created_at")
            .in("id", senderIds);
          if (!cancelled && profs) {
            setProfiles(new Map((profs as AdminProfile[]).map((p) => [p.id, p])));
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? "Failed to load conversation");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">This conversation no longer exists.</p>
        <Link
          to="/admin/conversations"
          className="mt-3 inline-block text-sm text-primary underline"
        >
          Back to conversations
        </Link>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">Couldn't load this conversation: {error}</p>;
  }

  if (!conversation || !messages) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to="/admin/conversations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </Link>

      <div>
        <h1 className="font-display text-xl font-bold text-foreground">{label(conversation)}</h1>
        <p className="text-xs text-muted-foreground">
          {conversation.kind === "public" ? "General" : conversation.kind === "dm" ? "DM" : "Group"}{" "}
          • {messages.length} messages shown
        </p>
        <TechnicalDetails items={[{ label: "Conversation UUID", value: conversation.id }]} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <div className="max-h-[65vh] space-y-4 overflow-y-auto scroll-slim pr-1">
            {messages.map((m) => {
              const sender = profiles.get(m.sender_id);
              return (
                <div key={m.id} className="flex items-start gap-3">
                  <UserAvatar
                    name={sender?.display_name ?? "Deleted user"}
                    path={sender?.avatar_url}
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {sender?.display_name || "Deleted user"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(m.created_at).toLocaleString()}
                      </span>
                    </div>
                    {m.body && (
                      <p className="mt-0.5 text-sm break-words text-foreground">{m.body}</p>
                    )}
                    {m.image_url && !m.body && (
                      <p className="mt-0.5 text-sm italic text-muted-foreground">Sent an image</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
