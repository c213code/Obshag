import type { PushSubscriptionInput } from "@/lib/data/types";

/** «Ты должен Айдосу 200 ₸ · Рассчитаться»: `fromName` is already in the dative case, the worker composes the text. */
export type ReminderPushPayload = { type: "reminder"; fromUserId: string; fromName: string; amount: number };

/** «Коммуналка: введи сумму за ноябрь»: the worker composes the text; tapping opens /monthly. */
export type BillPushPayload = { type: "bill"; billId: string; title: string; month: string };

/** «Ждут решения: 2 покупки» at 19:00: one push per user; the worker composes the text; tapping opens `/`. */
export type DigestPushPayload = { type: "digest"; count: number };

/** «Сегодня готовишь ты 🍳» at 09:00; tapping opens /duty. */
export type DutyTodayPushPayload = { type: "duty-today"; kind: string; title: string };

/** A swap request for the counterparty / a decline for the requester; tapping opens /duty/request/<id>. */
export type SwapPushPayload = {
  type: "swap-request" | "swap-declined";
  requestId: string;
  name: string;
  fromLabel: string;
  toLabel: string;
};

/** «Пакет полный» (kind ping) / «Вода кончилась» (kind empty) for whoever is current; tapping opens /duty?kind=trash|water. */
export type DutyEventPushPayload = { type: "duty-event"; kind: "ping" | "empty"; name: string; title: string };

export type DutyPushPayload = DutyTodayPushPayload | SwapPushPayload | DutyEventPushPayload;

/** «Перевёл Айдосу 200 ₸?» ~2.5 min after Kaspi was opened (no Telegram linked); tapping opens /settle/<toUserId>?ask=1. `name` is in the dative. */
export type PaidAskPushPayload = { type: "paid-ask"; toUserId: string; name: string; amount: number };

export type PushPayload = PaidAskPushPayload | PendingPushPayload | ReminderPushPayload | BillPushPayload | DigestPushPayload | DutyPushPayload;

/** What the service worker receives. Title and body are composed there (it formats the amount itself). */
export type PendingPushPayload = { type: "pending"; purchaseId: string; merchant: string | null; amount: number };

export type PushResult = { ok: true } | { ok: false; /** 404 / 410: the subscription is dead and must be pruned. */ gone: boolean };

/** Where pushes go. Real = web-push with VAPID; tests and E2E use a recorder, so nothing is ever sent. */
export interface PushSender {
  send(subscription: PushSubscriptionInput, payload: PushPayload): Promise<PushResult>;
}

/** A sender that only records calls (tests, E2E). `gone` endpoints answer as dead subscriptions. */
export function createRecordingSender(
  opts: { gone?: ReadonlyArray<string>; failing?: ReadonlyArray<string> } = {},
): PushSender & { calls: Array<{ endpoint: string; payload: PushPayload }> } {
  const calls: Array<{ endpoint: string; payload: PushPayload }> = [];
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
