// Wheelsdown service worker: push notifications ONLY.
// No fetch handler and no caching on purpose, so it can never serve an old version of the app.
// Payload (server/push.ts) uses Apple's Declarative Web Push shape: { web_push: 8030, notification: { title, body, navigate, silent, tag } }.
// iOS 18.4+ can show that without us; everywhere else (Android, desktop, older iOS) this file shows it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { notification: { title: "Wheelsdown", body: event.data ? event.data.text() : "" } }; }
  const n = data.notification || {};
  const title = n.title || "Wheelsdown";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: n.body || "",
      tag: n.tag || undefined,
      silent: !!n.silent,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: n.navigate || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); } catch (_) {}
        try { return await c.navigate(url); } catch (_) { c.postMessage({ type: "wd-open", url }); return; }
      }
    }
    return self.clients.openWindow(url);
  })());
});
