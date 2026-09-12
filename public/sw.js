self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.log("[sw] PUSH RECEIVED");

  let title = "ZChat";
  let body = "You have a new message";
  let url = "/chat";

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      if (data.url) {
        url = data.url;
      } else if (data.conversationId || data.conversation_id) {
        url = `/chat?c=${data.conversationId || data.conversation_id}`;
      }
    } catch (error) {
      console.log("[sw] Could not parse push data:", error);
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: "z-chat-message",
      data: { url: url },
      requireInteraction: false,
    }).catch((error) => {
      console.error("[sw] showNotification FAILED:", error);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/chat";

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) {
            return client.navigate(url).then((navigated) => (navigated || client).focus());
          }
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    })
  );
});
