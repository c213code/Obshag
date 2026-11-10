import { pickAvatarColor } from "@/lib/domain/avatar";
import { newId } from "@/lib/domain/uuid";
import {
  createPurchaseCustomSchema,
  createPurchaseSchema,
  descriptionSchema,
  emailSchema,
  householdNameSchema,
  inviteCodeSchema,
  passwordSchema,
  profileSchema,
  billSchema,
  billMonthSchema,
  tengeSchema,
} from "@/lib/domain/schemas";
import { almatyDay } from "@/lib/domain/almaty";
import { isAway } from "@/lib/domain/away";
import { coveredShares, isStale, netPair, pairShares } from "@/lib/domain/netting";
import { splitEqual } from "@/lib/domain/split";
import { newCaptureToken, sha256Hex } from "@/lib/domain/hash";
import { MAX_AMOUNT, normalizeTelegramUsername, pushSubscriptionSchema, resolvePendingSchema } from "@/lib/domain/schemas";
import {
  RepoError,
  type AuthSession,
  type MemberWithProfile,
  type NewCustomPurchase,
  type NewPurchase,
  type ProfileDraft,
  type PurchaseWithShares,
  type Repo,
} from "./repo";
import { MockConflictError, type MockStorage, type StoredMock } from "./mockDb";
import { createSeed, SEED_EMAIL, type MockDb } from "./seed";
import { createMockDuty } from "./mockDuty";
import { createMockPaid } from "./mockPaid";
import { isAccumulating, isTransferable } from "@/lib/domain/minTransfer";
import type { Bill, BillNotice, CaptureResult, CaptureTokenInfo, Household, MonthlyRun, PendingDigestUser, Profile, Purchase, ReminderTarget, Settlement, Share, Uuid } from "./types";

/** Which mock user is signed in on THIS device (never shared, like a browser cookie). */
export type SessionStore = { get(): Uuid | null; set(userId: Uuid | null): void };

export type MockRepoOptions = {
  storage?: MockStorage;
  session?: SessionStore;
  /** Test seam for the join rate limit. */
  now?: () => Date;
  /** The CRON_SECRET the server-only reminder calls must present (the SQL stores its hash). Unset = they always fail. */
  serverSecret?: string;
};

export function memoryStorage(initial?: MockDb): MockStorage {
  let stored: StoredMock | null = initial ? { rev: 1, db: structuredClone(initial) } : null;
  return {
    async load() {
      return stored ? { rev: stored.rev, db: structuredClone(stored.db) } : null;
    },
    async save(next, baseRev) {
      if ((stored?.rev ?? 0) !== baseRev) throw new MockConflictError();
      stored = { rev: baseRev + 1, db: structuredClone(next) };
    },
  };
}

