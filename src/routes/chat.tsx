import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bug,
  Gamepad2,
  Hash,
  LogOut,
  Menu,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { BanAppealDialog } from "@/components/chat/BanAppealDialog";
import { CallButton } from "@/components/call/CallButton";
import { CallOverlay } from "@/components/call/CallOverlay";
import { Composer } from "@/components/chat/Composer";
import { GamesAnnouncementDialog } from "@/components/chat/GamesAnnouncementDialog";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { NewGroupDialog } from "@/components/chat/NewGroupDialog";
import { NotificationGate } from "@/components/NotificationGate";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useCall } from "@/hooks/use-call";
import { checkIsAdmin } from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";
import {
  createGroup,
  deliverPendingMessages,
  ensureDirectConversation,
  fetchConversations,
  fetchMembers,
  fetchMessageReceipts,
  fetchMessages,
  fetchProfiles,
  initialsOf,
  isOnline,
  leaveConversation,
  markConversationRead,
  markMessagesDelivered,
  markMessagesRead,
  sendMessage,
  touchPresence,
  type Conversation,
  type Member,
  type Message,
  type MessageReceipt,
  type Profile,
} from "@/lib/chat";
import { uploadChatImage } from "@/lib/media";
import { recordDeviceFingerprint } from "@/lib/fingerprint";
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
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }

    let cancelled = false;

    checkIsAdmin(user.id).then((v) => {
      if (!cancelled) {
        setIsAdmin(v);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageReceipts, setMessageReceipts] = useState<MessageReceipt[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [enteringMessageIds, setEnteringMessageIds] = useState<Set<string>>(() => new Set());
  const [switchingConversation, setSwitchingConversation] = useState(false);

  // Start empty so we NEVER fetch messages using the fake placeholder ID.
  // A valid ?c= link is resolved after conversations have loaded.
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return "";

    return new URLSearchParams(window.location.search).get("c") ?? "";
  });

  const [unread, setUnread] = useState<Record<string, number>>({});
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [banAppealOpen, setBanAppealOpen] = useState(false);
  const isNearBottomRef = useRef(true);
  const messageEntryTimersRef = useRef(new Map<string, number>());
  const conversationSwitchTimerRef = useRef<number | null>(null);

  const handleSelectConversation = useCallback(
    (id: string) => {
      isNearBottomRef.current = true;
      setActiveId(id);

      // This explicitly pushes the ?c= ID string into the TanStack router lifecycle state
      void navigate({
        to: "/chat",
        search: { c: id },
        replace: true,
      });
    },
    [navigate],
  );

  const activeIdRef = useRef(activeId);
  const profilesRef = useRef<Profile[]>([]);
  const messageListRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const receiptQueueRef = useRef(new Map<string, { conversationId: string; read: boolean }>());
  const receiptTimerRef = useRef<number | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingChannelReadyRef = useRef(false);
  const isTypingRef = useRef(false);
  const presenceTrackedRef = useRef(false);

  const animateMessageEntry = useCallback((messageId: string) => {
    setEnteringMessageIds((current) => new Set(current).add(messageId));
    const previousTimer = messageEntryTimersRef.current.get(messageId);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      setEnteringMessageIds((current) => {
        if (!current.has(messageId)) return current;
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
      messageEntryTimersRef.current.delete(messageId);
    }, 260);
    messageEntryTimersRef.current.set(messageId, timer);
  }, []);

  const clearMessageEntry = useCallback((messageId: string) => {
    const timer = messageEntryTimersRef.current.get(messageId);
    if (timer !== undefined) window.clearTimeout(timer);
    messageEntryTimersRef.current.delete(messageId);
    setEnteringMessageIds((current) => {
      if (!current.has(messageId)) return current;
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      messageEntryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (conversationSwitchTimerRef.current !== null) {
        window.clearTimeout(conversationSwitchTimerRef.current);
      }
    },
    [],
  );

  activeIdRef.current = activeId;
  profilesRef.current = profiles;

  const updateNearBottom = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return;
    isNearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 120;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    let keepMessagesAtBottom = false;

    const updateViewport = (keepBottom = false) => {
      keepMessagesAtBottom ||= keepBottom;
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        root.style.setProperty(
          "--zchat-visual-viewport-height",
          `${viewport?.height ?? window.innerHeight}px`,
        );
        root.style.setProperty(
          "--zchat-visual-viewport-offset-top",
          `${Math.max(0, viewport?.offsetTop ?? 0)}px`,
        );
        root.style.setProperty(
          "--zchat-dialog-center-y",
          `${Math.max(0, viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) / 2}px`,
        );
        if (keepMessagesAtBottom && isNearBottomRef.current) {
          bottomRef.current?.scrollIntoView({ block: "end" });
        }
        keepMessagesAtBottom = false;
      });
    };
    const updateAfterResize = () => updateViewport(true);
    const updateAfterScroll = () => updateViewport();

    updateAfterResize();
    viewport?.addEventListener("resize", updateAfterResize);
    viewport?.addEventListener("scroll", updateAfterScroll);
    window.addEventListener("resize", updateAfterResize);
    window.addEventListener("orientationchange", updateAfterResize);
    window.addEventListener("pageshow", updateAfterResize);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", updateAfterResize);
      viewport?.removeEventListener("scroll", updateAfterScroll);
      window.removeEventListener("resize", updateAfterResize);
      window.removeEventListener("orientationchange", updateAfterResize);
      window.removeEventListener("pageshow", updateAfterResize);
      root.style.removeProperty("--zchat-visual-viewport-height");
      root.style.removeProperty("--zchat-visual-viewport-offset-top");
      root.style.removeProperty("--zchat-dialog-center-y");
    };
  }, []);

  const queueReceipt = useCallback(
    (messageId: string, conversationId: string, read: boolean) => {
      if (messageId.startsWith("temp-")) return;
      const queued = receiptQueueRef.current.get(messageId);
      receiptQueueRef.current.set(messageId, {
        conversationId,
        read: read || queued?.read === true,
      });
      if (receiptTimerRef.current !== null) return;
      receiptTimerRef.current = window.setTimeout(() => {
        receiptTimerRef.current = null;
        const batch = [...receiptQueueRef.current.entries()];
        receiptQueueRef.current.clear();
        const byConversation = new Map<string, { delivered: string[]; read: string[] }>();
        for (const [id, value] of batch) {
          const rows = byConversation.get(value.conversationId) ?? { delivered: [], read: [] };
          if (
            value.read &&
            value.conversationId === activeIdRef.current &&
            document.visibilityState === "visible" &&
            document.hasFocus()
          ) {
            rows.read.push(id);
          } else {
            rows.delivered.push(id);
          }
          byConversation.set(value.conversationId, rows);
        }
        for (const [conversationId, ids] of byConversation) {
          if (ids.delivered.length) {
            if (user) {
              const deliveredAt = new Date().toISOString();
              void markMessagesDelivered(conversationId, user.id, ids.delivered)
                .then(() =>
                  setMessageReceipts((current) =>
                    mergeReceipts(
                      current,
                      ids.delivered,
                      user.id,
                      conversationId,
                      deliveredAt,
                      false,
                    ),
                  ),
                )
                .catch(() => undefined);
            }
          }
          if (ids.read.length && user) {
            const readAt = new Date().toISOString();
            void markMessagesRead(conversationId, user.id, ids.read)
              .then(() =>
                setMessageReceipts((current) =>
                  mergeReceipts(current, ids.read, user.id, conversationId, readAt, true),
                ),
              )
              .catch(() => undefined);
            if (conversationId === activeIdRef.current)
              void markConversationRead(conversationId, user.id).catch(() => undefined);
          }
        }
      }, 250);
    },
    [user],
  );

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    isTypingRef.current = false;
    if (presenceTrackedRef.current) {
      presenceTrackedRef.current = false;
      void typingChannelRef.current?.untrack().catch(() => undefined);
    }
  }, []);

  const startTyping = useCallback(() => {
    if (!user) return;
    if (document.visibilityState !== "visible" || !document.hasFocus()) {
      stopTyping();
      return;
    }
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      const channel = typingChannelRef.current;
      if (typingChannelReadyRef.current && channel) {
        presenceTrackedRef.current = true;
        void channel.track({ userId: user.id, typing: true }).catch(() => {
          presenceTrackedRef.current = false;
        });
      }
    }
    typingTimeoutRef.current = window.setTimeout(stopTyping, 2200);
  }, [user, stopTyping]);

  useEffect(() => {
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "zchat:get-active-conversation") return;

      const conversationId =
        document.visibilityState === "visible" && document.hasFocus() ? activeIdRef.current : null;
      event.ports[0]?.postMessage({ conversationId });
    };

    navigator.serviceWorker?.addEventListener("message", handleWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleWorkerMessage);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      void navigate({ to: "/" });
    }
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
    void deliverPendingMessages(user.id).catch(() => undefined);
    void touchPresence(user.id);
    void recordDeviceFingerprint();

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
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const message = payload.new as Message;
          const isActive = message.conversation_id === activeIdRef.current;

          // Our own sends are added optimistically in handleSend and
          // reconciled directly from the insert response.
          if (message.sender_id === user.id) return;

          if (isActive) {
            animateMessageEntry(message.id);
            setMessages((current) =>
              current.some((item) => item.id === message.id) ? current : [...current, message],
            );
          }

          queueReceipt(
            message.id,
            message.conversation_id,
            isActive && document.visibilityState === "visible" && document.hasFocus(),
          );

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

            toast(title, {
              description: body,
            });
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
        (payload) => {
          const profileId =
            (payload.new as Partial<Profile> | null)?.id ??
            (payload.old as Partial<Profile> | null)?.id;
          if (!profileId) return;

          if (payload.eventType === "DELETE") {
            setProfiles((current) => current.filter((profile) => profile.id !== profileId));
            return;
          }

          const profile = payload.new as Profile;
          setProfiles((current) => {
            const next = current.filter((item) => item.id !== profile.id);
            next.push(profile);
            return next.sort((a, b) => a.display_name.localeCompare(b.display_name));
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_members" },
        () => void reload(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "conversation_members" },
        () => void reload(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, reload, queueReceipt, animateMessageEntry]);

  useEffect(() => {
    if (!user || !activeId) return;
    const channel = supabase
      .channel(`z-chat-receipts-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_receipts",
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          const receipt = (payload.new ?? payload.old) as MessageReceipt;
          if (!receipt?.message_id) return;
          setMessageReceipts((current) => {
            const index = current.findIndex(
              (item) =>
                item.message_id === receipt.message_id &&
                item.recipient_id === receipt.recipient_id,
            );
            if (index < 0) return [...current, receipt];
            const next = current.slice();
            const previous = next[index];
            if (!previous) return [...current, receipt];
            next[index] = {
              ...previous,
              ...receipt,
              delivered_at: receipt.delivered_at ?? previous.delivered_at,
              read_at: receipt.read_at ?? previous.read_at,
            };
            return next;
          });
        },
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [user, activeId]);

  const generalRoom = conversations.find((item) => item.kind === "public");

  // Resolve the active conversation only after conversations have loaded.
  const conversationInitializedRef = useRef(false);

  useEffect(() => {
    if (!user || conversations.length === 0) return;
    if (conversationInitializedRef.current) return;

    const requestedId =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("c") : null;

    const requestedConversation = requestedId
      ? conversations.find((item) => item.id === requestedId)
      : undefined;

    if (requestedConversation) {
      setActiveId(requestedConversation.id);
      conversationInitializedRef.current = true;
      return;
    }

    if (generalRoom) {
      setActiveId(generalRoom.id);
      conversationInitializedRef.current = true;
    }
  }, [user, conversations, generalRoom]);

  // Load messages only after a real conversation ID has been resolved.
  useEffect(() => {
    if (!user || !activeId) return;

    setReplyingTo(null);
    setMessages([]);
    setMessageReceipts([]);
    let active = true;

    fetchMessages(activeId)
      .then(async (rows) => {
        if (active) {
          setMessages(rows);
          const receipts = await fetchMessageReceipts(
            activeId,
            rows.map((row) => row.id),
          );
          if (!active) return;
          setMessageReceipts(receipts);
          const incomingIds = rows.filter((row) => row.sender_id !== user.id).map((row) => row.id);
          const isViewing =
            document.visibilityState === "visible" &&
            document.hasFocus() &&
            activeIdRef.current === activeId;
          const toAcknowledge = incomingIds.filter((id) => {
            const receipt = receipts.find(
              (item) => item.message_id === id && item.recipient_id === user.id,
            );
            return isViewing ? !receipt?.read_at : !receipt?.delivered_at;
          });
          toAcknowledge.forEach((id) => queueReceipt(id, activeId, isViewing));
          if (isViewing) {
            setUnread((current) => ({ ...current, [activeId]: 0 }));
            void markConversationRead(activeId, user.id).catch(() => undefined);
          }
        }
      })
      .catch(() => {
        if (active) {
          toast.error("Could not load these messages");
        }
      });

    return () => {
      active = false;
    };
  }, [activeId, user, queueReceipt]);

  useEffect(() => {
    if (!user || !activeId) return;
    let timer: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void deliverPendingMessages(user.id).catch(() => undefined);
        void fetchMessages(activeId)
          .then(async (rows) => {
            if (activeIdRef.current !== activeId) return;
            setMessages(rows);
            const receipts = await fetchMessageReceipts(
              activeId,
              rows.map((row) => row.id),
            );
            if (activeIdRef.current !== activeId) return;
            setMessageReceipts((current) => mergeFetchedReceipts(current, receipts));
            const ids = rows
              .filter((row) => row.sender_id !== user.id)
              .map((row) => row.id)
              .filter(
                (id) =>
                  !receipts.some(
                    (receipt) =>
                      receipt.message_id === id &&
                      receipt.recipient_id === user.id &&
                      receipt.read_at,
                  ),
              );
            ids.forEach((id) => queueReceipt(id, activeId, true));
            if (
              ids.length &&
              activeIdRef.current === activeId &&
              document.visibilityState === "visible" &&
              document.hasFocus()
            ) {
              void markConversationRead(activeId, user.id).catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }, 200);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, activeId, queueReceipt]);

  useEffect(
    () => () => {
      if (receiptTimerRef.current !== null) window.clearTimeout(receiptTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!user || !activeId) return;

    let disposed = false;
    const channel = supabase.channel(`zchat:typing:${activeId}`, {
      config: {
        private: true,
        presence: { key: `${user.id}:${crypto.randomUUID()}` },
      },
    });
    typingChannelRef.current = channel;
    typingChannelReadyRef.current = false;

    channel.on("presence", { event: "sync" }, () => {
      const presence = channel.presenceState<{ userId?: string; typing?: boolean }>();
      const ids = Object.values(presence)
        .flat()
        .filter((state) => state.typing && state.userId && state.userId !== user.id)
        .map((state) => state.userId as string);
      setTypingUserIds([...new Set(ids)]);
    });

    const stopWhenUnavailable = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) stopTyping();
    };
    window.addEventListener("blur", stopTyping);
    document.addEventListener("visibilitychange", stopWhenUnavailable);

    channel.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        typingChannelReadyRef.current = true;
        if (
          isTypingRef.current &&
          typingTimeoutRef.current !== null &&
          document.visibilityState === "visible" &&
          document.hasFocus()
        ) {
          presenceTrackedRef.current = true;
          void channel.track({ userId: user.id, typing: true }).catch(() => {
            presenceTrackedRef.current = false;
          });
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        typingChannelReadyRef.current = false;
        presenceTrackedRef.current = false;
        setTypingUserIds([]);
      }
    });

    return () => {
      disposed = true;
      window.removeEventListener("blur", stopTyping);
      document.removeEventListener("visibilitychange", stopWhenUnavailable);
      stopTyping();
      typingChannelReadyRef.current = false;
      setTypingUserIds([]);
      if (typingChannelRef.current === channel) typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [user, activeId, stopTyping]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const mentionNames = useMemo(
    () => Object.fromEntries(profiles.map((profile) => [profile.id, profile.display_name])),
    [profiles],
  );
  const mentionCandidates = useMemo(
    () => profiles.map((profile) => ({ id: profile.id, name: profile.display_name })),
    [profiles],
  );
  const receiptsByMessage = useMemo(() => {
    const grouped = new Map<string, MessageReceipt[]>();
    for (const receipt of messageReceipts) {
      const rows = grouped.get(receipt.message_id);
      if (rows) rows.push(receipt);
      else grouped.set(receipt.message_id, [receipt]);
    }
    return grouped;
  }, [messageReceipts]);

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

  const groups = conversations.filter((item) => item.kind === "group");

  const directChats = conversations.filter((item) => {
    if (item.kind !== "dm" || !user) return false;

    return members.some(
      (member) => member.conversation_id === item.id && member.user_id === user.id,
    );
  });

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

  const typingNames = [...new Set(typingUserIds)].map(
    (id) => profileMap.get(id)?.display_name ?? "Someone",
  );
  const typingLabel =
    typingNames.length === 0
      ? null
      : typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing…`
          : typingNames.length === 3
            ? `${typingNames[0]}, ${typingNames[1]} and ${typingNames[2]} are typing…`
            : `${typingNames[0]}, ${typingNames[1]} and ${typingNames.length - 2} others are typing…`;

  const openConversation = (id: string) => {
    isNearBottomRef.current = true;
    if (id !== activeId) {
      setSwitchingConversation(true);
      if (conversationSwitchTimerRef.current !== null) {
        window.clearTimeout(conversationSwitchTimerRef.current);
      }
      conversationSwitchTimerRef.current = window.setTimeout(() => {
        setSwitchingConversation(false);
        conversationSwitchTimerRef.current = null;
      }, 180);
    }
    handleSelectConversation(id);
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
    if (!user || activeConversation?.kind !== "group") {
      return;
    }

    if (!window.confirm(`Leave ${activeConversation.name ?? "this group"}?`)) {
      return;
    }

    try {
      await leaveConversation(activeConversation.id, user.id);
      isNearBottomRef.current = true;

      if (generalRoom) {
        setActiveId(generalRoom.id);
      } else {
        setActiveId("");
      }

      await reload();
      toast.success("You left the group");
    } catch {
      toast.error("Could not leave that group");
    }
  };

  const handleSend = async (body: string, file: File | null) => {
    stopTyping();
    if (!user || !activeId) return;
    isNearBottomRef.current = true;

    const trimmed = body.trim();
    const replyToMessageId = replyingTo?.id ?? null;

    // Show it instantly instead of waiting on the upload/insert/Realtime
    // round trip. Only for text.
    let tempId: string | null = null;

    if (trimmed && !file) {
      tempId = `temp-${crypto.randomUUID()}`;

      const optimisticMessage: Message = {
        id: tempId,
        conversation_id: activeId,
        sender_id: user.id,
        body: trimmed,
        image_url: null,
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToMessageId,
      };

      animateMessageEntry(tempId);
      setMessages((current) => [...current, optimisticMessage]);
    }

    try {
      const imagePath = file ? await uploadChatImage(activeId, file) : null;

      // Send the on-screen history with the message so the moderation server
      // does not need extra database round-trips for context.
      const moderationHistory = messages
        .slice(-10)
        .map((item) => ({
          username:
            item.sender_id === user.id
              ? (me?.display_name ?? "You")
              : (profileMap.get(item.sender_id)?.display_name ?? "user"),
          content: (item.body ?? "").slice(0, 140),
        }))
        .filter((entry) => entry.content.trim().length > 0);

      const inserted = await sendMessage({
        conversationId: activeId,
        senderId: user.id,
        body,
        imagePath,
        replyToMessageId,
        history: moderationHistory,
      });

      if (tempId && inserted) {
        const finalTempId = tempId;
        clearMessageEntry(finalTempId);

        setMessages((current) =>
          current.map((item) => (item.id === finalTempId ? inserted : item)),
        );
      } else if (inserted) {
        animateMessageEntry(inserted.id);
        setMessages((current) =>
          current.some((item) => item.id === inserted.id) ? current : [...current, inserted],
        );
      }
    } catch (error) {
      if (tempId) {
        const finalTempId = tempId;
        clearMessageEntry(finalTempId);

        setMessages((current) => current.filter((item) => item.id !== finalTempId));
      }

      // Make the ban obvious instead of a generic "failed to send": open the
      // appeal dialog (the one channel that stays open while banned).
      if (error instanceof Error && (error as Error & { banned?: boolean }).banned) {
        setBanAppealOpen(true);
      }

      throw error;
    }
  };

  const toggleGroupModeration = async () => {
    if (
      !user ||
      activeConversation?.kind !== "group" ||
      activeConversation.created_by !== user.id
    ) {
      return;
    }
    const next = !activeConversation.ai_moderation_enabled;
    const { error } = await supabase
      .from("conversations")
      .update({ ai_moderation_enabled: next })
      .eq("id", activeConversation.id);
    if (error) {
      toast.error("Couldn't update AI moderation right now");
      return;
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, ai_moderation_enabled: next }
          : conversation,
      ),
    );
    toast.success(
      next ? "AI moderation enabled for this group" : "AI moderation disabled for this group",
    );
  };

  const me = user ? profileMap.get(user.id) : undefined;

  const call = useCall(activeId || null, {
    id: user?.id ?? "",
    name: me?.display_name || "You",
  });

  useEffect(() => {
    if (call.error) toast.error(call.error);
  }, [call.error]);

  const sidebar = (
    <div className="ios-safe-top ios-safe-bottom flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary font-display text-sm font-extrabold text-primary-foreground">
          Z
        </span>

        <span className="font-display text-base font-bold">ZChat</span>

        <div className="ml-auto flex items-center">
          <NewGroupDialog people={others} onCreate={makeGroup} />

          <NotificationGate userId={user?.id ?? ""} />
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

      <a
        href="https://game.z-chat.men"
        className="mx-3 my-3 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-semibold tracking-wide text-primary-foreground shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Gamepad2 className="size-4" />
        UNBLOCKED GAMES
      </a>
      <a
        href="https://forms.gle/FdvZyi4nLM92i1yaA"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bug className="size-4" />
        Bugs &amp; Suggestions
      </a>

      {isAdmin && (
        <Link
          to="/admin"
          className="flex items-center gap-3 border-t border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Shield className="size-4" />
          Admin panel
        </Link>
      )}

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
    <div className="chat-app-shell flex overflow-hidden">
      <GamesAnnouncementDialog userId={user?.id ?? ""} />
      <BanAppealDialog
        open={banAppealOpen}
        onOpenChange={setBanAppealOpen}
        userId={user?.id ?? ""}
      />

      <aside className="hidden w-80 shrink-0 border-r border-border md:block">{sidebar}</aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="ios-safe-top flex shrink-0 items-center gap-3 border-b border-border bg-surface/70 px-3 py-3 backdrop-blur">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open chats">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>

            <SheetContent side="left" className="ios-mobile-sheet w-[19rem] p-0">
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

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <CallButton
              onJoin={() => void call.joinCall()}
              joining={call.joining}
              inCall={call.inCall}
              disabled={!activeId}
            />

            {activeConversation?.kind === "group" && activeConversation.created_by === user?.id && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-muted-foreground",
                  !activeConversation.ai_moderation_enabled && "text-destructive",
                )}
                title={
                  activeConversation.ai_moderation_enabled
                    ? "AI moderation is ON for this group (click to turn off)"
                    : "AI moderation is OFF for this group (click to turn on)"
                }
                onClick={() => void toggleGroupModeration()}
              >
                {activeConversation.ai_moderation_enabled ? (
                  <ShieldCheck className="mr-1.5 size-4" />
                ) : (
                  <ShieldOff className="mr-1.5 size-4" />
                )}
                AI moderation
              </Button>
            )}

            {activeConversation?.kind === "group" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => void leaveGroup()}
              >
                <LogOut className="mr-1.5 size-4" />
                Leave group
              </Button>
            )}
          </div>
        </header>

        {me?.banned && (
          <div className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2.5">
            <ShieldAlert className="size-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 text-sm text-foreground">
              Your account is banned — you can&apos;t send messages.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBanAppealOpen(true)}
              className="shrink-0"
            >
              Appeal ban
            </Button>
          </div>
        )}

        <div
          ref={messageListRef}
          onScroll={updateNearBottom}
          className={cn(
            "chat-message-list scroll-slim min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4",
            switchingConversation && "conversation-enter",
          )}
        >
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="empty-state-enter text-sm text-muted-foreground">
                No messages yet. Say hi.
              </p>
            </div>
          )}

          {messages.map((message, index) => {
            const previous = messages[index - 1];

            const replyTarget = message.reply_to_message_id
              ? messages.find((item) => item.id === message.reply_to_message_id)
              : undefined;

            const replyPreview = message.reply_to_message_id
              ? replyTarget
                ? {
                    senderName:
                      replyTarget.sender_id === user?.id
                        ? "You"
                        : (profileMap.get(replyTarget.sender_id)?.display_name ?? "Someone"),
                    snippet: replyTarget.body ?? "Sent a photo",
                  }
                : null
              : undefined;

            return (
              <MessageBubble
                key={message.id}
                message={message}
                animateIn={enteringMessageIds.has(message.id)}
                self={message.sender_id === user?.id}
                sender={profileMap.get(message.sender_id)}
                showSender={previous?.sender_id !== message.sender_id}
                replyPreview={replyPreview}
                receipts={receiptsByMessage.get(message.id) ?? []}
                groupChat={activeConversation?.kind !== "dm"}
                mentionNames={mentionNames}
                onReply={() => setReplyingTo(message)}
                onJumpToReply={
                  message.reply_to_message_id
                    ? () => {
                        const target = document.getElementById(
                          `message-${message.reply_to_message_id}`,
                        );
                        target?.scrollIntoView({
                          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                            ? "auto"
                            : "smooth",
                          block: "center",
                        });
                        const bubble = target?.querySelector<HTMLElement>(".message-bubble");
                        if (bubble) {
                          bubble.classList.remove("message-highlight");
                          requestAnimationFrame(() => bubble.classList.add("message-highlight"));
                        }
                      }
                    : undefined
                }
              />
            );
          })}

          <div ref={bottomRef} />
        </div>

        {typingLabel && (
          <p
            className="typing-enter shrink-0 px-5 pb-1 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-muted-foreground align-middle" />
            {typingLabel}
          </p>
        )}
        <Composer
          onSend={handleSend}
          onTypingChange={(isTyping) => (isTyping ? startTyping() : stopTyping())}
          placeholder={`Message ${activeTitle}`}
          mentionCandidates={mentionCandidates}
          replyingTo={
            replyingTo
              ? {
                  senderName:
                    replyingTo.sender_id === user?.id
                      ? "yourself"
                      : (profileMap.get(replyingTo.sender_id)?.display_name ?? "Someone"),
                  snippet: replyingTo.body ?? "Sent a photo",
                }
              : null
          }
          onCancelReply={() => setReplyingTo(null)}
        />
      </main>

      <CallOverlay call={call} conversationTitle={activeTitle} />
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
        "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.99]",
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

