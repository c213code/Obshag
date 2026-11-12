import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { createSupabaseRepo } from "./supabaseRepo";
import { HOUSEHOLD_ID, SEED_PASSWORD, createSeed } from "./seed";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME, AIDOS] = createSeed().profiles.map((p) => p.id);
const MIN = 60_000;

/** The seed: Айдос owes Ерасыл 1000, Даня owes Ерасыл 1500. */
function setup() {
  const storage = memoryStorage();
  let t = Date.parse("2026-11-07T12:00:00Z");
  const now = () => new Date(t);
  const as = async (email: string) => {
    const r = createMockRepo({ storage, session: memorySession(), now, serverSecret: SECRET });
    await r.signIn(email, SEED_PASSWORD);
    return r;
  };
  return { as, advance: (ms: number) => (t += ms) };
}
const mine = (r: Awaited<ReturnType<ReturnType<typeof setup>["as"]>>) => r.listPaidPrompts(HOUSEHOLD_ID);

describe("mockRepo «Ты перевёл?»", () => {
  it("opens one pending prompt per pair and refreshes it on re-open", async () => {
    const { as, advance } = setup();
    const aidos = await as("aidos@obshak.test");
    const p = await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    expect(p).toMatchObject({ from_user: AIDOS, to_user: ME, amount: 1000, status: "pending", asked_at: null });
    advance(5 * MIN);
    const again = await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    expect(again.id).toBe(p.id);
    expect(again.opened_at).not.toBe(p.opened_at);
    expect(await mine(aidos)).toHaveLength(1);
  });

  it("a creditor owes nothing: invalid; unknown person: forbidden", async () => {
    const { as } = setup();
    const me = await as("erasyl@obshak.test");
    await expect(me.openPaidPrompt(HOUSEHOLD_ID, AIDOS)).rejects.toMatchObject({ code: "invalid" });
    await expect(me.openPaidPrompt(HOUSEHOLD_ID, ME)).rejects.toMatchObject({ code: "invalid" });
    await expect(me.openPaidPrompt("nope", AIDOS)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("prompts are private to their debtor and expire after 30 minutes on read", async () => {
    const { as, advance } = setup();
    const aidos = await as("aidos@obshak.test");
    await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    expect(await mine(await as("danya@obshak.test"))).toHaveLength(0);
    advance(29 * MIN);
    expect(await mine(aidos)).toHaveLength(1);
    advance(2 * MIN);
    expect(await mine(aidos)).toHaveLength(0);
  });

  it("«Да» marks the settlement and it is final at once (slice 22); a second answer is already", async () => {
    const { as } = setup();
    const aidos = await as("aidos@obshak.test");
    const p = await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    await expect(aidos.answerPaidPrompt(p.id, true)).resolves.toEqual({ result: "marked", to_name: "Ерасыл" });
    const marked = await aidos.listSettlements(HOUSEHOLD_ID);
    expect(marked).toMatchObject([{ from_id: AIDOS, to_id: ME, amount: 1000, status: "confirmed" }]);
    await expect(aidos.answerPaidPrompt(p.id, true)).resolves.toMatchObject({ result: "already" });
  });

  it("«Ещё нет» closes the prompt without a settlement; somebody else's prompt is forbidden", async () => {
    const { as } = setup();
    const aidos = await as("aidos@obshak.test");
    const p = await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    await expect((await as("danya@obshak.test")).answerPaidPrompt(p.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(aidos.answerPaidPrompt(p.id, false)).resolves.toMatchObject({ result: "no" });
    expect((await aidos.listSettlements(HOUSEHOLD_ID)).filter((s) => s.status === "marked")).toHaveLength(0);
    expect(await mine(aidos)).toHaveLength(0);
  });

  it("the delayed notice needs the secret, waits 120 s, asks once and reports who to ask", async () => {
    const { as, advance } = setup();
    const aidos = await as("aidos@obshak.test");
    const p = await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    await expect(aidos.paidPromptNotice("wrong", p.id)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(aidos.paidPromptNotice(SECRET, p.id)).resolves.toEqual({ ask: false });
    advance(150_000);
    await expect(aidos.paidPromptNotice(SECRET, p.id)).resolves.toMatchObject({ ask: true, prompt_id: p.id, to_user: ME, to_name: "Ерасыл", amount: 1000 });
    await expect(aidos.paidPromptNotice(SECRET, p.id)).resolves.toEqual({ ask: false });
    await expect((await as("danya@obshak.test")).paidPromptNotice(SECRET, p.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("tgAnswerPaid: only the linked debtor, with the secret", async () => {
    const { as } = setup();
    const aidos = await as("aidos@obshak.test");
    const p = await aidos.openPaidPrompt(HOUSEHOLD_ID, ME);
    const code = await aidos.createTelegramLinkCode();
    await aidos.tgLinkAccount(SECRET, code, 4242);
    const danya = await as("danya@obshak.test");
    await danya.tgLinkAccount(SECRET, await danya.createTelegramLinkCode(), 4343);
    await expect(aidos.tgAnswerPaid("wrong", 4242, p.id, true)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(aidos.tgAnswerPaid(SECRET, 4343, p.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(aidos.tgAnswerPaid(SECRET, 9999, p.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(aidos.tgAnswerPaid(SECRET, 4242, p.id, true)).resolves.toEqual({ result: "marked", to_name: "Ерасыл" });
  });
});

describe("supabaseRepo «Ты перевёл?»", () => {
  it("sends the 0015 RPCs with their parameters and maps errors", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const client = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        if (fn === "open_paid_prompt") return { data: null, error: { code: "P0001", message: "too_small" } };
        if (fn === "my_paid_prompts") return { data: [{ id: "p1" }], error: null };
        return { data: { result: "no", to_name: "Айдос" }, error: null };
      },
    } as unknown as SupabaseClient;
    const repo = createSupabaseRepo(client);
    await expect(repo.openPaidPrompt("h", "u")).rejects.toMatchObject({ code: "too_small" });
    expect(await repo.listPaidPrompts("h")).toEqual([{ id: "p1" }]);
    await repo.answerPaidPrompt("p1", false);
    await repo.paidPromptNotice("s", "p1");
    await repo.tgAnswerPaid("s", 5, "p1", true);
    expect(calls).toEqual([
      { fn: "open_paid_prompt", args: { p_household: "h", p_to: "u" } },
      { fn: "my_paid_prompts", args: { p_household: "h" } },
      { fn: "answer_paid_prompt", args: { p_prompt: "p1", p_yes: false } },
      { fn: "paid_prompt_notice", args: { p_secret: "s", p_prompt: "p1" } },
      { fn: "tg_answer_paid", args: { p_secret: "s", p_tg_user_id: 5, p_prompt: "p1", p_yes: true } },
    ]);
  });
});
