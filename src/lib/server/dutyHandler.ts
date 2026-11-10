import { RepoError, type Repo } from "@/lib/data/repo";
import type { DutyMorningItem, DutyNotice } from "@/lib/data/types";
import { dutyEventNotifyBodySchema, dutyNotifyBodySchema } from "@/lib/domain/schemas";
import { bearerMatches } from "./cronAuth";
import type { DutyPushPayload, PushSender } from "./push";
import type { InlineKeyboard, TelegramApi } from "./telegram/api";

export type DutyDeps = {
  repo: Pick<Repo, "runDutyMorning" | "swapNotice" | "dutyEventNotice">;
  /** null = push is not configured. */
  push: PushSender | null;
  /** null / missing = the bot is not configured (or mock mode): nothing goes to Telegram. */
  telegram?: TelegramApi | null;
  secret: string;
};

export type DutyOutcome<B> = {
  status: 200 | 400 | 401 | 403 | 409 | 500;
  body: B;
  /** Runs after the response (Next `after`). Never throws. */
  afterResponse?: () => Promise<void>;
};

/** «🍳 Сегодня готовит @x · завтра @y» (other duties: «🗓 Мусор: сегодня @x · завтра @y»). */
export function morningGroupText(i: DutyMorningItem): string {
  const next = i.tomorrow_name ? ` · завтра ${i.tomorrow_name}` : "";
  return i.kind === "cooking" ? `🍳 Сегодня готовит ${i.today_name}${next}` : `🗓 ${i.title}: сегодня ${i.today_name}${next}`;
}

export const swapDmText = (n: DutyNotice): string =>
  `⇄ ${n.from_name} просит поменяться днями: ${n.from_label} ⇄ ${n.to_label}${n.reason ? `\n«${n.reason}»` : ""}\nОтветь до 10:00 ближайшего из этих дней.`;

export const swapDmKeyboard = (requestId: string): InlineKeyboard => [
  [
    { text: "Согласен", callback_data: `sw:a:${requestId}` },
    { text: "Не могу", callback_data: `sw:d:${requestId}` },
  ],
];

async function pushAll(subs: DutyNotice["subscriptions"], push: PushSender | null, payload: DutyPushPayload): Promise<void> {
  if (!push) return;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await push.send(sub, payload);
      } catch {
        // one failing device never stops the others
      }
    }),
  );
}

/** The push for a swap event: «Ерасыл просит поменяться: пн 17 ⇄ вт 18» / «Айдос не может поменяться». */
export const swapPayload = (n: DutyNotice, event: "requested" | "declined"): DutyPushPayload =>
  event === "requested"
    ? { type: "swap-request", requestId: n.request_id, name: n.from_name, fromLabel: n.from_label, toLabel: n.to_label }
    : { type: "swap-declined", requestId: n.request_id, name: n.to_name, fromLabel: n.from_label, toLabel: n.to_label };

/** Push to the target's devices, plus a DM with the two buttons when the request goes to a linked Telegram user. */
export async function sendSwapNotice(n: DutyNotice, event: "requested" | "declined", push: PushSender | null, telegram: TelegramApi | null): Promise<void> {
  await pushAll(n.subscriptions, push, swapPayload(n, event));
  if (event === "requested" && telegram && n.telegram_user_id !== null) {
    try {
      await telegram.sendMessage(n.telegram_user_id, swapDmText(n), swapDmKeyboard(n.request_id));
    } catch {
      // ignored on purpose
    }
  }
}

/** GET /api/cron/morning (09:00 Almaty). 401 unless the bearer matches. */
export async function handleMorning(authorization: string | null, deps: DutyDeps | null): Promise<DutyOutcome<{ ok: boolean; duties?: number }>> {
  if (!deps || !bearerMatches(authorization, deps.secret)) return { status: 401, body: { ok: false } };
  let items: DutyMorningItem[];
  try {
    items = await deps.repo.runDutyMorning(deps.secret);
  } catch {
    return { status: 500, body: { ok: false } };
  }
  return {
    status: 200,
    body: { ok: true, duties: items.length },
    afterResponse: async () => {
      await Promise.all(
        items.map(async (i) => {
          await pushAll(i.subscriptions, deps.push, { type: "duty-today", kind: i.kind, title: i.title });
          if (deps.telegram && i.telegram_chat_id !== null) {
            try {
              await deps.telegram.sendMessage(i.telegram_chat_id, morningGroupText(i));
            } catch {
              // ignored on purpose
            }
          }
        }),
      );
    },
  };
}

/** POST /api/duty/notify {request_id, event}: the session user asks for the push / DM after a request or a decline. */
export async function handleDutyNotify(raw: unknown, deps: DutyDeps | null): Promise<DutyOutcome<{ ok: boolean }>> {
  if (!deps) return { status: 500, body: { ok: false } };
  const body = dutyNotifyBodySchema.safeParse(raw);
  if (!body.success) return { status: 400, body: { ok: false } };
  try {
    const notice = await deps.repo.swapNotice(deps.secret, body.data.request_id, body.data.event);
    return {
      status: 200,
      body: { ok: true },
      afterResponse: () => sendSwapNotice(notice, body.data.event, deps.push, deps.telegram ?? null),
    };
  } catch (e) {
    if (e instanceof RepoError) {
      if (e.code === "unauthenticated") return { status: 401, body: { ok: false } };
      if (e.code === "forbidden" || e.code === "not_found") return { status: 403, body: { ok: false } };
      if (e.code === "invalid") return { status: 409, body: { ok: false } };
    }
    return { status: 500, body: { ok: false } };
  }
}

/** POST /api/duty/event-notify {event_id}: push the current person after «Пакет полный» / «Вода кончилась» (the group line is sent by SQL). */
export async function handleDutyEventNotify(raw: unknown, deps: DutyDeps | null): Promise<DutyOutcome<{ ok: boolean }>> {
  if (!deps) return { status: 500, body: { ok: false } };
  const body = dutyEventNotifyBodySchema.safeParse(raw);
  if (!body.success) return { status: 400, body: { ok: false } };
  try {
    const notice = await deps.repo.dutyEventNotice(deps.secret, body.data.event_id);
    return {
      status: 200,
      body: { ok: true },
      afterResponse: async () => {
        if (notice.self) return;
        await pushAll(notice.subscriptions, deps.push, { type: "duty-event", kind: notice.kind, name: notice.actor_name, title: notice.title });
      },
    };
  } catch (e) {
    if (e instanceof RepoError) {
      if (e.code === "unauthenticated") return { status: 401, body: { ok: false } };
      if (e.code === "forbidden" || e.code === "not_found") return { status: 403, body: { ok: false } };
    }
    return { status: 500, body: { ok: false } };
  }
}
