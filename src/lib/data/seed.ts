import type { Bill, Duty, DutyEvent, Household, Member, Profile, PaidPrompt, PayLink, Purchase, PurchaseOrder, Settlement, Share, SwapRequest } from "./types";

export const ME_ID = "00000000-0000-4000-8000-000000000001";
export const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";
export const SEED_EMAIL = "erasyl@obshak.test";
/** In mock/E2E mode every seeded user has this password. */
export const SEED_PASSWORD = "password123";

/** Mock only (never reached in production builds): the "password" is stored as is. */
export type MockUser = { id: string; email: string; password: string };

/** Everything the mock "backend" stores. Plain JSON so it survives localStorage and the E2E store route. */
export type MockDb = {
  users: MockUser[];
  profiles: Profile[];
  households: Household[];
  members: Member[];
  purchases: Purchase[];
  shares: Share[];
  settlements: Settlement[];
  bills: Bill[];
  /** join_household attempts (rate limit: 10 per user per hour). */
  joinAttempts: Array<{ user_id: string; at: string }>;
  /** mark/cancel calls (rate limit: 20 per user per hour). */
  settlementOps: Array<{ user_id: string; at: string }>;
  /** capture tokens: only the sha256 hex hash is stored (SQL capture_tokens). */
  captureTokens: Array<{ user_id: string; token_hash: string; created_at: string; last_used_at: string | null }>;
  pushSubscriptions: Array<{ user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string }>;
  /** successful captures (rate limit: 30 per user per hour). */
  captureOps: Array<{ user_id: string; at: string }>;
  /** reminders sent (SQL reminder_log): from = creditor, to = debtor; 6h cooldown per pair. */
  reminderLog: Array<{ from_id: string; to_id: string; at: string }>;
  /** Telegram link codes (SQL private.telegram_link_codes): only the sha256 hex hash is stored. */
  telegramCodes?: Array<{ code_hash: string; user_id: string; expires_at: string }>;
  /** Digest log (SQL private.pending_digest_log): one row per purchase and Almaty day. */
  digestLog?: Array<{ purchase_id: string; sent_on: string }>;
  /** «Очередь» (SQL duties + duty_members): the rotation lives in `order`. */
  duties?: Duty[];
  dutyOverrides?: Array<{ duty_id: string; day: string; user_id: string; source: "swap" | "admin"; reason: string | null }>;
  dutyDone?: Array<{ duty_id: string; day: string; user_id: string; done_at: string }>;
  swapRequests?: SwapRequest[];
  /** duty_events (Мусор / Вода) */
  dutyEvents?: DutyEvent[];
  /** private.duty_morning_log */
  dutyMorningLog?: Array<{ duty_id: string; day: string }>;
  /** public.paid_prompts («Ты перевёл?») */
  paidPrompts?: PaidPrompt[];
  /** public.pay_links («💸 Перевести» under the Telegram reminder) */
  payLinks?: PayLink[];
  /** public.purchase_orders («+ Заказ») */
  purchaseOrders?: PurchaseOrder[];
};

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12)).toISOString();

/** The demo household: Ерасыл (log in with SEED_EMAIL) plus three housemates. */
export function createSeed(): MockDb {
  const person = (n: number, name: string, color: string, phone: string | null): Profile => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    display_name: name,
    kaspi_phone: phone,
    avatar_color: color,
    created_at: day(1),
  });
  const me = person(1, "Ерасыл", "me", "+77010000001");
  const aidos = person(2, "Айдос", "blue", "+77010000002");
  const danya = person(3, "Даня", "brown", "+77010000003");
  const nurik = person(4, "Нурик", "purple", null);
  const profiles = [me, aidos, danya, nurik];

  const household: Household = {
    id: HOUSEHOLD_ID,
    name: "Квартира 42",
    invite_code: "KV42AB7K9M3X",
    created_by: me.id,
    created_at: day(1),
  };
  const members: Member[] = profiles.map((p, i) => ({
    household_id: household.id,
    user_id: p.id,
    role: i === 0 ? "admin" : "member",
    active: true,
    away_until: null,
    joined_at: day(1),
  }));

  const purchases: Purchase[] = [
    {
      id: "20000000-0000-4000-8000-000000000001",
      household_id: household.id,
      payer_id: me.id,
      amount: 6000,
      description: "Продукты",
      merchant: "Magnum",
      source: "apple_pay",
      status: "shared",
      created_at: day(3),
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      household_id: household.id,
      payer_id: aidos.id,
      amount: 2000,
      description: "Вода",
      merchant: null,
      source: "manual",
      status: "shared",
      created_at: day(4),
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
      household_id: household.id,
      payer_id: danya.id,
      amount: 900,
      description: "Личное",
      merchant: null,
      source: "manual",
      status: "personal",
      created_at: day(5),
    },
  ];

  const open = (purchase_id: string, debtor_id: string, amount: number): Share => ({
    purchase_id,
    debtor_id,
    amount,
    settled_at: null,
    settlement_id: null,
  });
  const shares: Share[] = [
    { ...open(purchases[0].id, me.id, 1500), settled_at: purchases[0].created_at },
    ...[aidos, danya, nurik].map((p) => open(purchases[0].id, p.id, 1500)),
    { ...open(purchases[1].id, aidos.id, 500), settled_at: purchases[1].created_at },
    ...[me, danya, nurik].map((p) => open(purchases[1].id, p.id, 500)),
  ];

  const users: MockUser[] = [
    { id: me.id, email: SEED_EMAIL, password: SEED_PASSWORD },
    { id: aidos.id, email: "aidos@obshak.test", password: SEED_PASSWORD },
    { id: danya.id, email: "danya@obshak.test", password: SEED_PASSWORD },
    { id: nurik.id, email: "nurik@obshak.test", password: SEED_PASSWORD },
  ];

  return {
    users,
    profiles,
    households: [household],
    members,
    purchases,
    shares,
    settlements: [],
    bills: [],
    joinAttempts: [],
    settlementOps: [],
    captureTokens: [],
    pushSubscriptions: [],
    captureOps: [],
    reminderLog: [],
  };
}
