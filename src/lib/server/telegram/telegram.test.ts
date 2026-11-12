import { describe, expect, it } from "vitest";
import { RepoError } from "@/lib/data/repo";
import type { TgResolveResult } from "@/lib/data/types";
import { createRecordingTelegram, createTelegramApi } from "./api";
import { parseCallbackData, parseStart } from "./parse";
import { handleWebhook, MAX_BODY_BYTES, text, type WebhookDeps } from "./webhookHandler";

const WEBHOOK = "webhook-secret-0123456789";
const SERVER = "cron-secret-0123456789abcdef";
const ID = "123e4567-e89b-42d3-a456-426614174000";
const CODE = "AbCdEfGhIjKlMnOpQrStUvWx";

const deps = (over: Partial<WebhookDeps["repo"]> = {}, api = createRecordingTelegram()) => {
  const seen: unknown[][] = [];
  const d: WebhookDeps = {
    repo: {
      tgLinkAccount: async (...a) => (seen.push(a), "Айдос"),
      tgResolvePending: async (...a) => (seen.push(a), "shared" as TgResolveResult),
      ...over,
    },
    api,
    serverSecret: SERVER,
    webhookSecret: WEBHOOK,
  };
  return { d, api, seen };
};
const start = (code: string) => JSON.stringify({ message: { text: `/start ${code}`, chat: { id: 77, type: "private" }, from: { id: 77 } } });
const tap = (data: string, msgText = "🛒 Small · 3 780 ₸ · 8 нояб, 14:32\nЧья покупка?") =>
  JSON.stringify({ callback_query: { id: "cb1", from: { id: 77 }, data, message: { message_id: 9, text: msgText, chat: { id: 77, type: "private" } } } });

describe("parsers", () => {
  it("parses /start with a code, with a bot suffix, and rejects junk codes", () => {
    expect(parseStart(`/start ${CODE}`)).toEqual({ code: CODE });
    expect(parseStart(`/start@obshagk_bot ${CODE}`)).toEqual({ code: CODE });
    expect(parseStart("/start")).toEqual({ code: null });
    expect(parseStart("/start short")).toEqual({ code: null });
    expect(parseStart(`/start ${CODE}; drop table`)).toBeNull();
    expect(parseStart("hello")).toBeNull();
    expect(parseStart(undefined)).toBeNull();
  });
  it("parses s:<uuid> and p:<uuid> only", () => {
    expect(parseCallbackData(`s:${ID}`)).toEqual({ shared: true, purchaseId: ID });
    expect(parseCallbackData(`p:${ID}`)).toEqual({ shared: false, purchaseId: ID });
    for (const bad of [`x:${ID}`, `s:${ID}0`, "s:not-a-uuid", `s:${ID.slice(0, -1)}g`, "", undefined]) expect(parseCallbackData(bad), String(bad)).toBeNull();
  });
});

describe("webhook secret", () => {
  it("answers 401 and does nothing for a missing, wrong or unconfigured secret", async () => {
    const { d, api, seen } = deps();
    for (const header of [null, "", "nope", `${WEBHOOK}x`, WEBHOOK.slice(0, -1)]) {
      expect((await handleWebhook(header, start(CODE), d)).status, String(header)).toBe(401);
    }
    expect((await handleWebhook(WEBHOOK, start(CODE), null)).status).toBe(401);
    expect(seen).toEqual([]);
    expect(api.calls).toEqual([]);
  });
});

describe("webhook /start", () => {
  it("links and greets by name", async () => {
    const { d, api, seen } = deps();
    expect(await handleWebhook(WEBHOOK, start(CODE), d)).toEqual({ status: 200, body: { ok: true } });
    expect(seen).toEqual([[SERVER, CODE, 77]]);
    expect(api.calls).toEqual([{ method: "sendMessage", args: [77, text.linked("Айдос")] }]);
    expect(text.linked("Айдос")).toBe("Готово, Айдос! Буду писать сюда про покупки на «Потом».");
  });
  it("a bad or expired code gets the retry text; a plain /start gets help and never reaches the database", async () => {
    const bad = deps({ tgLinkAccount: async () => null });
    await handleWebhook(WEBHOOK, start(CODE), bad.d);
    expect(bad.api.calls[0].args[1]).toBe(text.expired);
    const thrown = deps({ tgLinkAccount: async () => Promise.reject(new RepoError("unauthenticated", "x")) });
    expect((await handleWebhook(WEBHOOK, start(CODE), thrown.d)).status).toBe(200);
    expect(thrown.api.calls[0].args[1]).toBe(text.expired);
    const plain = deps();
    await handleWebhook(WEBHOOK, JSON.stringify({ message: { text: "/start", chat: { id: 5, type: "private" }, from: { id: 5 } } }), plain.d);
    expect(plain.seen).toEqual([]);
    expect(plain.api.calls[0].args[1]).toBe(text.help);
  });
  it("ignores group chats", async () => {
    const { d, api, seen } = deps();
    await handleWebhook(WEBHOOK, JSON.stringify({ message: { text: `/start ${CODE}`, chat: { id: -5, type: "supergroup" }, from: { id: 5 } } }), d);
    expect(seen).toEqual([]);
    expect(api.calls).toEqual([]);
  });
});

