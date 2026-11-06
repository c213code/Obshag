import { pickAvatarColor } from "@/lib/domain/avatar";
import { newId } from "@/lib/domain/uuid";
import {
  createPurchaseSchema,
  emailSchema,
  householdNameSchema,
  inviteCodeSchema,
  otpSchema,
  profileSchema,
} from "@/lib/domain/schemas";
import { splitEqual } from "@/lib/domain/split";
import {
  RepoError,
  type AuthSession,
  type MemberWithProfile,
  type NewPurchase,
  type ProfileDraft,
  type PurchaseWithShares,
  type Repo,
} from "./repo";
import { MockConflictError, type MockStorage, type StoredMock } from "./mockDb";
import { MOCK_OTP, createSeed, type MockDb } from "./seed";
import type { Household, Profile, Purchase, Share, Uuid } from "./types";

/** Which mock user is signed in on THIS device (never shared, like a browser cookie). */
export type SessionStore = { get(): Uuid | null; set(userId: Uuid | null): void };

export type MockRepoOptions = {
  storage?: MockStorage;
  session?: SessionStore;
  /** Test seam for the join rate limit. */
  now?: () => Date;
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
const HOUR_MS = 60 * 60 * 1000;
const MAX_RETRIES = 8;

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
  const withShares = (db: MockDb, p: Purchase): PurchaseWithShares =>
    structuredClone({ ...p, shares: db.shares.filter((s) => s.purchase_id === p.id) });

  return {
    async getSession() {
      const id = session.get();
      if (!id) return null;
      return read((db) => {
        const u = db.users.find((x) => x.id === id);
        return u ? { user_id: u.id, email: u.email } : null;
      });
    },

    async requestOtp(email) {
      const parsed = emailSchema.safeParse(email);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      // mock mode: nothing is sent
    },

    async verifyOtp(email, code): Promise<AuthSession> {
      const e = emailSchema.safeParse(email);
      const c = otpSchema.safeParse(code);
      if (!e.success || !c.success || c.data !== MOCK_OTP) throw new RepoError("otp_failed", "Invalid code");
      const user = await tx((db) => {
        let u = db.users.find((x) => x.email === e.data);
        if (!u) {
          u = { id: newId(), email: e.data };
          db.users.push(u);
        }
        return u;
      });
      session.set(user.id);
      return { user_id: user.id, email: user.email };
    },

    async signOut() {
      session.set(null);
    },

    async getMe() {
      const id = uid();
      return read((db) => structuredClone(profileOf(db, id) ?? null));
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
          .filter((p) => p.status !== "personal" || p.payer_id === id)
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
  };
}
