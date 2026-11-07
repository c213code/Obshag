import { z } from "zod";
import type { MockDb } from "./seed";

/** Bump when the shape of MockDb changes: older saved data is then discarded and reseeded. */
export const MOCK_SCHEMA_VERSION = 5;

const uuid = z.string().min(1).max(64);
const iso = z.string().min(1).max(40);

const profile = z.object({
  id: uuid,
  display_name: z.string().max(80),
  kaspi_phone: z.string().max(20).nullable(),
  avatar_color: z.string().max(20).nullable(),
  created_at: iso,
  default_household_id: uuid.nullish(),
});
const household = z.object({
  id: uuid,
  name: z.string().max(80),
  invite_code: z.string().max(64),
  created_by: uuid,
  created_at: iso,
});
const member = z.object({
  household_id: uuid,
  user_id: uuid,
  role: z.enum(["admin", "member"]),
  active: z.boolean(),
  away_until: z.string().max(20).nullable(),
  joined_at: iso,
});
const purchase = z.object({
  id: uuid,
  household_id: uuid,
  payer_id: uuid,
  amount: z.number().int(),
  description: z.string().max(400),
  merchant: z.string().max(200).nullable(),
  source: z.enum(["apple_pay", "manual", "monthly"]),
  status: z.enum(["pending", "shared", "personal"]),
  created_at: iso,
});
const share = z.object({
  purchase_id: uuid,
  debtor_id: uuid,
  amount: z.number().int(),
  settled_at: iso.nullable(),
  settlement_id: uuid.nullable(),
});

const settlement = z.object({
  id: uuid,
  household_id: uuid,
  from_id: uuid,
  to_id: uuid,
  amount: z.number().int(),
  status: z.enum(["marked", "confirmed", "cancelled"]),
  marked_at: iso,
  confirmed_at: iso.nullable(),
  covered: z.array(z.object({ purchase_id: uuid, debtor_id: uuid, amount: z.number().int() })).max(2000),
});

export const mockDbSchema = z.object({
  users: z.array(z.object({ id: uuid, email: z.string().max(200), password: z.string().max(200) })).max(500),
  profiles: z.array(profile).max(500),
  households: z.array(household).max(500),
  members: z.array(member).max(2000),
  purchases: z.array(purchase).max(5000),
  shares: z.array(share).max(20000),
  settlements: z.array(settlement).max(5000),
  joinAttempts: z.array(z.object({ user_id: uuid, at: iso })).max(5000),
  settlementOps: z.array(z.object({ user_id: uuid, at: iso })).max(5000),
  captureTokens: z
    .array(z.object({ user_id: uuid, token_hash: z.string().max(100), created_at: iso, last_used_at: iso.nullable() }))
    .max(500),
  pushSubscriptions: z
    .array(z.object({ user_id: uuid, endpoint: z.string().max(2100), p256dh: z.string().max(300), auth: z.string().max(300), created_at: iso }))
    .max(2000),
  captureOps: z.array(z.object({ user_id: uuid, at: iso })).max(5000),
});

/** What is persisted (localStorage and the E2E store route): the db plus a revision counter for conflict checks. */
export const storedMockSchema = z.object({
  version: z.literal(MOCK_SCHEMA_VERSION),
  rev: z.number().int().min(0),
  db: mockDbSchema,
});

export type StoredMock = { rev: number; db: MockDb };

/** Someone else saved since this copy was loaded; the caller re-reads and tries again. */
export class MockConflictError extends Error {
  constructor() {
    super("mock store changed concurrently");
    this.name = "MockConflictError";
  }
}

/** Where the mock "database" lives: memory (tests), localStorage (browser) or the E2E server route. */
export type MockStorage = {
  load(): Promise<StoredMock | null>;
  /** Saves `db` if the stored revision still equals `baseRev` (0 when nothing is stored), else throws MockConflictError. */
  save(db: MockDb, baseRev: number): Promise<void>;
};

/** Validates untrusted JSON (localStorage, request body); null on any mismatch so the caller can reseed. */
export function parseStored(json: unknown): StoredMock | null {
  const parsed = storedMockSchema.safeParse(json);
  return parsed.success ? { rev: parsed.data.rev, db: parsed.data.db as MockDb } : null;
}
