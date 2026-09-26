import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Pencil, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  fetchConversationById,
  fetchConversationMembers,
  renameConversationAsAdmin,
  kickMemberAsAdmin,
  type AdminProfile,
} from "@/lib/admin";
import type { Conversation, Message } from "@/lib/chat";
import { UserAvatar } from "@/components/UserAvatar";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const [members, setMembers] = useState<
    { id: string; display_name: string; avatar_url: string | null }[]
  >([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const conv = await fetchConversationById(id);
      if (!conv) {
        setNotFound(true);
        return;
      }
      setConversation(conv);
      setNameDraft(conv.name ?? "");

      const { data: msgs, error: msgErr } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, image_url, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (msgErr) throw msgErr;
      const rows = ((msgs ?? []) as Message[]).slice().reverse();
      setMessages(rows);

      const senderIds = [...new Set(rows.map((m) => m.sender_id))];
      if (senderIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url, last_seen, created_at, is_admin, banned")
          .in("id", senderIds);
        if (profs) setProfiles(new Map((profs as AdminProfile[]).map((p) => [p.id, p])));
      }

      if (conv.kind !== "public") {
        setMembers(await fetchConversationMembers(id));
      }
    } catch (e) {
      setError((e as Error).message ?? "Failed to load conversation");
    }
  };

  useEffect(() => {
    setConversation(null);
    setMessages(null);
    setNotFound(false);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const saveName = async () => {
    if (!conversation || !nameDraft.trim()) return;
    setBusy(true);
    try {
      await renameConversationAsAdmin(conversation.id, nameDraft.trim());
      setConversation({ ...conversation, name: nameDraft.trim() });
      setEditingName(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename conversation");
    } finally {
      setBusy(false);
    }
  };

  const kick = async (userId: string, name: string) => {
    if (!conversation) return;
    if (!window.confirm(`Remove ${name || "this member"} from this conversation?`)) return;
    setBusy(true);
    try {
      await kickMemberAsAdmin(conversation.id, userId);
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setBusy(false);
    }
  };

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

  const canRename = conversation.kind === "group";

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
        {editingName ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="h-8 max-w-xs"
              autoFocus
            />
            <Button size="sm" className="h-8" disabled={busy} onClick={() => void saveName()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingName(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <h1 className="font-display text-xl font-bold text-foreground">
              {label(conversation)}
            </h1>
            {canRename && (
              <button
                onClick={() => setEditingName(true)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Rename"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {conversation.kind === "public" ? "General" : conversation.kind === "dm" ? "DM" : "Group"}{" "}
          • {messages.length} messages shown
        </p>
        <TechnicalDetails items={[{ label: "Conversation UUID", value: conversation.id }]} />
      </div>

      {members.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
            {members.length} member{members.length === 1 ? "" : "s"}
          </h2>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-1.5 text-xs"
              >
                <UserAvatar name={m.display_name} path={m.avatar_url} className="size-5" />
                {m.display_name || "Unnamed"}
                {conversation.kind === "group" && (
                  <button
                    onClick={() => void kick(m.id, m.display_name)}
                    disabled={busy}
                    aria-label={`Remove ${m.display_name}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <UserMinus className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
