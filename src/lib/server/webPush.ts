import "server-only";
import { sendNotification } from "web-push";
import type { PushPayload, PushResult, PushSender } from "./push";
import { isAllowedPushEndpoint } from "@/lib/domain/pushEndpoint";
import type { PushSubscriptionInput } from "@/lib/data/types";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** VAPID from the server env; null when any piece is missing (push is then skipped, captures still succeed). */
export function readVapid(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** The real sender. Notification text is composed in the service worker, so the payload stays small. */
export function createWebPushSender(config: VapidConfig): PushSender {
  return {
    async send(subscription: PushSubscriptionInput, payload: PushPayload): Promise<PushResult> {
      // a stored endpoint is never trusted: only real push services, never an internal URL
      if (!isAllowedPushEndpoint(subscription.endpoint)) return { ok: false, gone: true };
      try {
        await sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 60 * 60 * 24, urgency: "high", timeout: 5000 },
        );
        return { ok: true };
      } catch (e) {
        const status = typeof e === "object" && e !== null && "statusCode" in e ? Number((e as { statusCode: unknown }).statusCode) : 0;
        return { ok: false, gone: status === 404 || status === 410 };
      }
    },
  };
}
