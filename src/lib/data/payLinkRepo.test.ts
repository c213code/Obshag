import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { HOUSEHOLD_ID, SEED_PASSWORD, createSeed } from "./seed";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME, AIDOS] = createSeed().profiles.map((p) => p.id);
const DAY = 24 * 60 * 60_000;

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
  /** The no-session server repo of the pay link routes. */
  const server = () => createMockRepo({ storage, session: memorySession(), now, serverSecret: SECRET });
  return { as, server, advance: (ms: number) => (t += ms), storage };
}
const linkOf = async (storage: ReturnType<typeof setup>["storage"]) => (await storage.load())!.db.payLinks ?? [];

describe("mockRepo pay links (slice 19)", () => {
  it("remind creates a link for debtor -> creditor", async () => {
    const { as, storage } = setup();
    await (await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS);
    const links = await linkOf(storage);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ household_id: HOUSEHOLD_ID, from_user: AIDOS, to_user: ME, opened_at: null });
    expect(links[0].code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("payLinkOpen: a plain view looks only; open records exactly one pending prompt", async () => {
    const { as, server, storage } = setup();
    await (await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS);
    const [{ code }] = await linkOf(storage);
    const view = await server().payLinkOpen(SECRET, code, false);
    expect(view).toMatchObject({ state: "pay", amount: 1000, to_name: "Ерасыл", from_name: "Айдос", prompt_id: null });
    expect((await storage.load())!.db.paidPrompts ?? []).toHaveLength(0);
    const first = await server().payLinkOpen(SECRET, code, true);
    const second = await server().payLinkOpen(SECRET, code, true);
    expect(first).toMatchObject({ state: "pay" });
    expect(second).toMatchObject({ prompt_id: (first as { prompt_id: string }).prompt_id });
    expect((await storage.load())!.db.paidPrompts).toHaveLength(1);
  });

  it("a wrong secret is unauthenticated, an unknown or old code is expired", async () => {
    const { as, server, advance, storage } = setup();
    await (await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS);
    const [{ code }] = await linkOf(storage);
    await expect(server().payLinkOpen("nope", code, false)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await server().payLinkOpen(SECRET, "unknown-code-1", false)).toEqual({ state: "expired" });
    advance(8 * DAY);
    expect(await server().payLinkOpen(SECRET, code, true)).toEqual({ state: "expired" });
  });

  it("answering yes marks the settlement; a prompt of another pair is forbidden", async () => {
    const { as, server, storage } = setup();
    await (await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS);
    const [{ code }] = await linkOf(storage);
    const open = await server().payLinkOpen(SECRET, code, true);
    const prompt = (open as { prompt_id: string }).prompt_id;
    const danya = await as("danya@obshak.test");
    const other = await danya.openPaidPrompt(HOUSEHOLD_ID, ME);
    await expect(server().payLinkAnswer(SECRET, code, other.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(server().payLinkAnswer(SECRET, code, prompt, true)).resolves.toEqual({ result: "marked", to_name: "Ерасыл" });
    const marked = (await (await as("aidos@obshak.test")).listSettlements(HOUSEHOLD_ID)).filter((s) => s.status === "marked");
    expect(marked).toMatchObject([{ from_id: AIDOS, to_id: ME, amount: 1000 }]);
    await expect(server().payLinkAnswer(SECRET, code, prompt, true)).resolves.toMatchObject({ result: "already" });
    // the transfer is marked: the link now reads «paid»
    expect(await server().payLinkOpen(SECRET, code, false)).toMatchObject({ state: "paid", amount: 0 });
  });

  it("the delayed notice works without a session (the pay link has none)", async () => {
    const { as, server, advance, storage } = setup();
    await (await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS);
    const [{ code }] = await linkOf(storage);
    const open = (await server().payLinkOpen(SECRET, code, true)) as { prompt_id: string };
    advance(150_000);
    await expect(server().paidPromptNotice(SECRET, open.prompt_id)).resolves.toMatchObject({ ask: true, to_name: "Ерасыл", amount: 1000 });
  });
});

describe("mockRepo: a marked transfer counts as paid (slice 19)", () => {
  it("the other side's debt is netted without the marked share: the live 450 / 150 case", async () => {
    const { as } = setup();
    const aidos = await as("aidos@obshak.test");
    const me = await as("erasyl@obshak.test");
    // Айдос owes Ерасыл 1000 and marks it; later Ерасыл owes Айдос 450
    await aidos.markSettlement(HOUSEHOLD_ID, ME);
    await aidos.createPurchase({ household_id: HOUSEHOLD_ID, amount: 900, description: "Ролтон", participant_ids: [ME, AIDOS] });
    // Ерасыл owes Айдос 450; the marked 1000 is out of the net, so nothing is netted against it
    const { netPair, withoutInFlight } = await import("@/lib/domain/netting");
    const ps = await me.listPurchases(HOUSEHOLD_ID);
    const settlements = await me.listSettlements(HOUSEHOLD_ID);
    const shares = ps.flatMap((p) => p.shares);
    expect(netPair(ME, AIDOS, shares, ps).net).toBe(550);
    expect(netPair(ME, AIDOS, withoutInFlight(shares, settlements), ps)).toMatchObject({ net: 450, direction: "i_pay" });
  });

  it("the creditor cannot be reminded about a debt that is already in flight", async () => {
    const { as } = setup();
    await (await as("aidos@obshak.test")).markSettlement(HOUSEHOLD_ID, ME);
    await expect((await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("cancelling the mark puts the debt back", async () => {
    const { as } = setup();
    const aidos = await as("aidos@obshak.test");
    const st = await aidos.markSettlement(HOUSEHOLD_ID, ME);
    await aidos.cancelSettlement(st.id);
    await expect((await as("erasyl@obshak.test")).remind(SECRET, HOUSEHOLD_ID, AIDOS)).resolves.toMatchObject({ amount: 1000 });
  });
});