describe("webhook buttons", () => {
  it.each([
    ["s", "shared", "✓ Поделено на всех"],
    ["p", "personal", "✓ Моё"],
    ["s", "already_resolved", "Уже решено"],
  ] as const)("%s -> %s: answers the callback, then edits the message", async (kind, result, line) => {
    const seen: unknown[][] = [];
    const { d, api } = deps({ tgResolvePending: async (...a) => (seen.push(a), result) });
    expect((await handleWebhook(WEBHOOK, tap(`${kind}:${ID}`), d)).status).toBe(200);
    expect(seen).toEqual([[SERVER, 77, ID, kind === "s"]]);
    expect(api.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(api.calls[1].args).toEqual([77, 9, `🛒 Small · 3 780 ₸ · 8 нояб, 14:32\n${line}`]);
  });
  it("someone else's purchase: a refusal toast and no edit", async () => {
    const { d, api } = deps({ tgResolvePending: async () => Promise.reject(new RepoError("forbidden", "x")) });
    expect((await handleWebhook(WEBHOOK, tap(`s:${ID}`), d)).status).toBe(200);
    expect(api.calls).toEqual([{ method: "answerCallbackQuery", args: ["cb1", text.notYours] }]);
  });
  it("a database failure still answers 200 and tells the user", async () => {
    const { d, api } = deps({ tgResolvePending: async () => Promise.reject(new Error("db")) });
    expect((await handleWebhook(WEBHOOK, tap(`p:${ID}`), d)).status).toBe(200);
    expect(api.calls).toEqual([{ method: "answerCallbackQuery", args: ["cb1", text.failed] }]);
  });
  it("junk callback data never reaches the database", async () => {
    const { d, seen } = deps();
    await handleWebhook(WEBHOOK, tap("s:../../x"), d);
    expect(seen).toEqual([]);
  });
});

describe("webhook robustness", () => {
  it("answers 200 for malformed JSON, wrong shapes and oversized bodies", async () => {
    const { d, seen } = deps();
    for (const body of ["", "not json", "[]", "{}", JSON.stringify({ message: 5 }), "x".repeat(MAX_BODY_BYTES + 1)]) {
      expect((await handleWebhook(WEBHOOK, body, d)).status).toBe(200);
    }
    expect(seen).toEqual([]);
  });
  it("works without a bot token (nothing is sent back)", async () => {
    const { d, seen } = deps();
    expect((await handleWebhook(WEBHOOK, start(CODE), { ...d, api: null })).status).toBe(200);
    expect(seen).toHaveLength(1);
  });
});

describe("telegram api wrapper", () => {
  it("posts JSON to the bot endpoint with a timeout signal, and returns false on failure without throwing", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = createTelegramApi("T0KEN", (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch);
    expect(await ok.sendMessage(1, "hi", [[{ text: "a", callback_data: "s:x" }]])).toBe(true);
    expect(seen!.url).toBe("https://api.telegram.org/botT0KEN/sendMessage");
    expect(seen!.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({ chat_id: 1, text: "hi", reply_markup: { inline_keyboard: [[{ text: "a" }]] } });
    expect(await ok.setWebhook("https://x.test/api/telegram/webhook", "s")).toBe(true);
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({ allowed_updates: ["message", "callback_query"], secret_token: "s" });
    const down = createTelegramApi("T0KEN", (async () => Promise.reject(new Error("net"))) as unknown as typeof fetch);
    expect(await down.answerCallbackQuery("c")).toBe(false);
    const bad = createTelegramApi("T0KEN", (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch);
    expect(await bad.editMessageText(1, 2, "x")).toBe(false);
  });
});

describe("webhook swap buttons", () => {
  const SW = "123e4567-e89b-42d3-a456-426614174000";
  const swapText = "⇄ Ерасыл просит поменяться днями: пн 17 ⇄ вт 18\nОтветь до 10:00 ближайшего из этих дней.";
  const notice = { request_id: SW, target_user: "u1", subscriptions: [{ endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a" }], telegram_user_id: 5, from_name: "Ерасыл", to_name: "Айдос", from_day: "2026-11-17", to_day: "2026-11-18", from_label: "пн 17", to_label: "вт 18", reason: null };
  it("Согласен answers the callback and rewrites the DM", async () => {
    const { d, api } = deps({ tgRespondSwap: async () => ({ result: "accepted" as const, notice: null }) });
    expect((await handleWebhook(WEBHOOK, tap(`sw:a:${SW}`, swapText), d)).status).toBe(200);
    expect(api.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(api.calls[1].args[2]).toBe(`⇄ Ерасыл просит поменяться днями: пн 17 ⇄ вт 18\n${text.swapAccepted}`);
  });
  it("Не могу pushes the requester", async () => {
    const sent: unknown[] = [];
    const { d } = deps({ tgRespondSwap: async () => ({ result: "declined" as const, notice }) });
    d.push = { send: async (sub, payload) => (sent.push([sub.endpoint, payload]), { ok: true as const }) };
    await handleWebhook(WEBHOOK, tap(`sw:d:${SW}`, swapText), d);
    expect(sent).toEqual([["https://fcm.googleapis.com/a", { type: "swap-declined", requestId: SW, name: "Айдос", fromLabel: "пн 17", toLabel: "вт 18" }]]);
  });
  it("stale and expired get their own line; a stranger is told it is not theirs; a missing repo method is ignored", async () => {
    for (const [result, line] of [["stale", text.swapStale], ["expired", text.swapExpired]] as const) {
      const { d, api } = deps({ tgRespondSwap: async () => ({ result, notice: null }) });
      await handleWebhook(WEBHOOK, tap(`sw:a:${SW}`, swapText), d);
      expect(api.calls[1].args[2]).toContain(line);
    }
    const stranger = deps({ tgRespondSwap: async () => Promise.reject(new RepoError("forbidden", "x")) });
    await handleWebhook(WEBHOOK, tap(`sw:a:${SW}`, swapText), stranger.d);
    expect(stranger.api.calls).toEqual([{ method: "answerCallbackQuery", args: ["cb1", text.swapNotYours] }]);
    const none = deps();
    await handleWebhook(WEBHOOK, tap(`sw:a:${SW}`, swapText), none.d);
    expect(none.api.calls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });
});

describe("webhook pp: buttons (slice 17)", () => {
  const answers = (result: string, name = "Ерасыл") => {
    const seen: unknown[][] = [];
    return { seen, repo: { tgAnswerPaid: async (...a: unknown[]) => (seen.push(a), { result, to_name: name }) } as Partial<WebhookDeps["repo"]> };
  };
  const question = "Ты перевёл @erasyl 200 ₸ через Kaspi?";

  it("«Да» calls tg_answer_paid with the tapper and the prompt, answers the callback and edits the text", async () => {
    const a = answers("marked");
    const { d, api } = deps(a.repo);
    expect((await handleWebhook(WEBHOOK, tap(`pp:y:${ID}`, question), d)).status).toBe(200);
    expect(a.seen).toEqual([[SERVER, 77, ID, true]]);
    expect(api.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(api.calls[1].args).toEqual([77, 9, `${question}\nГотово ✓ — долг перед Ерасылом закрыт`]);
  });
  it("«Ещё нет» passes yes = false and says «Ок, напомню позже»", async () => {
    const a = answers("no");
    const { d, api } = deps(a.repo);
    await handleWebhook(WEBHOOK, tap(`pp:n:${ID}`, question), d);
    expect(a.seen).toEqual([[SERVER, 77, ID, false]]);
    expect(api.calls[1].args[2]).toBe(`${question}\nОк, напомню позже`);
  });
  it("expired, too small and stale get their own line", async () => {
    for (const [result, line] of [["expired", text.paidExpired], ["too_small", text.paidTooSmall], ["stale", text.paidStale], ["already", text.paidAlready]] as const) {
      const { d, api } = deps(answers(result).repo);
      await handleWebhook(WEBHOOK, tap(`pp:y:${ID}`, question), d);
      expect(api.calls[1].args[2], result).toBe(`${question}\n${line}`);
    }
  });
  it("somebody else's tap only answers the callback (no edit, nothing marked)", async () => {
    const { d, api } = deps({ tgAnswerPaid: async () => { throw new RepoError("forbidden", "no"); } });
    await handleWebhook(WEBHOOK, tap(`pp:y:${ID}`, question), d);
    expect(api.calls).toEqual([{ method: "answerCallbackQuery", args: ["cb1", text.paidNotYours] }]);
  });
  it("a malformed pp: id never reaches the database", async () => {
    const a = answers("marked");
    const { d, api } = deps(a.repo);
    await handleWebhook(WEBHOOK, tap("pp:y:not-a-uuid", question), d);
    expect(a.seen).toEqual([]);
    expect(api.calls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });
});
