/** Types mirroring SDD §8. Money is integer tenge. Timestamps are ISO strings. */

export type Uuid = string;
export type IsoDateTime = string;
export type IsoDate = string;

export type Role = "admin" | "member";
export type PurchaseSource = "apple_pay" | "manual" | "monthly";
export type PurchaseStatus = "pending" | "shared" | "personal";
export type SettlementStatus = "marked" | "confirmed" | "cancelled";

export type Profile = {
  id: Uuid;
  display_name: string;
  kaspi_phone: string | null;
  /** Telegram handle without the @ (the group bot tags it); null = not set. */
  telegram_username?: string | null;
  avatar_color: string | null;
  created_at: IsoDateTime;
  /** Where Apple Pay captures land; null = the most recently joined active household. */
  default_household_id?: Uuid | null;
};

/** A device's Web Push subscription (table push_subscriptions). */
export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** What the capture RPC returns: the new pending purchase plus the owner's push subscriptions. */
export type CaptureResult = {
  purchase_id: Uuid;
  household_id: Uuid;
  amount: number;
  merchant: string | null;
  subscriptions: PushSubscriptionInput[];
};

/** Whether the user has a capture token (the plaintext is never readable again). */
export type CaptureTokenInfo = { created_at: IsoDateTime; last_used_at: IsoDateTime | null };

/** What the reminder RPCs return: who to push, the text data and the recipient's devices. */
export type ReminderTarget = {
  to_user: Uuid;
  from_user: Uuid;
  /** The creditor's display name (the route puts it into the dative case). */
  from_name_dative: string;
  amount: number;
  subscriptions: PushSubscriptionInput[];
};

export type Household = {
  id: Uuid;
  name: string;
  invite_code: string;
  created_by: Uuid;
  created_at: IsoDateTime;
};

export type Member = {
  household_id: Uuid;
  user_id: Uuid;
  role: Role;
  /** Soft leave flag: ledger rows keep pointing at inactive members. */
  active: boolean;
  away_until: IsoDate | null;
  joined_at: IsoDateTime;
  /** Whether the daily 19:00 reminder may be sent to me (default true). Older mock rows may lack it. */
  reminders_enabled?: boolean;
};

export type Purchase = {
  id: Uuid;
  household_id: Uuid;
  payer_id: Uuid;
  amount: number;
  description: string;
  merchant: string | null;
  source: PurchaseSource;
  status: PurchaseStatus;
  created_at: IsoDateTime;
  /** Set on purchases generated from a monthly bill. */
  bill_id?: Uuid | null;
  bill_month?: string | null;
};

export type Share = {
  purchase_id: Uuid;
  debtor_id: Uuid;
  amount: number;
  settled_at: IsoDateTime | null;
  settlement_id: Uuid | null;
};

/** One share frozen into a settlement at mark time (table settlement_shares). */
export type SettlementShare = { purchase_id: Uuid; debtor_id: Uuid; amount: number };

export type Settlement = {
  id: Uuid;
  household_id: Uuid;
  from_id: Uuid;
  to_id: Uuid;
  amount: number;
  status: SettlementStatus;
  marked_at: IsoDateTime;
  confirmed_at: IsoDateTime | null;
  /** The exact open shares this settlement covers, recorded when it was marked. Confirming closes these and nothing else. */
  covered: SettlementShare[];
};

export type Bill = {
  id: Uuid;
  household_id: Uuid;
  title: string;
  icon: string;
  amount: number | null;
  variable: boolean;
  day_of_month: number;
  payer_id: Uuid;
  last_generated_month: string | null;
  /** Who splits it (active members at creation; leavers are removed). */
  participants: Uuid[];
};

export type BillIcon = "home" | "drop" | "wifi" | "bolt" | "other";

/** Form values of a monthly bill. `amount` is null for a variable bill. */
export type BillInput = {
  id?: Uuid | null;
  household_id: Uuid;
  title: string;
  icon: BillIcon;
  amount: number | null;
  variable: boolean;
  day_of_month: number;
  payer_id: Uuid;
  participants: Uuid[];
};

/** «Коммуналка: введи сумму за ноябрь» for the bill's payer. */
export type BillNotice = {
  to_user: Uuid;
  bill_id: Uuid;
  title: string;
  /** 'YYYY-MM' */
  month: string;
  subscriptions: PushSubscriptionInput[];
};

export type MonthlyRun = { created: number; notices: BillNotice[] };
