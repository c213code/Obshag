import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { HOUSEHOLD_ID, SEED_PASSWORD, createSeed } from "./seed";
import type { Repo } from "./repo";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME, AIDOS, DANYA] = createSeed().profiles.map((p) => p.id);
const EMAIL: Record<string, string> = { [ME]: "erasyl@obshak.test", [AIDOS]: "aidos@obshak.test", [DANYA]: "danya@obshak.test" };

function setup() {
  const storage = memoryStorage();
  let t = Date.parse("2026-11-09T12:00:00Z");
  const now = () => new Date(t);
  const as = async (id: string): Promise<Repo> => {
    const r = createMockRepo({ storage, session: memorySession(), now, serverSecret: SECRET });
    await r.signIn(EMAIL[id], SEED_PASSWORD);
    return r;
  };
  return { as, advance: (ms: number) => (t += ms) };
}

describe("mock event duties", () => {
  it("Мусор: the turn follows the doers, the ping has a 2 h cooldown", async () => {
    const env = setup();
    const me = await env.as(ME);
    const duty = await me.createDuty({ household_id: HOUSEHOLD_ID, kind: "trash", title: "Мусор", order: [ME, AIDOS, DANYA] });
    const aidos = await env.as(AIDOS);
    const e = await aidos.dutyPing(duty.id);
    expect(e.partner_id).toBe(ME);
    await expect(aidos.dutyPing(duty.id)).rejects.toMatchObject({ code: "rate_limited", retryAfter: 7200 });
    env.advance(2 * 3600_000 + 1000);
    await aidos.dutyPing(duty.id);
    await me.dutyDoneEvent(duty.id);
    expect((await me.listDutyEvents(duty.id))[0]).toMatchObject({ kind: "ping" });
    await expect(me.waterEmpty(duty.id)).rejects.toMatchObject({ code: "invalid" });
  });

  it("Вода: alone 10 L, with a partner 20 L = 400 ₸ shared purchase; empty zeroes the stock", async () => {
    const env = setup();
    const me = await env.as(ME);
    const duty = await me.createDuty({ household_id: HOUSEHOLD_ID, kind: "water", title: "Вода", order: [ME, AIDOS, DANYA] });
    expect(duty).toMatchObject({ price_per_liter: 20, bottles_full: 4 });
    const aidos = await env.as(AIDOS);
    const ev = await aidos.waterBrought(duty.id, DANYA);
    expect(ev.liters).toBe(20);
    const p = (await aidos.listPurchases(HOUSEHOLD_ID)).find((x) => x.id === ev.purchase_id);
    expect(p).toMatchObject({ amount: 400, description: "Вода 20 л", payer_id: AIDOS });
    await expect(aidos.waterBrought(duty.id, AIDOS)).rejects.toMatchObject({ code: "invalid" });
    await aidos.waterEmpty(duty.id);
    expect((await me.listDuties(HOUSEHOLD_ID)).find((d) => d.kind === "water")?.bottles_full).toBe(0);
    await expect(aidos.setWaterPrice(duty.id, 30)).rejects.toMatchObject({ code: "forbidden" });
    expect((await me.setWaterPrice(duty.id, 30)).price_per_liter).toBe(30);
  });
});
