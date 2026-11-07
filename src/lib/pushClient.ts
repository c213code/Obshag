import type { Repo } from "@/lib/data/repo";
import { isIos, isStandalone, urlBase64ToUint8Array } from "./pwa";
import { decidePushStatus, type PushStatus } from "./pushState";

const hasPushApi = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** The state of the notification pill right now (reads, never prompts). */
export async function readPushStatus(vapidKey: string | undefined): Promise<PushStatus> {
  const api = hasPushApi();
  return decidePushStatus({
    ios: isIos(),
    standalone: isStandalone(),
    hasPushApi: api,
    vapidKey,
    permission: "Notification" in window ? Notification.permission : "unsupported",
    subscribed: api ? !!(await currentSubscription()) : false,
  });
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const have = sub.options?.applicationServerKey;
  if (!have) return true; // cannot tell: keep it
  const a = new Uint8Array(have);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function saveSubscription(repo: Repo, sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("incomplete subscription");
  await repo.savePushSubscription({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
}

/** Reuse the device subscription when it was made with the current VAPID key; otherwise drop it and subscribe again. */
async function ensureSubscription(reg: ServiceWorkerRegistration, vapidKey: string): Promise<PushSubscription> {
  const key = urlBase64ToUint8Array(vapidKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing, key)) return existing;
  if (existing) await existing.unsubscribe().catch(() => false);
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/**
 * «Включить уведомления»: ask for permission (must be the first await, inside the tap), subscribe, save the subscription.
 * Call it only while the pill is «off». Returns the resulting status; throws only when subscribing or saving fails.
 */
export async function enablePush(repo: Repo, vapidKey: string | undefined): Promise<PushStatus> {
  if (!vapidKey || !hasPushApi()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await withTimeout(navigator.serviceWorker.ready, 5000); // a missing worker must not hang the button
  await saveSubscription(repo, await ensureSubscription(reg, vapidKey));
  return "on";
}

/** Status «on»: quietly re-save this device's subscription so the server row belongs to the current user and key. */
export async function syncPush(repo: Repo, vapidKey: string | undefined): Promise<void> {
  if (!vapidKey || !hasPushApi() || Notification.permission !== "granted") return;
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 5000);
    await saveSubscription(repo, await ensureSubscription(reg, vapidKey));
  } catch {
    // best effort: the pill still says «on» and the next visit retries
  }
}

/** Sign-out: remove this device's subscription from the server (it must not keep notifying the previous user), then locally. */
export async function removeDevicePush(repo: Repo): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await repo.deletePushSubscription(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  } catch {
    // signing out must never be blocked by push cleanup
  }
}
