// Wheelsdown service worker: push notifications, plus opt-in offline trip sheets.
// Offline copy (Schedule tools > Save trip sheets offline): dormant unless that cache exists on this device.
// When it does, requests go to the network first and the saved copy is used only when the network fails or is
// very slow, so online you always get the current app. Turning it off (or signing out) deletes the cache.
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

// ---------------- offline trip sheets (opt-in) ----------------
const OFFLINE = "wd-offline-v1";
let offlineOn = null; // null until we've checked; set by the page via postMessage too
caches.has(OFFLINE).then((v) => { offlineOn = v; }).catch(() => { offlineOn = false; });
self.addEventListener("message", (e) => {
  const t = e.data && e.data.type;
  if (t === "wd-offline-on") offlineOn = true;
  if (t === "wd-offline-off") { offlineOn = false; e.waitUntil(caches.delete(OFFLINE)); }
});
const SKIP = /^\/api\/(dm|admin|push|family|auth|schedule\/ics)/;
async function viaOffline(req, key, slowMs) {
  const cache = await caches.open(OFFLINE);
  const net = fetch(req).then(async (res) => {
    if (res && res.ok && res.type === "basic") { try { await cache.put(key, res.clone()); } catch (_) {} }
    return res;
  });
  const saved = cache.match(key, { ignoreVary: true });
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error("slow")), slowMs))]);
  } catch (_) {
    const hit = await saved;
    if (hit) return hit;
    return net; // nothing saved: wait for (or fail with) the network
  }
}
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || offlineOn === false) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === "/sw.js" || SKIP.test(url.pathname)) return;
  const nav = req.mode === "navigate";
  const api = url.pathname.startsWith("/api/");
  const asset = url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest|ico|woff2?)$/.test(url.pathname);
  if (!nav && !api && !asset) return;
  if (offlineOn === null) { // worker just woke up: only handle page loads, after checking
    if (!nav) return;
    event.respondWith(caches.has(OFFLINE).then((v) => { offlineOn = v; return v ? viaOffline(req, "/", 4000) : fetch(req); }));
    return;
  }
  event.respondWith(viaOffline(req, nav ? "/" : req.url, nav ? 4000 : api ? 6000 : 8000));
});
