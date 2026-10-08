self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function isFocusedOnConversation(conversationId) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const focusedClient = windows.find(
    (client) => client.focused && client.visibilityState === "visible",
  );

  if (!focusedClient) return false;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => resolve(false), 1000);

    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data?.conversationId === conversationId);
      channel.port1.close();
    };

    try {
      focusedClient.postMessage(
        { type: "zchat:get-active-conversation" },
        [channel.port2],
      );
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

self.addEventListener("push", (event) => {
  console.log("[sw] PUSH RECEIVED");

  let title = "ZChat";
  let body = "You have a new message";
  let url = "/chat";
  let conversationId = null;
  let conversationName = null;
  let tag = null;

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      conversationId = data.conversation_id || data.conversationId || null;
      conversationName = data.conversation_name || data.conversationName || null;
      if (typeof data.tag === "string" && data.tag) tag = data.tag;
      if (data.url) {
        url = data.url;
      }
      if (conversationId && !new URL(url, self.location.origin).searchParams.has("c")) {
        const target = new URL(url, self.location.origin);
        target.searchParams.set("c", conversationId);
        url = `${target.pathname}${target.search}${target.hash}`;
      }
    } catch (error) {
      console.log("[sw] Could not parse push data:", error);
    }
  }

  event.waitUntil((async () => {
    if (conversationId && await isFocusedOnConversation(conversationId)) {
      console.log("[sw] Suppressed notification for the focused conversation");
      return;
    }

    await self.registration.showNotification(title, {
      body: conversationName ? `${conversationName}: ${body}` : body,
      icon: "/icons/z-512.png",
      badge: "/icons/z-512.png",
      tag: tag || `z-chat-${url}-${Date.now()}`,
      renotify: true,
      data: { url, conversationId, conversationName },
      requireInteraction: false,
    });
    console.log("[sw] Notification displayed successfully");
  })().catch((error) => {
    console.error("[sw] Notification handling FAILED:", error);
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url =
    (event.notification.data && event.notification.data.url) || "/chat";

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) {
            return client.navigate(url).then(
              (navigated) => (navigated || client).focus()
            );
          }
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    })
  );
});