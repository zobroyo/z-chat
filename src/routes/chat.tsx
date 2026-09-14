
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";import { useCallback, useEffect, useMemo, useRef, useState } from "react";import { Hash, LogOut, Menu, Search, Settings, Users } from "lucide-react";import { toast } from "sonner";import { Composer } from "@/components/chat/Composer";import { MessageBubble } from "@/components/chat/MessageBubble";import { NewGroupDialog } from "@/components/chat/NewGroupDialog";import { NotificationGate } from "@/components/NotificationGate";import { UserAvatar } from "@/components/UserAvatar";import { Button } from "@/components/ui/button";import { Input } from "@/components/ui/input";import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";import { useAuth } from "@/hooks/use-auth";import { supabase } from "@/integrations/supabase/client";import {
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
} from "@/lib/chat";import { uploadChatImage } from "@/lib/media";import { showChatNotification } from "@/lib/notifications";import { cn } from "@/lib/utils";
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

  // Start empty so we NEVER fetch messages using the fake placeholder ID.
  // A valid ?c= link is resolved after conversations have loaded.
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("c") ?? "";
  });

  const [unread, setUnread] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  
  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id);
    // This explicitly pushes the ?c= ID string into the TanStack router lifecycle state
    void navigate({ 
      search: (prev: any) => ({ ...prev, c: id }),
      replace: true 
    });
  }, [navigate]);

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

    const presence = window.setInterval(
      () => void touchPresence(user.id),
      45_000,
    );

    return () => window.clearInterval(presence);
  }, [user, reload]);

  // Live messages for every chat this person belongs to.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("z-chat-stream")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const message = payload.new as Message;
          const isActive =
            message.conversation_id === activeIdRef.current;

          if (isActive) {
            setMessages((current) =>
              current.some((item) => item.id === message.id)
                ? current
                : [...current, message],
            );
          }

          if (message.sender_id === user.id) return;

          if (!isActive) {
            setUnread((current) => ({
              ...current,
              [message.conversation_id]:
                (current[message.conversation_id] ?? 0) + 1,
            }));
          }

          if (!isActive || document.visibilityState !== "visible") {
            const sender = profilesRef.current.find(
              (item) => item.id === message.sender_id,
            );

            const title = sender?.display_name ?? "New message";
            const body = message.body ?? "Sent a photo";

            toast(title, {
              description: body,
            });

            void showChatNotification(
              title,
              body,
              message.conversation_id,
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
        },
        () => {
          void fetchProfiles().then(setProfiles).catch(() => undefined);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_members",
        },
        () => {
          void reload();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, reload]);

  const generalRoom = conversations.find(
    (item) => item.kind === "public",
  );

  // Resolve the active conversation only after conversations have loaded.
  useEffect(() => {
    if (!user || conversations.length === 0) return;

    const requestedId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("c")
        : null;

    const requestedConversation = requestedId
      ? conversations.find((item) => item.id === requestedId)
      : undefined;

    if (requestedConversation) {
      if (activeId !== requestedConversation.id) {
        setActiveId(requestedConversation.id);
      }
      return;
    }

    if (generalRoom && activeId !== generalRoom.id) {
      setActiveId(generalRoom.id);
    }
  }, [user, conversations, generalRoom]);

  // Load messages only after a real conversation ID has been resolved.
  useEffect(() => {
    if (!user || !activeId) return;

    let active = true;

    fetchMessages(activeId)
      .then((rows) => {
        if (active) setMessages(rows);
      })
      .catch(() => {
        if (active) {
          toast.error("Could not load these messages");
        }
      });

    setUnread((current) => ({
      ...current,
      [activeId]: 0,
    }));

    void markConversationRead(activeId, user.id);

    return () => {
      active = false;
    };
  }, [activeId, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      block: "end",
    });
  }, [messages]);

  const profileMap = useMemo(
    () =>
      new Map(
        profiles.map((profile) => [profile.id, profile]),
      ),
    [profiles],
  );

  const partnerOf = useCallback(
    (conversation: Conversation) => {
      if (!user) return undefined;

      const partnerId = members.find(
        (member) =>
          member.conversation_id === conversation.id &&
          member.user_id !== user.id,
      )?.user_id;

      return partnerId
        ? profileMap.get(partnerId)
        : undefined;
    },
    [members, profileMap, user],
  );

  const publicRooms = conversations.filter((item) => item.kind === "public");
  const groupRooms = conversations.filter((item) => item.kind === "group");
  const dmRooms = conversations.filter((item) => item.kind === "dm");

  const filteredProfiles = useMemo(() => {
    if (!user) return [];
    const base = profiles.filter((p) => p.id !== user.id);
    const clean = query.trim().toLowerCase();
    if (!clean) return base;
    return base.filter((p) => p.display_name.toLowerCase().includes(clean));
  }, [profiles, user, query]);

  const activeChat = conversations.find((c) => c.id === activeId);
  const activePartner = activeChat ? partnerOf(activeChat) : undefined;
  const activeTitle =
    activeChat?.kind === "public"
      ? "General"
      : activeChat?.kind === "group"
        ? (activeChat.name ?? "Group Chat")
        : (activePartner?.display_name ?? "Direct Message");

  const handleCreateDM = async (otherId: string) => {
    if (!user) return;
    try {
      const convo = await ensureDirectConversation(user.id, otherId);
      await reload();
      handleSelectConversation(convo.id);
    } catch {
      toast.error("Could not open chat");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  const currentProfile = profiles.find((p) => p.id === user?.id);

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100 w-64 border-r border-slate-800">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <span className="bg-indigo-600 px-2 py-0.5 rounded text-sm font-black">Z</span>
          ZChat
        </h1>
        <NewGroupDialog
          profiles={profiles.filter((p) => p.id !== user?.id)}

myId={user?.id ?? ""}
onCreate={async (name, ids) => {
if (!user) return;
const convo = await createGroup(user.id, name, ids);
await reload();
handleSelectConversation(convo.id);
}}
/>
Public Channels


{publicRooms.map((convo) => (
<button
key={convo.id}
onClick={() => handleSelectConversation(convo.id)}
className={cn(
"w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
activeId === convo.id
? "bg-indigo-600 text-white font-semibold"
: "text-slate-300 hover:bg-slate-800/60 hover:text-white",
)}
>

{convo.name ?? "General"}

))}

Groups

{groupRooms.length}


{groupRooms.length === 0 ? (
No groups joined
) : (

{groupRooms.map((convo) => (
<button
key={convo.id}
onClick={() => handleSelectConversation(convo.id)}
className={cn(
"w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors text-left group",
activeId === convo.id
? "bg-indigo-600 text-white font-semibold"
: "text-slate-300 hover:bg-slate-800/60 hover:text-white",
)}
>


{convo.name}

{unread[convo.id] ? (

{unread[convo.id]}

) : (
<button
onClick={(e) => {
e.stopPropagation();
if (user) void leaveConversation(convo.id, user.id).then(reload);
}}
className="text-[10px] text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0"
>
Leave

)}

))}

)}
Direct Messages



<input
type="text"
placeholder="Find user..."
value={query}
onChange={(e) => setQuery(e.target.value)}
className="bg-transparent text-xs w-full text-white placeholder-slate-500 outline-none py-1"
/>
{query.trim() && (


Search Results

{filteredProfiles.length === 0 ? (
No users found
) : (
filteredProfiles.map((p) => (
<button
key={p.id}
onClick={() => {
void handleCreateDM(p.id);
setQuery("");
}}
className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 text-xs text-left text-slate-200 transition-colors"
>

{p.display_name}

))
)}

)}
{dmRooms.length === 0 ? (
No open DMs
) : (

{dmRooms.map((convo) => {
const partner = partnerOf(convo);
if (!partner) return null;
const online = isOnline(partner);
return (
<button
key={convo.id}
onClick={() => handleSelectConversation(convo.id)}
className={cn(
"w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
activeId === convo.id
? "bg-indigo-600 text-white font-semibold"
: "text-slate-300 hover:bg-slate-800/60 hover:text-white",
)}
>



{online && (

)}

{partner.display_name}

{unread[convo.id] ? (

{unread[convo.id]}

) : null}

);
})}

)}

{currentProfile?.display_name ?? "User"}


Online




<Button
variant="ghost"
size="icon"
onClick={() => void handleLogout()}
className="h-8 w-8 text-slate-400 hover:text-rose-400 hover:bg-slate-800"
>





);
return (




Navigation Sidebar


{activeChat?.kind === "public" && }
{activeTitle}

{activeChat?.kind === "dm" && activePartner && (

{isOnline(activePartner) ? "active now" : "offline"}

)}
{activeChat?.kind === "group" && (

Group Conversation

)}


{messages.length === 0 ? (




Welcome to {activeTitle}!
This is the absolute beginning of your message stream history. Send a ping to start things off.

) : (
messages.map((item) => (
<MessageBubble
key={item.id}
message={item}
myId={user?.id ?? ""}
profiles={profiles}
/>
))
)}

<Composer
onSend={async (text, file) => {
if (!user || !activeId) return;
try {
let imagePath: string | null = null;
if (file) {
toast.loading("Sending photo...", { id: "upload" });
imagePath = await uploadChatImage(file);
toast.success("Photo sent", { id: "upload" });
}
await sendMessage({
conversationId: activeId,
senderId: user.id,
body: text,
imagePath,
});
} catch (e: any) {
toast.error(e.message || "Failed to deliver message", { id: "upload" });
}
}}
/>




);
}




