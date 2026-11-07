/* Общак service worker (slice 4): Web Push + notification actions only.
 * No fetch handler and no caches: auth and API responses are never cached here (offline caching is slice 8). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function tenge(amount) {
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n)) return "";
  // NBSP between thousands, like the app's formatTenge
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸";
}

function pendingUrl(purchaseId, choice) {
  const base = "/pending/" + encodeURIComponent(purchaseId);
  return choice === "shared" || choice === "personal" ? base + "?choice=" + choice : base;
}

function show(data) {
  const ok = data && data.type === "pending" && typeof data.purchaseId === "string";
  if (!ok) {
    // iOS revokes push permission for a worker that receives a push without showing a notification: always show one
    return self.registration.showNotification("Общак", {
      body: "Новая покупка",
      icon: "/icons/icon-192.png",
      tag: "pending-unknown",
      data: { url: "/" },
    });
  }
  const merchant = typeof data.merchant === "string" && data.merchant ? data.merchant : "Покупка Apple Pay";
  return self.registration.showNotification(merchant + " · " + tenge(data.amount), {
    body: "Что купил? Общее или моё",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "pending-" + data.purchaseId,
    renotify: false,
    requireInteraction: true,
    actions: [
      { action: "shared", title: "Общее" },
      { action: "personal", title: "Моё" },
    ],
    data: { purchaseId: data.purchaseId, url: pendingUrl(data.purchaseId) },
  });
}

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  event.waitUntil(show(data));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  const key = old && old.options ? old.options.applicationServerKey : null;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((list) => list.forEach((c) => c.postMessage({ type: "push-resubscribed" })))
      .catch(() => undefined),
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  n.close();
  const data = n.data || {};
  // the action only pre-selects a button: the user still confirms in the app
  const url = typeof data.purchaseId === "string" ? pendingUrl(data.purchaseId, event.action) : typeof data.url === "string" ? data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const mine = list.filter((c) => new URL(c.url).origin === self.location.origin);
      const target = mine.find((c) => c.visibilityState === "visible") || mine[0];
      if (!target) return self.clients.openWindow(url);
      return target
        .focus()
        .then((c) => ("navigate" in (c || target) ? (c || target).navigate(url) : self.clients.openWindow(url)))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
