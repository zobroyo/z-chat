self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.log("[sw] PUSH RECEIVED");

  let title = "Z-Chat";
  let body = "You have a new message";

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
    } catch (error) {
      console.log("[sw] Could not parse push data:", error);
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: "z-chat-message",
      requireInteraction: false,
    }).catch((error) => {
      console.error("[sw] showNotification FAILED:", error);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          return client.focus();
        }
      }

      return self.clients.openWindow("/chat");
    })
  );
});