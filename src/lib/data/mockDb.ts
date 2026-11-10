import { z } from "zod";
import type { MockDb } from "./seed";

/** Bump when the shape of MockDb changes: older saved data is then discarded and reseeded. */
export const MOCK_SCHEMA_VERSION = 7;

const uuid = z.string().min(1).max(64);
const iso = z.string().min(1).max(40);

const profile = z.object({
  id: uuid,
  display_name: z.string().max(80),
  kaspi_phone: z.string().max(20).nullable(),
  avatar_color: z.string().max(20).nullable(),
  created_at: iso,
  default_household_id: uuid.nullish(),
  telegram_username: z.string().max(40).nullish(),
  telegram_user_id: z.number().int().positive().nullish(),
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
  reminders_enabled: z.boolean().optional(),
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
  bill_id: uuid.nullish(),
  bill_month: z.string().max(10).nullish(),
});
const bill = z.object({
  id: uuid,
  household_id: uuid,
  title: z.string().max(80),
  icon: z.string().max(20),
  amount: z.number().int().nullable(),
  variable: z.boolean(),
  day_of_month: z.number().int(),
  payer_id: uuid,
  last_generated_month: z.string().max(10).nullable(),
  participants: z.array(uuid).max(50),
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
  kind: z.enum(["transfer", "writeoff"]).optional(),
  covered: z.array(z.object({ purchase_id: uuid, debtor_id: uuid, amount: z.number().int() })).max(2000),
});

const duty = z.object({
  id: uuid,
  household_id: uuid,
  kind: z.enum(["cooking", "trash", "water", "custom"]),
  title: z.string().max(40),
  start_date: z.string().max(10),
  active: z.boolean(),
  order: z.array(uuid).max(20),
  price_per_liter: z.number().int().optional(),
  bottle_liters: z.number().int().optional(),
  bottles_total: z.number().int().optional(),
  bottles_full: z.number().int().optional(),
});
const dutyEvent = z.object({
  id: uuid,
  duty_id: uuid,
  kind: z.enum(["done", "ping", "empty"]),
  user_id: uuid,
  partner_id: uuid.nullable(),
  liters: z.number().int().nullable(),
  purchase_id: uuid.nullable(),
  created_at: iso,
});
const swapRequest = z.object({
  id: uuid,
  duty_id: uuid,
  from_user: uuid,
  from_day: z.string().max(10),
  to_user: uuid,
  to_day: z.string().max(10),
  reason: z.string().max(140).nullable(),
  status: z.enum(["pending", "accepted", "declined", "cancelled", "expired"]),
  expires_at: iso,
  created_at: iso,
  decided_at: iso.nullable(),
});

const paidPrompt = z.object({
  id: uuid,
  household_id: uuid,
  from_user: uuid,
  to_user: uuid,
  amount: z.number().int().positive(),
  opened_at: iso,
  status: z.enum(["pending", "yes", "no", "expired"]),
  asked_at: iso.nullable(),
});

export const mockDbSchema = z.object({
  users: z.array(z.object({ id: uuid, email: z.string().max(200), password: z.string().max(200) })).max(500),
  profiles: z.array(profile).max(500),
  households: z.array(household).max(500),
  members: z.array(member).max(2000),
  purchases: z.array(purchase).max(5000),
  shares: z.array(share).max(20000),
  settlements: z.array(settlement).max(5000),
  bills: z.array(bill).max(500),
  joinAttempts: z.array(z.object({ user_id: uuid, at: iso })).max(5000),
  settlementOps: z.array(z.object({ user_id: uuid, at: iso })).max(5000),
  captureTokens: z
    .array(z.object({ user_id: uuid, token_hash: z.string().max(100), created_at: iso, last_used_at: iso.nullable() }))
    .max(500),
  pushSubscriptions: z
    .array(z.object({ user_id: uuid, endpoint: z.string().max(2100), p256dh: z.string().max(300), auth: z.string().max(300), created_at: iso }))
    .max(2000),
  captureOps: z.array(z.object({ user_id: uuid, at: iso })).max(5000),
  reminderLog: z.array(z.object({ from_id: uuid, to_id: uuid, at: iso })).max(5000),
  telegramCodes: z.array(z.object({ code_hash: z.string().max(100), user_id: uuid, expires_at: iso })).max(500).optional(),
  digestLog: z.array(z.object({ purchase_id: uuid, sent_on: z.string().max(10) })).max(5000).optional(),
  duties: z.array(duty).max(100).optional(),
  dutyOverrides: z
    .array(z.object({ duty_id: uuid, day: z.string().max(10), user_id: uuid, source: z.enum(["swap", "admin"]), reason: z.string().max(140).nullable() }))
    .max(5000)
    .optional(),
  dutyDone: z.array(z.object({ duty_id: uuid, day: z.string().max(10), user_id: uuid, done_at: iso })).max(5000).optional(),
  swapRequests: z.array(swapRequest).max(5000).optional(),
  dutyEvents: z.array(dutyEvent).max(5000).optional(),
  dutyMorningLog: z.array(z.object({ duty_id: uuid, day: z.string().max(10) })).max(5000).optional(),
  paidPrompts: z.array(paidPrompt).max(5000).optional(),
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
