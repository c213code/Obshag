/* Общак service worker: Web Push, notification actions, and a deliberately small offline layer (slice 8).
 * Only immutable same-origin static assets are cached (rules in sw-rules.js). API, auth, RSC, cross-origin, non-GET and
 * private/no-store responses are never stored, so one person's data cannot reach another on the same device. */
importScripts("/sw-rules.js");

const CACHE = "obshak-static-v1";

async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetch(self.swRules.OFFLINE_URL, { credentials: "omit", cache: "reload" });
  if (!page.ok || page.redirected) throw new Error("offline page unavailable");
  const html = await page.clone().text();
  await cache.put(self.swRules.OFFLINE_URL, page);
  const assets = new Set(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png"]);
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\)]+/g)) assets.add(m[0]);
  await Promise.all(
    [...assets].map(async (u) => {
      try {
        const res = await fetch(u, { credentials: "omit" });
        if (self.swRules.shouldCache({ url: new URL(u, self.location.origin).href, method: "GET", headers: new Headers() }, self.location.origin, res)) await cache.put(u, res);
      } catch {
        // an asset that fails to precache is simply fetched later
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (self.swRules.shouldCache(request, self.location.origin, res)) cache.put(request.url, res.clone());
  return res;
}

async function networkFirstNavigation(request) {
  // No timer: a slow network is just slow (a race with a timer used to swap a loading page for /offline). Only an actual
  // network error (fetch rejects) falls back to the cached offline page.
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(self.swRules.OFFLINE_URL)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const strategy = self.swRules.strategyFor(event.request, self.location.origin);
  if (strategy === "cache-first") event.respondWith(cacheFirst(event.request));
  else if (strategy === "network-first") event.respondWith(networkFirstNavigation(event.request));
  // everything else (API, auth, RSC, cross-origin, writes): not intercepted at all
});

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

function showReminder(data) {
  // «Ты должен Айдосу 200 ₸» · «Рассчитаться»; tapping opens the settlement with the creditor
  const who = typeof data.fromName === "string" && data.fromName ? data.fromName : "соседу";
  return self.registration.showNotification("Ты должен " + who + " " + tenge(data.amount), {
    body: "Рассчитаться",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "reminder-" + data.fromUserId,
    renotify: true,
    data: { url: "/settle/" + encodeURIComponent(data.fromUserId) },
  });
}

function showBill(data) {
  // «Коммуналка: введи сумму за ноябрь»; tapping opens the monthly screen
  const title = typeof data.title === "string" && data.title ? data.title : "Платёж";
  const month = typeof data.month === "string" && data.month ? " за " + data.month : "";
  return self.registration.showNotification(title + ": введи сумму" + month, {
    body: "Открыть ежемесячные платежи",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "bill-" + (typeof data.billId === "string" ? data.billId : "x"),
    renotify: false,
    data: { url: "/monthly" },
  });
}

function purchases(n) {
  // 1 покупка, 2-4 покупки, 5+ покупок (11-14 are покупок)
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + " покупка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + " покупки";
  return n + " покупок";
}

function showDigest(data) {
  // 19:00: one notification per user for everything still on «Потом»; tapping opens the app (Главная lists them)
  const n = Math.max(1, Math.round(Number(data.count)) || 1);
  return self.registration.showNotification("Ждут решения: " + purchases(n), {
    body: "Общее или моё? Открой Общак",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "pending-digest",
    renotify: false,
    data: { url: "/" },
  });
}

function str(v, fallback) {
  return typeof v === "string" && v ? v : fallback;
}

function showDutyToday(data) {
  // 09:00: «Сегодня готовишь ты 🍳»; tapping opens the queue
  const cooking = data.kind === "cooking";
  return self.registration.showNotification(cooking ? "Сегодня готовишь ты 🍳" : str(data.title, "Очередь") + ": сегодня твоя очередь", {
    body: "Открыть очередь",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "duty-today",
    renotify: false,
    data: { url: "/duty" },
  });
}

function showSwap(data) {
  // a swap request for the counterparty, a decline for the requester; tapping opens the request
  const asked = data.type === "swap-request";
  const name = str(data.name, "Сосед");
  const days = str(data.fromLabel, "") + " ⇄ " + str(data.toLabel, "");
  return self.registration.showNotification(asked ? name + " просит поменяться" : name + " не может поменяться", {
    body: asked ? days + " · ответь до 10:00" : days,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "swap-" + str(data.requestId, "x"),
    renotify: true,
    data: { url: typeof data.requestId === "string" ? "/duty/request/" + encodeURIComponent(data.requestId) : "/duty" },
  });
}

function show(data) {
  if (data && data.type === "duty-today") return showDutyToday(data);
  if (data && (data.type === "swap-request" || data.type === "swap-declined")) return showSwap(data);
  if (data && data.type === "digest") return showDigest(data);
  if (data && data.type === "bill") return showBill(data);
  if (data && data.type === "reminder" && typeof data.fromUserId === "string") return showReminder(data);
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