function mergeReceipts(
  current: MessageReceipt[],
  messageIds: string[],
  recipientId: string,
  conversationId: string,
  timestamp: string,
  read: boolean,
) {
  const ids = new Set(messageIds);
  const found = new Set<string>();
  const next = current.map((receipt) => {
    if (!ids.has(receipt.message_id) || receipt.recipient_id !== recipientId) return receipt;
    found.add(receipt.message_id);
    return {
      ...receipt,
      delivered_at: receipt.delivered_at ?? timestamp,
      read_at: read ? (receipt.read_at ?? timestamp) : receipt.read_at,
    };
  });
  for (const id of ids) {
    if (!found.has(id))
      next.push({
        message_id: id,
        conversation_id: conversationId,
        recipient_id: recipientId,
        delivered_at: timestamp,
        read_at: read ? timestamp : null,
      });
  }
  return next;
}

function mergeFetchedReceipts(current: MessageReceipt[], fetched: MessageReceipt[]) {
  const byKey = new Map(current.map((row) => [`${row.message_id}:${row.recipient_id}`, row]));
  for (const row of fetched) {
    const key = `${row.message_id}:${row.recipient_id}`;
    const previous = byKey.get(key);
    byKey.set(
      key,
      previous
        ? {
            ...row,
            delivered_at: row.delivered_at ?? previous.delivered_at,
            read_at: row.read_at ?? previous.read_at,
          }
        : row,
    );
  }
  return [...byKey.values()];
}
