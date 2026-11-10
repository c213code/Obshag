import { RepoError, type Repo } from "@/lib/data/repo";
import type { TgResolveResult } from "@/lib/data/types";
import { secretsMatch } from "../cronAuth";
import type { TelegramApi } from "./api";
import type { PushSender } from "../push";
import { sendSwapNotice } from "../dutyHandler";
import { parseCallbackData, parseStart, parseSwapCallback, updateSchema } from "./parse";

export const MAX_BODY_BYTES = 64 * 1024;
export const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export type WebhookDeps = {
  repo: Pick<Repo, "tgLinkAccount" | "tgResolvePending"> & Partial<Pick<Repo, "tgRespondSwap">>;
  /** Web Push, used to tell the requester that a swap was declined from Telegram. */
  push?: PushSender | null;
  /** null = the bot token is not configured: updates are processed, nothing is sent back. */
  api: TelegramApi | null;
  /** CRON_SECRET: passed to the secret-gated RPCs. */
  serverSecret: string;
  /** TELEGRAM_WEBHOOK_SECRET: what Telegram must send in X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string;
};

export const text = {
  linked: (name: string) => `Готово, ${name}! Буду писать сюда про покупки на «Потом».`,
  expired: "Ссылка устарела — открой Общак → Профиль → Подключить Telegram ещё раз",
  help: "Я бот Общака. Чтобы я писал тебе про покупки на «Потом», открой Общак → Профиль → Подключить Telegram.",
  shared: "✓ Поделено на всех",
  personal: "✓ Моё",
  already: "Уже решено",
  tooSmall: "Сумма слишком маленькая, чтобы делить. Открой Общак",
  notYours: "Это не твоя покупка",
  failed: "Не получилось. Открой Общак",
  swapAccepted: "✓ Поменялись",
  swapDeclined: "✗ Не могу",
  swapExpired: "Время вышло — запрос сгорел",
  swapStale: "Расписание уже изменилось. Открой Общак",
  swapNotYours: "Этот запрос не тебе",
} as const;

/** The secret check alone (the route runs it before reading the body). */
export const webhookAuthorized = (secretHeader: string | null, deps: WebhookDeps | null): deps is WebhookDeps =>
  deps !== null && secretsMatch(secretHeader, deps.webhookSecret);

export type WebhookOutcome = { status: 200 | 401; body: { ok: boolean } };

const verdict = (r: TgResolveResult): string => (r === "shared" ? text.shared : r === "personal" ? text.personal : r === "already_resolved" ? text.already : text.tooSmall);

/**
 * POST /api/telegram/webhook. A wrong secret = 401 and nothing happens. After that Telegram always gets 200, even when
 * the update was malformed or a step failed (a non-200 only makes Telegram retry the same update). Nothing is logged.
 */
export async function handleWebhook(secretHeader: string | null, rawBody: string, deps: WebhookDeps | null): Promise<WebhookOutcome> {
  if (!webhookAuthorized(secretHeader, deps)) return { status: 401, body: { ok: false } };
  const done: WebhookOutcome = { status: 200, body: { ok: true } };
  if (rawBody.length > MAX_BODY_BYTES) return done;
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return done;
  }
  const update = updateSchema.safeParse(json);
  if (!update.success) return done;
  try {
    const { message, callback_query: cb } = update.data;
    if (message && message.chat.type === "private" && message.from) await onMessage(message.chat.id, message.from.id, message.text, deps);
    else if (cb) await onCallback(cb, deps);
  } catch {
    // handled errors still answer 200
  }
  return done;
}

async function onMessage(chatId: number, tgUserId: number, body: string | undefined, deps: WebhookDeps): Promise<void> {
  const start = parseStart(body);
  if (!start) return;
  if (!start.code) {
    await deps.api?.sendMessage(chatId, text.help);
    return;
  }
  let name: string | null = null;
  try {
    name = await deps.repo.tgLinkAccount(deps.serverSecret, start.code, tgUserId);
  } catch {
    name = null;
  }
  await deps.api?.sendMessage(chatId, name ? text.linked(name) : text.expired);
}

async function onCallback(cb: NonNullable<ReturnType<typeof updateSchema.parse>["callback_query"]>, deps: WebhookDeps): Promise<void> {
  const swap = parseSwapCallback(cb.data);
  if (swap) {
    await onSwapCallback(cb, swap, deps);
    return;
  }
  const action = parseCallbackData(cb.data);
  if (!action) {
    await deps.api?.answerCallbackQuery(cb.id);
    return;
  }
  let result: TgResolveResult;
  try {
    result = await deps.repo.tgResolvePending(deps.serverSecret, cb.from.id, action.purchaseId, action.shared);
  } catch (e) {
    const notYours = e instanceof RepoError && e.code === "forbidden";
    await deps.api?.answerCallbackQuery(cb.id, notYours ? text.notYours : text.failed);
    return;
  }
  // answer first (stops the spinner), then rewrite the message and drop its buttons
  await deps.api?.answerCallbackQuery(cb.id);
  const msg = cb.message;
  if (msg) {
    const head = msg.text?.split("\n")[0];
    const line = verdict(result);
    await deps.api?.editMessageText(msg.chat.id, msg.message_id, head ? `${head}\n${line}` : line);
  }
}

async function onSwapCallback(
  cb: NonNullable<ReturnType<typeof updateSchema.parse>["callback_query"]>,
  swap: NonNullable<ReturnType<typeof parseSwapCallback>>,
  deps: WebhookDeps,
): Promise<void> {
  if (!deps.repo.tgRespondSwap) {
    await deps.api?.answerCallbackQuery(cb.id);
    return;
  }
  let out: Awaited<ReturnType<NonNullable<WebhookDeps["repo"]["tgRespondSwap"]>>>;
  try {
    out = await deps.repo.tgRespondSwap(deps.serverSecret, cb.from.id, swap.requestId, swap.accept);
  } catch (e) {
    const notYours = e instanceof RepoError && e.code === "forbidden";
    await deps.api?.answerCallbackQuery(cb.id, notYours ? text.swapNotYours : text.failed);
    return;
  }
  await deps.api?.answerCallbackQuery(cb.id);
  const msg = cb.message;
  if (msg) {
    const head = msg.text?.split("\n")[0];
    const line = out.result === "accepted" ? text.swapAccepted : out.result === "declined" ? text.swapDeclined : out.result === "expired" ? text.swapExpired : text.swapStale;
    await deps.api?.editMessageText(msg.chat.id, msg.message_id, head ? `${head}\n${line}` : line);
  }
  if (out.result === "declined" && out.notice) {
    await sendSwapNotice(out.notice, "declined", deps.push ?? null, null);
  }
}