export function memorySession(initial: Uuid | null = null): SessionStore {
  let id = initial;
  return { get: () => id, set: (next) => (id = next) };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_LIMIT = 10;
const SETTLEMENT_OPS_LIMIT = 20;
const CAPTURE_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;
const MAX_RETRIES = 8;
const DAY_MS = 24 * HOUR_MS;
const REMIND_COOLDOWN_MS = 6 * HOUR_MS;

/** Constant-time string compare (the secret is short; lengths are compared after padding to the longer one). */
function sameSecret(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function randomCode(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

const firstIssue = (e: { issues: ReadonlyArray<{ message: string }> }) => e.issues[0]?.message ?? "Invalid input";
const normalizeCode = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

/**
 * In-memory Repo for mock mode and tests. It mirrors the SQL RPCs (rules, errors, rate limit) so the
 * same contract test holds for both implementations. Every call is load -> mutate -> save against a
 * MockStorage, so several browser contexts can share one store in E2E.
 */
export function createMockRepo(opts: MockRepoOptions = {}): Repo {
  const storage = opts.storage ?? memoryStorage();
  const session = opts.session ?? memorySession();
  const now = opts.now ?? (() => new Date());

  /** The stored copy, or a fresh seed (saved at once so every device starts from the same data). */
  async function load(): Promise<StoredMock> {
    for (let attempt = 0; ; attempt++) {
      const stored = await storage.load();
      if (stored) return stored;
      const seeded = createSeed();
      try {
        await storage.save(seeded, 0);
        return { rev: 1, db: seeded };
      } catch (e) {
        if (!(e instanceof MockConflictError) || attempt >= MAX_RETRIES) throw e; // somebody else seeded first: read theirs
      }
    }
  }

  // Transactions of THIS repo run one after another; across devices the revision check catches the rest.
  let queue: Promise<unknown> = Promise.resolve();

  /**
   * load -> fn -> save (also when fn throws, so rate-limit attempts persist like in SQL). A concurrent
   * writer makes the save fail with a conflict: reload and run fn again on the fresh data.
   */
  function tx<T>(fn: (db: MockDb) => T): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const { rev, db } = await load();
        let result: { ok: true; value: T } | { ok: false; error: unknown };
        try {
          result = { ok: true, value: fn(db) };
        } catch (error) {
          result = { ok: false, error };
        }
        try {
          await storage.save(db, rev);
        } catch (e) {
          if (e instanceof MockConflictError && attempt < MAX_RETRIES) continue;
          throw e;
        }
        if (result.ok) return result.value;
        throw result.error;
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }
  async function read<T>(fn: (db: MockDb) => T): Promise<T> {
    return fn((await load()).db);
  }

  const uid = (): Uuid => {
    const id = session.get();
    if (!id) throw new RepoError("unauthenticated", "Not signed in");
    return id;
  };
  const profileOf = (db: MockDb, id: Uuid) => db.profiles.find((p) => p.id === id);
  const requireProfile = (db: MockDb, id: Uuid) => {
    const p = profileOf(db, id);
    if (!p) throw new RepoError("profile_required", "Create a profile first");
    return p;
  };
  const isMember = (db: MockDb, householdId: Uuid, userId: Uuid) =>
    db.members.some((m) => m.household_id === householdId && m.user_id === userId && m.active);
  const requireMember = (db: MockDb, householdId: Uuid, userId: Uuid) => {
    if (!isMember(db, householdId, userId)) throw new RepoError("forbidden", "Not a member of this household");
  };
  const householdPurchases = (db: MockDb, householdId: Uuid) => db.purchases.filter((p) => p.household_id === householdId);
  const householdShares = (db: MockDb, householdId: Uuid) => {
    const ids = new Set(householdPurchases(db, householdId).map((p) => p.id));
    return db.shares.filter((s) => ids.has(s.purchase_id));
  };
  /** A settlement the caller is a party of; a missing id and somebody else's id look the same (not_found). */
  const findSettlement = (db: MockDb, id: Uuid, userId: Uuid): Settlement => {
    const s = db.settlements.find((x) => x.id === id);
    if (!s || (s.from_id !== userId && s.to_id !== userId) || !isMember(db, s.household_id, userId)) {
      throw new RepoError("not_found", "Settlement not found");
    }
    return s;
  };
  /** At most 20 mark/cancel calls per user per hour; the call is only counted when it goes through (SQL rolls back otherwise). */
  const settlementOpsLeft = (db: MockDb, userId: Uuid) => {
    const t = now().getTime();
    db.settlementOps = db.settlementOps.filter((o) => t - Date.parse(o.at) < HOUR_MS);
    if (db.settlementOps.filter((o) => o.user_id === userId).length >= SETTLEMENT_OPS_LIMIT) {
      throw new RepoError("rate_limited", "Too many settlement actions");
    }
  };
  const countSettlementOp = (db: MockDb, userId: Uuid) => db.settlementOps.push({ user_id: userId, at: now().toISOString() });
  /** Rewrites the recorded set from the current open shares and derives the amount from it (the SQL record_settlement_shares). */
  const record = (db: MockDb, s: Settlement) => {
    const covered = pairShares(s.from_id, s.to_id, householdShares(db, s.household_id), householdPurchases(db, s.household_id));
    const amount = covered.reduce((sum, c) => sum + (c.debtor_id === s.from_id ? c.amount : -c.amount), 0);
    if (amount <= 0) throw new RepoError("invalid", "You do not owe this person");
    s.covered = covered;
    s.amount = amount;
  };
  const withShares = (db: MockDb, p: Purchase): PurchaseWithShares =>
    structuredClone({ ...p, shares: db.shares.filter((s) => s.purchase_id === p.id) });

  const requireSecret = (secret: string) => {
    if (typeof secret !== "string" || secret === "" || !opts.serverSecret || !sameSecret(secret, opts.serverSecret)) {
      throw new RepoError("unauthenticated", "Invalid server secret");
    }
  };
  const subscriptionsOf = (db: MockDb, userId: Uuid) =>
    db.pushSubscriptions.filter((x) => x.user_id === userId).map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth }));
  const lastReminder = (db: MockDb, from: Uuid, to: Uuid, t: number) => {
    const times = db.reminderLog.filter((l) => l.from_id === from && l.to_id === to && t - Date.parse(l.at) < REMIND_COOLDOWN_MS).map((l) => Date.parse(l.at));
    return times.length ? Math.max(...times) : null;
  };
  const target = (db: MockDb, debtor: Uuid, creditor: Uuid, amount: number): ReminderTarget => ({
    to_user: debtor,
    from_user: creditor,
    from_name_dative: profileOf(db, creditor)?.display_name ?? "",
    amount,
    subscriptions: subscriptionsOf(db, debtor),
  });

  /** SQL private.mark_settlement_for: the marked settlement of `id` -> `toUserId` (idempotent per pair). */
  const markIn = (db: MockDb, id: Uuid, householdId: Uuid, toUserId: Uuid): Settlement => {
    if (!householdId || !toUserId || !isMember(db, householdId, id)) throw new RepoError("forbidden", "Not a member of this household");
    if (toUserId === id) throw new RepoError("invalid", "Cannot settle with yourself");
    if (!isMember(db, householdId, toUserId)) throw new RepoError("invalid", "Counterparty is not an active member");
    settlementOpsLeft(db, id);
    // a debt Kaspi cannot transfer is never marked as paid (the creditor can write it off instead)
    const net = netPair(id, toUserId, householdShares(db, householdId), householdPurchases(db, householdId));
    if (net.direction === "i_pay" && isAccumulating(net.net)) throw new RepoError("too_small", "Below the Kaspi minimum");
    // one open marked settlement per pair and direction: asking again returns it, its record refreshed to the current open shares
    const open = db.settlements
      .filter((x) => x.household_id === householdId && x.from_id === id && x.to_id === toUserId && x.status === "marked")
      .sort((a, b) => b.marked_at.localeCompare(a.marked_at) || a.id.localeCompare(b.id))[0];
    if (open) {
      record(db, open);
      countSettlementOp(db, id);
      return structuredClone(open);
    }
    // the amount is computed here, from the open shares: nothing comes from the caller
    const pair = netPair(id, toUserId, householdShares(db, householdId), householdPurchases(db, householdId));
    if (pair.direction !== "i_pay") throw new RepoError("invalid", "You do not owe this person");
    const created: Settlement = {
      id: newId(),
      household_id: householdId,
      from_id: id,
      to_id: toUserId,
      amount: pair.net,
      status: "marked",
      marked_at: now().toISOString(),
      confirmed_at: null,
      kind: "transfer",
      covered: [],
    };
    record(db, created);
    db.settlements.push(created);
    countSettlementOp(db, id);
    return structuredClone(created);
  };

  /** SQL private.create_bill_purchase: null when nothing can be created (payer gone, nobody left, amount too small, already there). */
  const createBillPurchase = (db: MockDb, bill: Bill, month: string, amount: number): PurchaseWithShares | null => {
    if (!isMember(db, bill.household_id, bill.payer_id)) return null;
    const ids = bill.participants.filter((x) => isMember(db, bill.household_id, x));
    if (ids.length < 1 || amount < ids.length || amount > MAX_AMOUNT) return null;
    if (db.purchases.some((p) => p.bill_id === bill.id && p.bill_month === month)) return null;
    const createdAt = now().toISOString();
    const purchase: Purchase = {
      id: newId(),
      household_id: bill.household_id,
      payer_id: bill.payer_id,
      amount,
      description: bill.title,
      merchant: null,
      source: "monthly",
      status: "shared",
      created_at: createdAt,
      bill_id: bill.id,
      bill_month: month,
    };
    db.purchases.push(purchase);
    for (const s of splitEqual(amount, ids, bill.payer_id)) {
      db.shares.push({ purchase_id: purchase.id, debtor_id: s.debtor_id, amount: s.amount, settled_at: s.settled ? createdAt : null, settlement_id: null });
    }
    return withShares(db, purchase);
  };
  const isAdmin = (db: MockDb, householdId: Uuid, userId: Uuid) =>
    db.members.some((m) => m.household_id === householdId && m.user_id === userId && m.active && m.role === "admin");
  const requireAdmin = (db: MockDb, householdId: Uuid, userId: Uuid) => {
    if (!isAdmin(db, householdId, userId)) throw new RepoError("forbidden", "Admins only");
  };
  /** Non-zero net with anyone in the household (SQL private.has_open_net). */
  const hasOpenNet = (db: MockDb, householdId: Uuid, userId: Uuid) => {
    const shares = householdShares(db, householdId);
    const purchases = householdPurchases(db, householdId);
    return db.members.some(
      (m) => m.household_id === householdId && m.user_id !== userId && netPair(userId, m.user_id, shares, purchases).direction !== "even",
    );
  };
  /** SQL private.detach_member: leaves the bills, its bills pass to the first other admin, forgets the default household. */
  const detachMember = (db: MockDb, householdId: Uuid, userId: Uuid) => {
    const heir = db.members
      .filter((m) => m.household_id === householdId && m.user_id !== userId && m.active && m.role === "admin")
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id))[0];
    for (const b of db.bills.filter((x) => x.household_id === householdId)) {
      b.participants = b.participants.filter((x) => x !== userId);
      if (b.payer_id === userId && heir) b.payer_id = heir.user_id;
    }
    const p = profileOf(db, userId);
    if (p && p.default_household_id === householdId) p.default_household_id = null;
  };
  /** The SQL last-admin trigger: an active admin may not stop being one while no other active admin remains. */
  const guardLastAdmin = (db: MockDb, householdId: Uuid, userId: Uuid) => {
    const others = db.members.some((m) => m.household_id === householdId && m.user_id !== userId && m.role === "admin" && m.active);
    if (!others) throw new RepoError("invalid", "A household must keep at least one active admin");
  };

  return {
    async getSession() {
      const id = session.get();
      if (!id) return null;
      return read((db) => {
        const u = db.users.find((x) => x.id === id);
        return u ? { user_id: u.id, email: u.email } : null;
      });
    },

    async signUp(email, password): Promise<AuthSession> {
      const e = emailSchema.safeParse(email);
      if (!e.success) throw new RepoError("invalid", firstIssue(e.error));
      if (!passwordSchema.safeParse(password).success) throw new RepoError("weak_password", "Password is too short");
      const user = await tx((db) => {
        if (db.users.some((x) => x.email === e.data)) throw new RepoError("email_taken", "Email is already registered");
        const created = { id: newId(), email: e.data, password };
        db.users.push(created);
        return created;
      });
      session.set(user.id);
      return { user_id: user.id, email: user.email };
    },

    async signIn(email, password): Promise<AuthSession> {
      const e = emailSchema.safeParse(email);
      const wrong = () => new RepoError("invalid_credentials", "Invalid email or password");
      if (!e.success || !password) throw wrong();
      const user = await read((db) => db.users.find((x) => x.email === e.data));
      // the same answer for an unknown email and a wrong password
      if (!user || user.password !== password) throw wrong();
      session.set(user.id);
      return { user_id: user.id, email: user.email };
    },

    async signOut() {
      session.set(null);
    },

    async requestPasswordReset(email) {
      const e = emailSchema.safeParse(email);
      if (!e.success) throw new RepoError("invalid", firstIssue(e.error));
      // mock: succeeds silently for any address, like the real thing
    },

    async startPasswordRecovery(link) {
      // mock mode has no mail: /reset?mock=1 signs in the seeded user so E2E can set a new password
      if (!link.mock) throw new RepoError("invalid_link", "The reset link is invalid or expired");
      const user = await read((db) => db.users.find((x) => x.email === (link.mockEmail?.trim().toLowerCase() || SEED_EMAIL)) ?? db.users[0]);
      if (!user) throw new RepoError("invalid_link", "The reset link is invalid or expired");
      session.set(user.id);
    },

    async updatePassword(password) {
      if (!passwordSchema.safeParse(password).success) throw new RepoError("weak_password", "Password is too short");
      const id = uid();
      await tx((db) => {
        const user = db.users.find((x) => x.id === id);
        if (!user) throw new RepoError("unauthenticated", "Not signed in");
        user.password = password;
      });
    },

    async getMe() {
      const id = uid();
      return read((db) => {
        const p = profileOf(db, id);
        if (!p) return null;
        const { telegram_user_id: tg, ...rest } = structuredClone(p);
        return { ...rest, telegram_linked: tg !== null && tg !== undefined };
      });
    },

    async createTelegramLinkCode() {
      const id = uid();
      const code = newCaptureToken().slice(0, 24);
      const hash = await sha256Hex(code);
      return tx((db) => {
        requireProfile(db, id);
        const t = now().getTime();
        db.telegramCodes = (db.telegramCodes ?? []).filter((c) => c.user_id !== id && Date.parse(c.expires_at) > t);
        db.telegramCodes.push({ code_hash: hash, user_id: id, expires_at: new Date(t + 15 * 60_000).toISOString() });
        return code;
      });
    },

    async unlinkTelegram() {
      const id = uid();
      await tx((db) => {
        const p = profileOf(db, id);
        if (p) p.telegram_user_id = null;
        db.telegramCodes = (db.telegramCodes ?? []).filter((c) => c.user_id !== id);
      });
    },

    async tgLinkAccount(secret, code, tgUserId) {
      requireSecret(secret);
      if (typeof code !== "string" || code.length < 16 || code.length > 64 || !Number.isInteger(tgUserId) || tgUserId <= 0) return null;
      const hash = await sha256Hex(code);
      return tx((db) => {
        const t = now().getTime();
        const row = (db.telegramCodes ?? []).find((c) => c.code_hash === hash && Date.parse(c.expires_at) > t);
        if (!row) return null;
        db.telegramCodes = (db.telegramCodes ?? []).filter((c) => c !== row);
        for (const p of db.profiles) if (p.telegram_user_id === tgUserId && p.id !== row.user_id) p.telegram_user_id = null;
        const me = profileOf(db, row.user_id);
        if (!me) return null;
        me.telegram_user_id = tgUserId;
        return me.display_name;
      });
    },

    async tgResolvePending(secret, tgUserId, purchaseId, shared) {
      requireSecret(secret);
      return tx((db) => {
        const p = db.purchases.find((x) => x.id === purchaseId);
        if (!p || profileOf(db, p.payer_id)?.telegram_user_id !== tgUserId || !isMember(db, p.household_id, p.payer_id)) {
          throw new RepoError("forbidden", "Not allowed");
        }
        if (p.status !== "pending") return "already_resolved";
        if (!shared) {
          p.status = "personal";
          return "personal";
        }
        const roster = db.members
          .filter((m) => m.household_id === p.household_id && m.active)
          .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id));
        const home = roster.filter((m) => !isAway(m.away_until, almatyDay(now()).date));
        const who = (home.length > 0 ? home : roster).map((m) => m.user_id);
        if (who.length === 0 || p.amount < who.length) return "too_small";
        p.status = "shared";
        p.description = p.merchant?.trim() || "Покупка";
        for (const s of splitEqual(p.amount, who, p.payer_id)) {
          db.shares.push({ purchase_id: p.id, debtor_id: s.debtor_id, amount: s.amount, settled_at: s.settled ? now().toISOString() : null, settlement_id: null });
        }
        return "shared";
      });
    },

    async runPendingDigest(secret) {
      requireSecret(secret);
      return tx((db) => {
        const t = now().getTime();
        const today = almatyDay(now()).date;
        db.digestLog = (db.digestLog ?? []).filter((l) => t - Date.parse(`${l.sent_on}T00:00:00Z`) < 8 * DAY_MS);
        const out: PendingDigestUser[] = [];
        for (const prof of [...db.profiles].sort((a, b) => a.id.localeCompare(b.id))) {
          const subs = subscriptionsOf(db, prof.id);
          const tg = prof.telegram_user_id ?? null;
          if (tg === null && subs.length === 0) continue;
          const waiting = db.purchases
            .filter(
              (p) =>
                p.payer_id === prof.id &&
                p.status === "pending" &&
                t - Date.parse(p.created_at) > 10 * 60_000 &&
                !(db.digestLog ?? []).some((l) => l.purchase_id === p.id && l.sent_on === today),
            )
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
            .slice(0, 10);
          if (waiting.length === 0) continue;
          for (const p of waiting) db.digestLog = [...(db.digestLog ?? []), { purchase_id: p.id, sent_on: today }];
          out.push({
            user_id: prof.id,
            telegram_user_id: tg,
            subscriptions: subs,
            purchases: waiting.map((p) => ({ id: p.id, merchant: p.merchant, amount: p.amount, created_at: p.created_at })),
          });
        }
        return out;
      });
    },

    async upsertProfile(input: ProfileDraft) {
      const id = uid();
      const parsed = profileSchema.safeParse(input);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      return tx((db): Profile => {
        const existing = profileOf(db, id);
        if (existing) {
          existing.display_name = parsed.data.display_name;
          existing.kaspi_phone = parsed.data.kaspi_phone;
          return structuredClone(existing);
        }
        const created: Profile = {
          id,
          display_name: parsed.data.display_name,
          kaspi_phone: parsed.data.kaspi_phone,
          avatar_color: pickAvatarColor(id),
          created_at: now().toISOString(),
        };
        db.profiles.push(created);
        return structuredClone(created);
      });
    },

    async listHouseholds() {
      const id = uid();
      return read((db) => structuredClone(db.households.filter((h) => isMember(db, h.id, id))));
    },

    async listMembers(householdId) {
      const id = uid();
      return read((db) => {
        requireMember(db, householdId, id);
        return db.members
          .filter((m) => m.household_id === householdId && m.active)
          .flatMap((m): MemberWithProfile[] => {
            const p = profileOf(db, m.user_id);
            return p ? [structuredClone({ ...m, profile: p })] : [];
          });
      });
    },

    async listPurchases(householdId) {
      const id = uid();
      return read((db) => {
        requireMember(db, householdId, id);
        return db.purchases
          .filter((p) => p.household_id === householdId)
          .filter((p) => p.status === "shared" || p.payer_id === id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((p) => withShares(db, p));
      });
    },

    async createHousehold(name) {
      const id = uid();
      const parsed = householdNameSchema.safeParse(name);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      return tx((db): Household => {
        requireProfile(db, id);
        const created = now().toISOString();
        const household: Household = {
          id: newId(),
          name: parsed.data,
          invite_code: randomCode(),
          created_by: id,
          created_at: created,
        };
        db.households.push(household);
        db.members.push({ household_id: household.id, user_id: id, role: "admin", active: true, away_until: null, joined_at: created });
        return structuredClone(household);
      });
    },

    async joinHousehold(inviteCode) {
      const id = uid();
      const fail = () => new RepoError("join_failed", "Invalid or unavailable invite code");
      return tx((db): Household => {
        requireProfile(db, id);
        const t = now();
        const recent = db.joinAttempts.filter((a) => a.user_id === id && t.getTime() - Date.parse(a.at) < HOUR_MS);
        db.joinAttempts = db.joinAttempts.filter((a) => t.getTime() - Date.parse(a.at) < HOUR_MS);
        if (recent.length >= JOIN_LIMIT) throw fail();
        db.joinAttempts.push({ user_id: id, at: t.toISOString() });

        const code = inviteCode.length > 64 ? { success: false as const } : inviteCodeSchema.safeParse(inviteCode);
        const household = code.success ? db.households.find((h) => normalizeCode(h.invite_code) === code.data) : undefined;
        if (!household) throw fail();

        const member = db.members.find((m) => m.household_id === household.id && m.user_id === id);
        if (member) {
          // coming back never restores an old admin role or an old "away" period (same rule as the SQL)
          if (!member.active) Object.assign(member, { active: true, role: "member", away_until: null });
        } else {
          db.members.push({ household_id: household.id, user_id: id, role: "member", active: true, away_until: null, joined_at: t.toISOString() });
        }
        return structuredClone(household);
      });
    },

    async createPurchase(raw: NewPurchase) {
      const id = uid();
      const parsed = createPurchaseSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      return tx((db): PurchaseWithShares => {
        requireMember(db, input.household_id, id);
        if (!input.participant_ids.every((p) => isMember(db, input.household_id, p))) {
          throw new RepoError("invalid", "Every participant must be an active member of the household");
        }
        const createdAt = now().toISOString();
        const purchase: Purchase = {
          id: newId(),
          household_id: input.household_id,
          payer_id: id,
          amount: input.amount,
          description: input.description,
          merchant: input.merchant ? input.merchant : null,
          source: "manual",
          status: "shared",
          created_at: createdAt,
        };
        const shares: Share[] = splitEqual(input.amount, input.participant_ids, id).map((s) => ({
          purchase_id: purchase.id,
          debtor_id: s.debtor_id,
          amount: s.amount,
          settled_at: s.settled ? createdAt : null,
          settlement_id: null,
        }));
        db.purchases.push(purchase);
        db.shares.push(...shares);
        return structuredClone({ ...purchase, shares });
      });
    },

    async createPurchaseCustom(raw: NewCustomPurchase) {
      const id = uid();
      const parsed = createPurchaseCustomSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      return tx((db): PurchaseWithShares => {
        requireMember(db, input.household_id, id);
        if (!input.shares.every((r) => isMember(db, input.household_id, r.user_id))) {
          throw new RepoError("invalid", "Every entry must be an active member of the household");
        }
        if (!input.shares.some((r) => r.user_id !== id)) throw new RepoError("invalid", "At least one entry must not be the payer");
        const createdAt = now().toISOString();
        const purchase: Purchase = {
          id: newId(),
          household_id: input.household_id,
          payer_id: id,
          amount: input.amount,
          description: input.description,
          merchant: input.merchant ? input.merchant : null,
          source: "manual",
          status: "shared",
          created_at: createdAt,
        };
        const shares: Share[] = input.shares.map((r) => ({
          purchase_id: purchase.id,
          debtor_id: r.user_id,
          amount: r.amount,
          settled_at: r.user_id === id ? createdAt : null,
          settlement_id: null,
        }));
        db.purchases.push(purchase);
        db.shares.push(...shares);
        return structuredClone({ ...purchase, shares });
      });
    },

    async deletePurchase(purchaseId) {
      const id = uid();
      await tx((db) => {
        const p = db.purchases.find((x) => x.id === purchaseId);
        if (!p || !isMember(db, p.household_id, id) || (p.status !== "shared" && p.payer_id !== id)) throw new RepoError("not_found", "Purchase not found");
        const admin = p.status === "shared" && db.members.some((m) => m.household_id === p.household_id && m.user_id === id && m.active && m.role === "admin");
        if (p.payer_id !== id && !admin) throw new RepoError("forbidden", "Only the payer or an admin can delete");
        const paid = db.shares.some((s) => s.purchase_id === p.id && s.settled_at !== null && s.debtor_id !== p.payer_id);
        const covered = db.settlements.some((s) => s.status !== "cancelled" && s.covered.some((c) => c.purchase_id === p.id));
        if (paid || covered) throw new RepoError("has_payments", "Something was already paid for this purchase");
        db.purchases = db.purchases.filter((x) => x.id !== p.id);
        db.shares = db.shares.filter((s) => s.purchase_id !== p.id);
      });
    },

    async updatePurchaseDescription(purchaseId, description) {
      const id = uid();
      const parsed = descriptionSchema.safeParse(description);
      return tx((db): PurchaseWithShares => {
        const p = db.purchases.find((x) => x.id === purchaseId);
        if (!p || !isMember(db, p.household_id, id) || (p.status !== "shared" && p.payer_id !== id)) throw new RepoError("not_found", "Purchase not found");
        if (p.payer_id !== id) throw new RepoError("forbidden", "Only the payer can edit");
        if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
        p.description = parsed.data;
        return withShares(db, p);
      });
    },

    async setTelegramUsername(username) {
      const id = uid();
      const normalized = normalizeTelegramUsername(username);
      if (normalized === undefined) throw new RepoError("invalid", "Invalid Telegram username");
      return tx((db) => {
        const p = profileOf(db, id);
        if (!p) throw new RepoError("profile_required", "Create a profile first");
        p.telegram_username = normalized;
        return normalized;
      });
    },

    async setRemindersEnabled(householdId, enabled) {
      const id = uid();
      await tx((db) => {
        requireMember(db, householdId, id);
        const m = db.members.find((x) => x.household_id === householdId && x.user_id === id && x.active);
        if (m) m.reminders_enabled = enabled;
      });
    },

    async remind(secret, householdId, debtorId): Promise<ReminderTarget> {
      requireSecret(secret);
      const id = uid();
      return tx((db) => {
        if (!householdId || !debtorId || debtorId === id || !isMember(db, householdId, id) || !isMember(db, householdId, debtorId)) {
          throw new RepoError("forbidden", "Not allowed");
        }
        const pair = netPair(debtorId, id, householdShares(db, householdId), householdPurchases(db, householdId));
        if (pair.direction !== "i_pay") throw new RepoError("forbidden", "Not a creditor");
        if (!isTransferable(pair.net)) throw new RepoError("too_small", "Below the Kaspi minimum");
        const t = now().getTime();
        const last = lastReminder(db, id, debtorId, t);
        if (last !== null) {
          throw new RepoError("rate_limited", "Reminder cooldown", Math.max(1, Math.ceil((last + REMIND_COOLDOWN_MS - t) / 1000)));
        }
        db.reminderLog.push({ from_id: id, to_id: debtorId, at: now().toISOString() });
        return target(db, debtorId, id, pair.net);
      });
    },

    async runDailyReminders(secret): Promise<ReminderTarget[]> {
      requireSecret(secret);
      return tx((db) => {
        const t = now().getTime();
        db.reminderLog = db.reminderLog.filter((l) => t - Date.parse(l.at) < 7 * DAY_MS);
        const out: ReminderTarget[] = [];
        const active = db.members.filter((m) => m.active);
        const sorted = [...active].sort((a, b) => a.household_id.localeCompare(b.household_id) || a.user_id.localeCompare(b.user_id));
        for (const d of sorted) {
          if (d.reminders_enabled === false) continue;
          for (const c of sorted.filter((x) => x.household_id === d.household_id && x.user_id !== d.user_id)) {
            const shares = householdShares(db, d.household_id);
            const purchases = householdPurchases(db, d.household_id);
            const pair = netPair(d.user_id, c.user_id, shares, purchases);
            if (pair.direction !== "i_pay" || !isTransferable(pair.net)) continue;
            // the oldest open share the debtor owes this creditor
            const owed = new Set(pair.myItems.map((i) => i.purchase_id));
            const oldest = Math.min(...purchases.filter((p) => owed.has(p.id)).map((p) => Date.parse(p.created_at)));
            if (!Number.isFinite(oldest) || t - oldest <= DAY_MS) continue;
            if (lastReminder(db, c.user_id, d.user_id, t) !== null) continue;
            db.reminderLog.push({ from_id: c.user_id, to_id: d.user_id, at: now().toISOString() });
            out.push(target(db, d.user_id, c.user_id, pair.net));
          }
        }
        return out;
      });
    },

    async listSettlements(householdId) {
      const id = uid();
      return read((db) => {
        requireMember(db, householdId, id);
        return structuredClone(
          db.settlements
            .filter((x) => x.household_id === householdId)
            .sort((a, b) => b.marked_at.localeCompare(a.marked_at) || a.id.localeCompare(b.id)),
        );
      });
    },

    async markSettlement(householdId, toUserId) {
      const id = uid();
      return tx((db) => markIn(db, id, householdId, toUserId));
    },

    async confirmSettlement(settlementId, expectedAmount) {
      const id = uid();
      return tx((db): Settlement => {
        const s = findSettlement(db, settlementId, id);
        if (s.to_id !== id) throw new RepoError("forbidden", "Only the creditor can confirm");
        if (s.status === "confirmed") return structuredClone(s);
        if (s.status !== "marked") throw new RepoError("invalid", "Settlement is not open");
        if (expectedAmount !== undefined && expectedAmount !== s.amount) {
          throw new RepoError("stale", "The amounts changed since the payment was marked");
        }
        const shares = householdShares(db, s.household_id);
        const purchases = householdPurchases(db, s.household_id);
        // the books must still match what was recorded at the mark; otherwise nothing is closed
        if (isStale(s, shares, purchases)) throw new RepoError("stale", "The amounts changed since the payment was marked");
        const at = now().toISOString();
        for (const share of coveredShares(s, shares, purchases)) {
          share.settled_at = at;
          share.settlement_id = s.id;
        }
        s.status = "confirmed";
        s.confirmed_at = at;
        return structuredClone(s);
      });
    },

    async writeOffSmall(householdId, debtorId) {
      const id = uid();
      return tx((db): Settlement => {
        if (!householdId || !debtorId || debtorId === id || !isMember(db, householdId, id) || !isMember(db, householdId, debtorId)) {
          throw new RepoError("forbidden", "Not allowed");
        }
        settlementOpsLeft(db, id);
        const shares = householdShares(db, householdId);
        const purchases = householdPurchases(db, householdId);
        const pair = netPair(debtorId, id, shares, purchases);
        if (pair.direction !== "i_pay") throw new RepoError("forbidden", "Not a creditor");
        if (!isAccumulating(pair.net)) throw new RepoError("not_small", "Not below the Kaspi minimum");
        // a stale «paid» mark of the same pair is superseded by the write-off
        for (const s of db.settlements) {
          if (s.household_id === householdId && s.from_id === debtorId && s.to_id === id && s.status === "marked") s.status = "cancelled";
        }
        const at = now().toISOString();
        const created: Settlement = {
          id: newId(),
          household_id: householdId,
          from_id: debtorId,
          to_id: id,
          amount: pair.net,
          status: "confirmed",
          marked_at: at,
          confirmed_at: at,
          kind: "writeoff",
          covered: [],
        };
        record(db, created);
        for (const share of coveredShares(created, shares, purchases)) {
          share.settled_at = at;
          share.settlement_id = created.id;
        }
        db.settlements.push(created);
        countSettlementOp(db, id);
        return structuredClone(created);
      });
    },

    async cancelSettlement(settlementId) {
      const id = uid();
      return tx((db): Settlement => {
        const s = findSettlement(db, settlementId, id);
        if (s.status === "cancelled") return structuredClone(s);
        if (s.status !== "marked") throw new RepoError("invalid", "A confirmed settlement cannot be cancelled");
        settlementOpsLeft(db, id);
        s.status = "cancelled";
        countSettlementOp(db, id);
        return structuredClone(s);
      });
    },
    async getCaptureTokenInfo(): Promise<CaptureTokenInfo | null> {
      const id = uid();
      return read((db) => {
        const t = db.captureTokens.find((x) => x.user_id === id);
        return t ? { created_at: t.created_at, last_used_at: t.last_used_at } : null;
      });
    },

    async rotateCaptureToken() {
      const id = uid();
      const token = newCaptureToken();
      const hash = await sha256Hex(token);
      await tx((db) => {
        requireProfile(db, id);
        db.captureTokens = db.captureTokens.filter((x) => x.user_id !== id);
        db.captureTokens.push({ user_id: id, token_hash: hash, created_at: now().toISOString(), last_used_at: null });
      });
      return token;
    },

    async capture(token, amount, merchant, choice): Promise<CaptureResult> {
      const unknown = () => new RepoError("unauthenticated", "Invalid token");
      if (typeof token !== "string" || token.length < 20 || token.length > 200) throw unknown();
      const hash = await sha256Hex(token);
      return tx((db): CaptureResult => {
        const owner = db.captureTokens.find((x) => x.token_hash === hash);
        if (!owner) throw unknown();
        const userId = owner.user_id;
        const t = now().getTime();
        db.captureOps = db.captureOps.filter((o) => t - Date.parse(o.at) < HOUR_MS);
        if (db.captureOps.filter((o) => o.user_id === userId).length >= CAPTURE_LIMIT) throw new RepoError("rate_limited", "Too many captures");
        if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) throw new RepoError("invalid", "Invalid amount");
        // control characters and bidi overrides never reach a stored description or a notification title
        const cleaned = typeof merchant === "string" ? merchant.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim() : "";
        const name = cleaned !== "" ? cleaned : null;
        if ((name?.length ?? 0) > 120) throw new RepoError("invalid", "Invalid merchant");

        // the default household while the owner is still an active member there, else the most recently joined active one
        const preferred = profileOf(db, userId)?.default_household_id;
        const active = db.members.filter((m) => m.user_id === userId && m.active);
        const target =
          (preferred ? active.find((m) => m.household_id === preferred) : undefined) ??
          [...active].sort((a, b) => b.joined_at.localeCompare(a.joined_at) || a.household_id.localeCompare(b.household_id))[0];
        if (!target) throw new RepoError("invalid", "No household");

        // the Shortcut's own answer: shared = split between everyone at home (or everyone if nobody is), personal = mine
        let status: CaptureResult["status"] = "pending";
        let who: Uuid[] = [];
        if (choice === "personal") status = "personal";
        else if (choice === "shared") {
          const roster = db.members
            .filter((m) => m.household_id === target.household_id && m.active)
            .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id));
          const home = roster.filter((m) => !isAway(m.away_until, almatyDay(now()).date));
          who = (home.length > 0 ? home : roster).map((m) => m.user_id);
          if (who.length > 0 && amount >= who.length) status = "shared";
        }

        // a Shortcut retry (same amount, merchant and outcome within 60 s) returns the existing purchase, with no second push
        const twin = db.purchases.find(
          (p) => p.payer_id === userId && p.source === "apple_pay" && p.status === status && p.amount === amount && p.merchant === name && t - Date.parse(p.created_at) < 60_000,
        );
        if (twin) return { status, purchase_id: twin.id, household_id: twin.household_id, amount, merchant: name, subscriptions: [] };

        db.captureOps.push({ user_id: userId, at: now().toISOString() });
        owner.last_used_at = now().toISOString();
        const purchase: Purchase = {
          id: newId(),
          household_id: target.household_id,
          payer_id: userId,
          amount,
          description: name ?? "Покупка",
          merchant: name,
          source: "apple_pay",
          status,
          created_at: now().toISOString(),
        };
        db.purchases.push(purchase);
        if (status === "shared") {
          for (const s of splitEqual(amount, who, userId)) {
            db.shares.push({ purchase_id: purchase.id, debtor_id: s.debtor_id, amount: s.amount, settled_at: s.settled ? purchase.created_at : null, settlement_id: null });
          }
        }
        return {
          status,
          purchase_id: purchase.id,
          household_id: purchase.household_id,
          amount,
          merchant: name,
          subscriptions:
            status === "pending" ? db.pushSubscriptions.filter((x) => x.user_id === userId).map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })) : [],
        };
      });
    },

    async prunePushSubscription(token, endpoint) {
      if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new RepoError("unauthenticated", "Invalid token");
      const hash = await sha256Hex(token);
      await tx((db) => {
        const owner = db.captureTokens.find((x) => x.token_hash === hash);
        if (!owner) throw new RepoError("unauthenticated", "Invalid token");
        db.pushSubscriptions = db.pushSubscriptions.filter((x) => !(x.user_id === owner.user_id && x.endpoint === endpoint));
      });
    },

    async listPending(householdId) {
      const id = uid();
      return read((db) => {
        requireMember(db, householdId, id);
        return db.purchases
          .filter((p) => p.household_id === householdId && p.payer_id === id && p.status === "pending")
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
          .map((p) => withShares(db, p));
      });
    },

    async resolvePending(purchaseId, raw) {
      const id = uid();
      const parsed = resolvePendingSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      return tx((db): PurchaseWithShares => {
        const p = db.purchases.find((x) => x.id === purchaseId);
        // not found and not yours look the same
        if (!p || p.payer_id !== id || !isMember(db, p.household_id, id)) throw new RepoError("not_found", "Purchase not found");
        if (p.status !== "pending") {
          if ((p.status === "shared") === input.shared) return withShares(db, p);
          throw new RepoError("invalid", "Already resolved");
        }
        const description = input.description && input.description !== "" ? input.description : p.description;
        if (input.shared) {
          const who = input.participant_ids ?? [];
          if (p.amount < who.length) throw new RepoError("invalid", "Amount is smaller than the number of participants");
          if (!who.every((m) => isMember(db, p.household_id, m))) throw new RepoError("invalid", "Every participant must be an active member");
          const createdAt = now().toISOString();
          db.shares.push(
            ...splitEqual(p.amount, who, id).map((s) => ({
              purchase_id: p.id,
              debtor_id: s.debtor_id,
              amount: s.amount,
              settled_at: s.settled ? createdAt : null,
              settlement_id: null,
            })),
          );
        }
        p.description = description;
        p.status = input.shared ? "shared" : "personal";
        return withShares(db, p);
      });
    },

    async savePushSubscription(sub) {
      const id = uid();
      const parsed = pushSubscriptionSchema.safeParse(sub);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      await tx((db) => {
        db.pushSubscriptions = db.pushSubscriptions.filter((x) => x.endpoint !== parsed.data.endpoint);
        db.pushSubscriptions.push({ user_id: id, ...parsed.data, created_at: now().toISOString() });
      });
    },

    async deletePushSubscription(endpoint) {
      const id = uid();
      await tx((db) => {
        db.pushSubscriptions = db.pushSubscriptions.filter((x) => !(x.user_id === id && x.endpoint === endpoint));
      });
    },

    async setDefaultHousehold(householdId) {
      const id = uid();
      await tx((db) => {
        requireMember(db, householdId, id);
        requireProfile(db, id).default_household_id = householdId;
      });
    },

    async listBills(householdId) {
      const id = uid();
      return read((db) => {
        requireMember(db, householdId, id);
        return structuredClone(
          db.bills.filter((b) => b.household_id === householdId).sort((a, b) => a.day_of_month - b.day_of_month || a.id.localeCompare(b.id)),
        );
      });
    },

    async upsertBill(raw) {
      const id = uid();
      const parsed = billSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      return tx((db): Bill => {
        requireAdmin(db, input.household_id, id);
        const people = [input.payer_id, ...input.participants];
        if (!people.every((p) => isMember(db, input.household_id, p))) {
          throw new RepoError("invalid", "Payer and participants must be active members");
        }
        const fields = {
          title: input.title,
          icon: input.icon,
          amount: input.variable ? null : input.amount,
          variable: input.variable,
          day_of_month: input.day_of_month,
          payer_id: input.payer_id,
          participants: [...input.participants],
        };
        if (input.id) {
          const bill = db.bills.find((b) => b.id === input.id && b.household_id === input.household_id);
          if (!bill) throw new RepoError("not_found", "Bill not found");
          Object.assign(bill, fields);
          return structuredClone(bill);
        }
        const created: Bill = { id: newId(), household_id: input.household_id, last_generated_month: null, ...fields };
        db.bills.push(created);
        return structuredClone(created);
      });
    },

    async deleteBill(billId) {
      const id = uid();
      await tx((db) => {
        const bill = db.bills.find((b) => b.id === billId);
        if (!bill) throw new RepoError("not_found", "Bill not found");
        requireAdmin(db, bill.household_id, id);
        db.bills = db.bills.filter((b) => b.id !== billId);
        for (const p of db.purchases) if (p.bill_id === billId) p.bill_id = null; // generated purchases stay
      });
    },

    async setBillAmount(billId, month, amount) {
      const id = uid();
      if (!billMonthSchema.safeParse(month).success || !tengeSchema.safeParse(amount).success) throw new RepoError("invalid", "Invalid input");
      return tx((db) => {
        const bill = db.bills.find((b) => b.id === billId);
        if (!bill || !isMember(db, bill.household_id, id)) throw new RepoError("not_found", "Bill not found");
        if (bill.payer_id !== id && !isAdmin(db, bill.household_id, id)) throw new RepoError("forbidden", "Payer or admin only");
        const today = almatyDay(now());
        if (!bill.variable || month > today.month || (month === today.month && today.day < bill.day_of_month)) {
          throw new RepoError("invalid", "This bill cannot take an amount now");
        }
        const created = createBillPurchase(db, bill, month, amount);
        if (!created) throw new RepoError("invalid", "The bill cannot be split now");
        bill.last_generated_month = [bill.last_generated_month ?? "", month].sort().at(-1) ?? month;
        return created;
      });
    },

    async runMonthlyBills(secret): Promise<MonthlyRun> {
      requireSecret(secret);
      return tx((db) => {
        const today = almatyDay(now());
        let created = 0;
        const notices: BillNotice[] = [];
        const due = db.bills
          .filter((b) => b.day_of_month <= today.day && (b.last_generated_month === null || b.last_generated_month < today.month))
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const bill of due) {
          if (bill.variable) {
            notices.push({ to_user: bill.payer_id, bill_id: bill.id, title: bill.title, month: today.month, subscriptions: subscriptionsOf(db, bill.payer_id) });
          } else if (bill.amount !== null) {
            if (createBillPurchase(db, bill, today.month, bill.amount)) created++;
            bill.last_generated_month = today.month;
          }
        }
        return { created, notices };
      });
    },

    async setMemberRole(householdId, userId, role) {
      const id = uid();
      if (role !== "admin" && role !== "member") throw new RepoError("invalid", "Invalid role");
      await tx((db) => {
        requireAdmin(db, householdId, id);
        const m = db.members.find((x) => x.household_id === householdId && x.user_id === userId && x.active);
        if (!m) throw new RepoError("not_found", "Member not found");
        if (role === "member" && m.role === "admin") guardLastAdmin(db, householdId, userId);
        m.role = role;
      });
    },

    async removeMember(householdId, userId) {
      const id = uid();
      await tx((db) => {
        requireAdmin(db, householdId, id);
        if (userId === id) throw new RepoError("forbidden", "Use leave for yourself");
        const m = db.members.find((x) => x.household_id === householdId && x.user_id === userId && x.active);
        if (!m) throw new RepoError("not_found", "Member not found");
        if (hasOpenNet(db, householdId, userId)) throw new RepoError("not_settled", "Settle up first");
        detachMember(db, householdId, userId);
        m.active = false;
      });
    },

    async leaveHousehold(householdId) {
      const id = uid();
      await tx((db) => {
        const m = db.members.find((x) => x.household_id === householdId && x.user_id === id && x.active);
        if (!m) throw new RepoError("forbidden", "Not a member of this household");
        if (hasOpenNet(db, householdId, id)) throw new RepoError("not_settled", "Settle up first");
        if (m.role === "admin") guardLastAdmin(db, householdId, id);
        detachMember(db, householdId, id);
        m.active = false;
      });
    },

    async rotateInviteCode(householdId) {
      const id = uid();
      return tx((db) => {
        requireAdmin(db, householdId, id);
        const h = db.households.find((x) => x.id === householdId);
        if (!h) throw new RepoError("not_found", "Household not found");
        h.invite_code = randomCode();
        return structuredClone(h);
      });
    },

    async setAway(householdId, until) {
      const id = uid();
      await tx((db) => {
        const m = db.members.find((x) => x.household_id === householdId && x.user_id === id && x.active);
        if (!m) throw new RepoError("forbidden", "Not a member of this household");
        if (until !== null) {
          const today = almatyDay(now());
          const max = new Date(Date.parse(`${today.date}T00:00:00Z`) + 366 * DAY_MS).toISOString().slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < today.date || until > max) throw new RepoError("invalid", "Invalid date");
        }
        m.away_until = until;
      });
    },

    ...createMockDuty({ tx, read, uid, now, requireSecret, subscriptionsOf }),
    ...createMockPaid({ tx, uid, now, requireSecret, subscriptionsOf, markIn }),
  };
}
