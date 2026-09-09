// Minimal service worker: exists so the app can be installed to the home screen
// and so notifications can be shown while installed (required on iOS/iPadOS).
// No caching, so /~oauth and every other request always hits the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/chat");
    }),
  );
});
