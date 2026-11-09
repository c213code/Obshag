import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { createSupabaseRepo } from "./supabaseRepo";
import { HOUSEHOLD_ID, SEED_EMAIL, SEED_PASSWORD, createSeed } from "./seed";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME] = createSeed().profiles.map((p) => p.id);

function setup(startIso = "2026-11-09T12:00:00Z") {
  const storage = memoryStorage();
  let t = Date.parse(startIso);
  const now = () => new Date(t);
  const make = (session = memorySession()) => createMockRepo({ storage, session, now, serverSecret: SECRET });
  return { make, advance: (ms: number) => (t += ms) };
}
async function signedIn(make: ReturnType<typeof setup>["make"], email = SEED_EMAIL) {
  const r = make();
  await r.signIn(email, SEED_PASSWORD);
  return r;
}

describe("mockRepo Telegram link", () => {
  it("a code links once, is single use, and the profile only learns «linked»", async () => {
    const { make } = setup();
    const me = await signedIn(make);
    const code = await me.createTelegramLinkCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect((await me.getMe())?.telegram_linked).toBe(false);
    expect(await make().tgLinkAccount(SECRET, code, 4242)).toBe("Ерасыл");
    const profile = await me.getMe();
    expect(profile?.telegram_linked).toBe(true);
    expect(profile).not.toHaveProperty("telegram_user_id");
    expect(await make().tgLinkAccount(SECRET, code, 5555)).toBeNull();
    await me.unlinkTelegram();
    expect((await me.getMe())?.telegram_linked).toBe(false);
  });
  it("a new code kills the old one, an expired code and a wrong secret do nothing, re-linking moves the id", async () => {
    const { make, advance } = setup();
    const me = await signedIn(make);
    const first = await me.createTelegramLinkCode();
    const second = await me.createTelegramLinkCode();
    expect(await make().tgLinkAccount(SECRET, first, 1)).toBeNull();
    await expect(make().tgLinkAccount("wrong", second, 1)).rejects.toMatchObject({ code: "unauthenticated" });
    advance(16 * 60_000);
    expect(await make().tgLinkAccount(SECRET, second, 1)).toBeNull();
    const aidos = await signedIn(make, "aidos@obshak.test");
    await me.tgLinkAccount(SECRET, await me.createTelegramLinkCode(), 777);
    await aidos.tgLinkAccount(SECRET, await aidos.createTelegramLinkCode(), 777);
    expect((await me.getMe())?.telegram_linked).toBe(false);
    expect((await aidos.getMe())?.telegram_linked).toBe(true);
  });
  it("junk codes are refused without touching anything", async () => {
    const { make } = setup();
    expect(await make().tgLinkAccount(SECRET, "short", 1)).toBeNull();
    expect(await make().tgLinkAccount(SECRET, "x".repeat(30), 0)).toBeNull();
  });
});

describe("mockRepo tgResolvePending and runPendingDigest", () => {
  async function pending() {
    const s = setup();
    const me = await signedIn(s.make);
    await me.tgLinkAccount(SECRET, await me.createTelegramLinkCode(), 4242);
    const key = await me.rotateCaptureToken();
    const cap = await s.make().capture(key, 3000, "Small", null);
    return { ...s, me, id: cap.purchase_id };
  }

  it("only the payer's tg user resolves a pending purchase; shared creates the shares; a second tap is «already»", async () => {
    const { make, me, id } = await pending();
    await expect(make().tgResolvePending(SECRET, 999, id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(make().tgResolvePending("nope", 4242, id, true)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await make().tgResolvePending(SECRET, 4242, id, true)).toBe("shared");
    expect(await make().tgResolvePending(SECRET, 4242, id, false)).toBe("already_resolved");
    const row = (await me.listPurchases(HOUSEHOLD_ID)).find((p) => p.id === id)!;
    expect(row).toMatchObject({ status: "shared", description: "Small" });
    expect(row.shares.reduce((n, x) => n + x.amount, 0)).toBe(3000);
  });
  it("personal has no shares", async () => {
    const { make, me, id } = await pending();
    expect(await make().tgResolvePending(SECRET, 4242, id, false)).toBe("personal");
    expect((await me.listPurchases(HOUSEHOLD_ID)).find((p) => p.id === id)).toMatchObject({ status: "personal", shares: [] });
  });
  it("the digest skips recent purchases, then lists them once a day", async () => {
    const { make, advance, id } = await pending();
    expect(await make().runPendingDigest(SECRET)).toEqual([]);
    advance(11 * 60_000);
    const [first] = await make().runPendingDigest(SECRET);
    expect(first).toMatchObject({ user_id: ME, telegram_user_id: 4242, subscriptions: [] });
    expect(first.purchases.map((p) => p.id)).toEqual([id]);
    expect(await make().runPendingDigest(SECRET)).toEqual([]);
    advance(24 * 3600_000);
    expect(await make().runPendingDigest(SECRET)).toHaveLength(1);
    await expect(make().runPendingDigest("nope")).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("the digest skips resolved purchases and people with no way to be reached", async () => {
    const { make, advance, id } = await pending();
    await make().tgResolvePending(SECRET, 4242, id, false);
    advance(11 * 60_000);
    expect(await make().runPendingDigest(SECRET)).toEqual([]);
  });
});

describe("supabaseRepo Telegram RPCs", () => {
  it("calls the RPCs with the migration's parameter names and keeps the chat id out of the profile", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const data: Record<string, unknown> = {
      create_telegram_link_code: "abcdefghijklmnopqrstuvwx",
      tg_link_account: "Айдос",
      tg_resolve_pending: "shared",
      run_pending_digest: [],
    };
    const client = {
      rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: data[fn] ?? null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }), getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "u1", display_name: "A", telegram_user_id: 5 }, error: null }) }) }) }),
    } as unknown as SupabaseClient;
    const repo = createSupabaseRepo(client);
    expect(await repo.createTelegramLinkCode()).toBe("abcdefghijklmnopqrstuvwx");
    await repo.unlinkTelegram();
    expect(await repo.tgLinkAccount("s", "code", 9)).toBe("Айдос");
    expect(await repo.tgResolvePending("s", 9, "p1", true)).toBe("shared");
    expect(await repo.runPendingDigest("s")).toEqual([]);
    expect(await repo.getMe()).toEqual({ id: "u1", display_name: "A", telegram_linked: true });
    expect(calls).toEqual([
      { fn: "create_telegram_link_code", args: undefined },
      { fn: "unlink_telegram", args: undefined },
      { fn: "tg_link_account", args: { p_secret: "s", p_code: "code", p_tg_user_id: 9 } },
      { fn: "tg_resolve_pending", args: { p_secret: "s", p_tg_user_id: 9, p_purchase: "p1", p_shared: true } },
      { fn: "run_pending_digest", args: { p_secret: "s" } },
    ]);
  });
});
