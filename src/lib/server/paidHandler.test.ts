import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RepoError } from "@/lib/data/repo";
import type { PaidPrompt, PaidPromptNotice } from "@/lib/data/types";
import { paidOpenedBodySchema } from "@/lib/domain/schemas";
import { ASK_DELAY_MS, ROUTE_MAX_DURATION_S, askLater, handlePaidOpened, paidDmKeyboard, paidDmText, type PaidDeps } from "./paidHandler";
import { createRecordingSender } from "./push";
import { createRecordingTelegram } from "./telegram/api";
import { parsePaidCallback } from "./telegram/parse";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const sub = { endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a" };
const prompt: PaidPrompt = { id: ID, household_id: "h1", from_user: "u1", to_user: "u2", amount: 200, opened_at: "2026-11-07T12:00:00Z", status: "pending", asked_at: null };
const ask = (over: Partial<Extract<PaidPromptNotice, { ask: true }>> = {}): PaidPromptNotice => ({
  ask: true, prompt_id: ID, household_id: "h1", to_user: "u2", to_name: "Айдос", to_username: "aidos_k", amount: 200, telegram_user_id: 777, subscriptions: [sub], ...over,
});
const make = (notice: PaidPromptNotice, over: Partial<PaidDeps["repo"]> = {}) => {
  const push = createRecordingSender();
  const telegram = createRecordingTelegram();
  const waits: number[] = [];
  const deps: PaidDeps = {
    repo: { openPaidPrompt: async () => prompt, paidPromptNotice: async () => notice, ...over },
    push,
    telegram,
    secret: "s",
    wait: async (ms) => void waits.push(ms),
  };
  return { deps, push, telegram, waits };
};

describe("body schema", () => {
  it("takes exactly {household_id, to_user}", () => {
    expect(paidOpenedBodySchema.safeParse({ household_id: "h", to_user: "u" }).success).toBe(true);
    for (const bad of [{}, { household_id: "h" }, { household_id: "", to_user: "u" }, { household_id: "h", to_user: "u", amount: 5 }, { household_id: "h", to_user: "x".repeat(65) }, null, "x"]) {
      expect(paidOpenedBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("the wait fits inside the route's maxDuration", () => {
    expect(ASK_DELAY_MS).toBeGreaterThanOrEqual(120_000);
    expect(ASK_DELAY_MS / 1000).toBeLessThan(ROUTE_MAX_DURATION_S);
    expect(ROUTE_MAX_DURATION_S).toBeLessThanOrEqual(180);
    // Next needs a literal in the route file; it must say the same number
    const route = readFileSync(join(process.cwd(), "src/app/api/settle/opened/route.ts"), "utf8");
    expect(route).toMatch(new RegExp(`export const maxDuration = ${ROUTE_MAX_DURATION_S};`));
  });
});

describe("pp: callback parsing", () => {
  it("parses pp:y:<uuid> and pp:n:<uuid> only", () => {
    expect(parsePaidCallback(`pp:y:${ID}`)).toEqual({ yes: true, promptId: ID });
    expect(parsePaidCallback(`pp:n:${ID}`)).toEqual({ yes: false, promptId: ID });
    for (const bad of [`pp:x:${ID}`, `pp:y:${ID}0`, "pp:y:nope", `p:${ID}`, `sw:a:${ID}`, `pp:y:${ID.slice(0, -1)}g`, "", undefined]) expect(parsePaidCallback(bad), String(bad)).toBeNull();
  });
  it("the keyboard speaks the same format", () => {
    const [[yes, no]] = paidDmKeyboard(ID);
    expect(parsePaidCallback(yes.callback_data)).toEqual({ yes: true, promptId: ID });
    expect(parsePaidCallback(no.callback_data)).toEqual({ yes: false, promptId: ID });
    expect(yes.callback_data.length).toBeLessThanOrEqual(64);
  });
});

describe("handlePaidOpened", () => {
  it("opens the prompt and answers 200 with only {ok}", async () => {
    const { deps } = make(ask());
    const out = await handlePaidOpened({ household_id: "h1", to_user: "u2" }, deps);
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
    expect(out.afterResponse).toBeTypeOf("function");
  });
  it("400 on a bad body, 500 without deps, nothing opened", async () => {
    let opened = 0;
    const { deps } = make(ask(), { openPaidPrompt: async () => (opened++, prompt) });
    expect((await handlePaidOpened({ household_id: "h1" }, deps)).status).toBe(400);
    expect((await handlePaidOpened({ household_id: "h1", to_user: "u2" }, null)).status).toBe(500);
    expect(opened).toBe(0);
  });
  it("maps repo errors: 401 / 403 / 409 (too small, nothing owed) / 500, without an after job", async () => {
    const body = { household_id: "h1", to_user: "u2" };
    for (const [code, status] of [["unauthenticated", 401], ["forbidden", 403], ["not_found", 403], ["too_small", 409], ["invalid", 409], ["unknown", 500]] as const) {
      const { deps } = make(ask(), { openPaidPrompt: async () => { throw new RepoError(code, code); } });
      const out = await handlePaidOpened(body, deps);
      expect(out.status, code).toBe(status);
      expect(out.afterResponse).toBeUndefined();
    }
    const { deps } = make(ask(), { openPaidPrompt: async () => { throw new Error("boom"); } });
    expect((await handlePaidOpened(body, deps)).status).toBe(500);
  });
});

describe("the delayed question", () => {
  it("waits, then DMs a linked user with the two buttons and does not push", async () => {
    const { deps, push, telegram, waits } = make(ask());
    await askLater(ID, deps);
    expect(waits).toEqual([ASK_DELAY_MS]);
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0].args[0]).toBe(777);
    expect(telegram.calls[0].args[1]).toBe("Ты перевёл @aidos_k 200 ₸ через Kaspi?");
    expect(telegram.calls[0].args[2]).toEqual(paidDmKeyboard(ID));
    expect(push.calls).toEqual([]);
  });
  it("uses the name when there is no @username", () => {
    expect(paidDmText(ask({ to_username: null }) as Extract<PaidPromptNotice, { ask: true }>)).toBe("Ты перевёл Айдос 200 ₸ через Kaspi?");
  });
  it("pushes «Перевёл Айдосу 200 ₸?» to every device when Telegram is not linked", async () => {
    const { deps, push, telegram } = make(ask({ telegram_user_id: null, subscriptions: [sub, { ...sub, endpoint: "https://fcm.googleapis.com/b" }] }));
    await askLater(ID, deps);
    expect(telegram.calls).toEqual([]);
    expect(push.calls.map((c) => c.payload)).toEqual([
      { type: "paid-ask", toUserId: "u2", name: "Айдосу", amount: 200 },
      { type: "paid-ask", toUserId: "u2", name: "Айдосу", amount: 200 },
    ]);
  });
  it("falls back to push when the DM could not be sent", async () => {
    const { deps, push } = make(ask());
    deps.telegram = createRecordingTelegram(["sendMessage"]);
    await askLater(ID, deps);
    expect(push.calls).toHaveLength(1);
  });
  it("sends nothing when the database says ask = false, and never throws", async () => {
    const quiet = make({ ask: false });
    await askLater(ID, quiet.deps);
    expect(quiet.telegram.calls).toEqual([]);
    expect(quiet.push.calls).toEqual([]);
    const broken = make(ask(), { paidPromptNotice: async () => { throw new RepoError("unauthenticated", "x"); } });
    await expect(askLater(ID, broken.deps)).resolves.toBeUndefined();
    expect(broken.telegram.calls).toEqual([]);
  });
});
