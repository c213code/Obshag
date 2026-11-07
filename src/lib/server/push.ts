import type { PushSubscriptionInput } from "@/lib/data/types";

/** What the service worker receives. Title and body are composed there (it formats the amount itself). */
export type PendingPushPayload = { type: "pending"; purchaseId: string; merchant: string | null; amount: number };

export type PushResult = { ok: true } | { ok: false; /** 404 / 410: the subscription is dead and must be pruned. */ gone: boolean };

/** Where pushes go. Real = web-push with VAPID; tests and E2E use a recorder, so nothing is ever sent. */
export interface PushSender {
  send(subscription: PushSubscriptionInput, payload: PendingPushPayload): Promise<PushResult>;
}

/** A sender that only records calls (tests, E2E). `gone` endpoints answer as dead subscriptions. */
export function createRecordingSender(
  opts: { gone?: ReadonlyArray<string>; failing?: ReadonlyArray<string> } = {},
): PushSender & { calls: Array<{ endpoint: string; payload: PendingPushPayload }> } {
  const calls: Array<{ endpoint: string; payload: PendingPushPayload }> = [];
  return {
    calls,
    async send(subscription, payload) {
      calls.push({ endpoint: subscription.endpoint, payload });
      if (opts.gone?.includes(subscription.endpoint)) return { ok: false, gone: true };
      if (opts.failing?.includes(subscription.endpoint)) return { ok: false, gone: false };
      return { ok: true };
    },
  };
}
