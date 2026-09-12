import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, LogOut, Menu, Search, Settings, Users } from "lucide-react";
import { toast } from "sonner";

import { Composer } from "@/components/chat/Composer";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { NewGroupDialog } from "@/components/chat/NewGroupDialog";
import { NotificationGate } from "@/components/NotificationGate";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  PUBLIC_CONVERSATION_ID,
  createGroup,
  ensureDirectConversation,
  fetchConversations,
  fetchMembers,
  fetchMessages,
  fetchProfiles,
  initialsOf,
  isOnline,
  leaveConversation,
  markConversationRead,
  sendMessage,
  touchPresence,
  type Conversation,
  type Member,
  type Message,
  type Profile,
} from "@/lib/chat";
import { uploadChatImage } from "@/lib/media";
import { showChatNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chats — ZChat" },
      {
        name: "description",
        content:
          "Your ZChat conversations: the General room, private chats and groups, with photos and instant alerts.",
      },
      { property: "og:title", content: "Chats — ZChat" },
      {
        property: "og:description",
        content: "Private chats, groups and photo sharing in ZChat.",
      },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return PUBLIC_CONVERSATION_ID;
    return new URLSearchParams(window.location.search).get("c") ?? PUBLIC_CONVERSATION_ID;
  });
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeIdRef = useRef(activeId);
  const profilesRef = useRef<Profile[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  activeIdRef.current = activeId;
  profilesRef.current = profiles;

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/" });
  }, [loading, user, navigate]);

  const reload = useCallback(async () => {
    try {
      const [nextProfiles, nextConversations, nextMembers] = await Promise.all([
        fetchProfiles(),
        fetchConversations(),
        fetchMembers(),
      ]);
      setProfiles(nextProfiles);
      setConversations(nextConversations);
      setMembers(nextMembers);
    } catch {
      toast.error("Could not load your chats");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void reload();
    void touchPresence(user.id);
    const presence = window.setInterval(() => void touchPresence(user.id), 45_000);
    return () => window.clearInterval(presence);
  }, [user, reload]);

  // Live messages for every chat this person belongs to.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("z-chat-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as Message;
          const isActive = message.conversation_id === activeIdRef.current;

          if (isActive) {
            setMessages((current) =>
              current.some((item) => item.id === message.id) ? current : [...current, message],
            );
          }

          if (message.sender_id === user.id) return;

          if (!isActive) {
            setUnread((current) => ({
              ...current,
              [message.conversation_id]: (current[message.conversation_id] ?? 0) + 1,
            }));
          }

          if (!isActive || document.visibilityState !== "visible") {
            const sender = profilesRef.current.find((item) => item.id === message.sender_id);
            const title = sender?.display_name ?? "New message";
            const body = message.body ?? "Sent a photo";
            toast(title, { description: body });
            void showChatNotification(title, body, message.conversation_id);
          }
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void fetchProfiles().then(setProfiles).catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        void reload();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, reload]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchMessages(activeId)
      .then((rows) => {
        if (active) setMessages(rows);
      })
      .catch(() => toast.error("Could not load these messages"));
    setUnread((current) => ({ ...current, [activeId]: 0 }));
    void markConversationRead(activeId, user.id);
    return () => {
      active = false;
    };
  }, [activeId, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  const partnerOf = useCallback(
    (conversation: Conversation) => {
      if (!user) return undefined;
      const partnerId = members.find(
        (member) => member.conversation_id === conversation.id && member.user_id !== user.id,
      )?.user_id;
      return partnerId ? profileMap.get(partnerId) : undefined;
    },
    [members, profileMap, user],
  );

  const generalRoom = conversations.find((item) => item.kind === "public");
  const groups = conversations.filter((item) => item.kind === "group");
  const directChats = conversations.filter((item) => item.kind === "dm");

  const others = useMemo(
    () => profiles.filter((profile) => profile.id !== user?.id),
    [profiles, user],
  );

  const filteredOthers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return others;
    return others.filter((profile) => profile.display_name.toLowerCase().includes(needle));
  }, [others, query]);

  const activeConversation = conversations.find((item) => item.id === activeId) ?? generalRoom;
  const activePartner = activeConversation ? partnerOf(activeConversation) : undefined;
  const memberCount = members.filter((member) => member.conversation_id === activeId).length;

  const activeTitle =
    activeConversation?.kind === "public"
      ? "General"
      : activeConversation?.kind === "group"
        ? (activeConversation.name ?? "Group")
        : (activePartner?.display_name ?? "Chat");

  const activeSubtitle =
    activeConversation?.kind === "public"
      ? "Everyone on ZChat"
      : activeConversation?.kind === "group"
        ? `${memberCount} member${memberCount === 1 ? "" : "s"}`
        : isOnline(activePartner)
          ? "Online"
          : "Offline";

  const openConversation = (id: string) => {
    setActiveId(id);
    setSheetOpen(false);
  };

  const startDirect = async (otherId: string) => {
    if (!user) return;
    try {
      const conversation = await ensureDirectConversation(user.id, otherId);
      await reload();
      openConversation(conversation.id);
    } catch {
      toast.error("Could not open that chat");
    }
  };

  const makeGroup = async (name: string, memberIds: string[]) => {
    if (!user) return;
    const conversation = await createGroup(user.id, name, memberIds);
    await reload();
    openConversation(conversation.id);
  };

  const leaveGroup = async () => {
    if (!user || activeConversation?.kind !== "group") return;
    if (!window.confirm(`Leave ${activeConversation.name ?? "this group"}?`)) return;
    try {
      await leaveConversation(activeConversation.id, user.id);
      setActiveId(generalRoom?.id ?? PUBLIC_CONVERSATION_ID);
      await reload();
      toast.success("You left the group");
    } catch {
      toast.error("Could not leave that group");
    }
  };



  const handleSend = async (body: string, file: File | null) => {
    if (!user) return;
    const imagePath = file ? await uploadChatImage(activeId, file) : null;
    await sendMessage({ conversationId: activeId, senderId: user.id, body, imagePath });
  };

  const me = user ? profileMap.get(user.id) : undefined;

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary font-display text-sm font-extrabold text-primary-foreground">
          Z
        </span>
        <span className="font-display text-base font-bold">ZChat</span>
        <div className="ml-auto flex items-center">
          <NewGroupDialog people={others} onCreate={makeGroup} />
          <NotificationGate userId={user?.id} />
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            className="rounded-xl bg-surface-2 pl-9"
          />
        </div>
      </div>

      <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        <Section title="Room">
          <Row
            active={activeId === generalRoom?.id}
            onClick={() => generalRoom && openConversation(generalRoom.id)}
            leading={
              <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                <Hash className="size-4" />
              </span>
            }
            title="General"
            subtitle="Everyone on ZChat"
            badge={unread[generalRoom?.id ?? ""] ?? 0}
          />
        </Section>

        {groups.length > 0 && (
          <Section title="Groups">
            {groups.map((group) => (
              <Row
                key={group.id}
                active={activeId === group.id}
                onClick={() => openConversation(group.id)}
                leading={
                  <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                    <Users className="size-4" />
                  </span>
                }
                title={group.name ?? "Group"}
                subtitle={`${members.filter((m) => m.conversation_id === group.id).length} members`}
                badge={unread[group.id] ?? 0}
              />
            ))}
          </Section>
        )}

        {directChats.length > 0 && (
          <Section title="Chats">
            {directChats.map((conversation) => {
              const partner = partnerOf(conversation);
              return (
                <Row
                  key={conversation.id}
                  active={activeId === conversation.id}
                  onClick={() => openConversation(conversation.id)}
                  leading={
                    <UserAvatar
                      name={partner?.display_name}
                      path={partner?.avatar_url}
                      online={isOnline(partner)}
                      className="size-9"
                    />
                  }
                  title={partner?.display_name ?? "Someone"}
                  subtitle={isOnline(partner) ? "Online" : "Offline"}
                  badge={unread[conversation.id] ?? 0}
                />
              );
            })}
          </Section>
        )}

        <Section title="People">
          {filteredOthers.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No one else here yet.</p>
          )}
          {filteredOthers.map((person) => (
            <Row
              key={person.id}
              onClick={() => void startDirect(person.id)}
              leading={
                <UserAvatar
                  name={person.display_name}
                  path={person.avatar_url}
                  online={isOnline(person)}
                  className="size-9"
                />
              }
              title={person.display_name || "Someone"}
              subtitle={isOnline(person) ? "Online" : "Offline"}
            />
          ))}
        </Section>
      </div>

      <Link
        to="/profile"
        className="flex items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-surface-2"
      >
        <UserAvatar name={me?.display_name} path={me?.avatar_url} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {me?.display_name || "Set your name"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">Profile & settings</span>
        </span>
        <Settings className="size-4 text-muted-foreground" />
      </Link>
    </div>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <aside className="hidden w-80 shrink-0 border-r border-border md:block">{sidebar}</aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-surface/70 px-3 py-3 backdrop-blur">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open chats">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[19rem] p-0">
              <SheetTitle className="sr-only">Chats</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>

          {activeConversation?.kind === "dm" ? (
            <UserAvatar
              name={activePartner?.display_name}
              path={activePartner?.avatar_url}
              online={isOnline(activePartner)}
              className="size-9"
            />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-sm text-muted-foreground">
              {activeConversation?.kind === "public" ? (
                <Hash className="size-4" />
              ) : (
                initialsOf(activeTitle)
              )}
            </span>
          )}

          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold">{activeTitle}</p>
            <p className="truncate text-xs text-muted-foreground">{activeSubtitle}</p>
          </div>

          {activeConversation?.kind === "group" && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={() => void leaveGroup()}
            >
              <LogOut className="mr-1.5 size-4" />
              Leave group
            </Button>
          )}
        </header>


        <div className="scroll-slim flex-1 space-y-2 overflow-y-auto px-3 py-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No messages yet. Say hi.</p>
            </div>
          )}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            return (
              <MessageBubble
                key={message.id}
                message={message}
                self={message.sender_id === user?.id}
                sender={profileMap.get(message.sender_id)}
                showSender={previous?.sender_id !== message.sender_id}
              />
            );
          })}
          <div ref={bottomRef} />
        </div>

        <Composer onSend={handleSend} placeholder={`Message ${activeTitle}`} />
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="px-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  active,
  onClick,
  leading,
  title,
  subtitle,
  badge = 0,
}: {
  active?: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
        active ? "bg-surface-2" : "hover:bg-surface-2/60",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {badge > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}