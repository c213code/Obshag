/** Types mirroring SDD §8. Money is integer tenge. Timestamps are ISO strings. */

export type Uuid = string;
export type IsoDateTime = string;
export type IsoDate = string;

export type Role = "admin" | "member";
export type PurchaseSource = "apple_pay" | "manual" | "monthly";
export type PurchaseStatus = "pending" | "shared" | "personal";
export type SettlementStatus = "marked" | "confirmed" | "cancelled";
/** `writeoff` = the creditor closed a debt under the Kaspi minimum without a transfer. Rows that predate slice 13 have no kind (= transfer). */
export type SettlementKind = "transfer" | "writeoff";

export type Profile = {
  id: Uuid;
  display_name: string;
  kaspi_phone: string | null;
  /** Telegram handle without the @ (the group bot tags it); null = not set. */
  telegram_username?: string | null;
  /** Database row only; getMe replaces it with `telegram_linked` so the chat id never reaches the UI. */
  telegram_user_id?: number | null;
  /** The signed-in user's Telegram DM is linked (set by getMe). */
  telegram_linked?: boolean;
  avatar_color: string | null;
  created_at: IsoDateTime;
  /** Where Apple Pay captures land; null = the most recently joined active household. */
  default_household_id?: Uuid | null;
};

/** A device's Web Push subscription (table push_subscriptions). */
export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** What the capture RPC returns: the new pending purchase plus the owner's push subscriptions. */
export type CaptureChoice = "shared" | "personal";

export type CaptureResult = {
  /** pending unless the Shortcut sent a choice (then the purchase is already shared / personal and no push goes out). */
  status: "pending" | "shared" | "personal";
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

/** One payer's slice of the 19:00 digest (run_pending_digest): who to push, whom to DM, and what is waiting. */
export type PendingDigestUser = {
  user_id: Uuid;
  telegram_user_id: number | null;
  subscriptions: PushSubscriptionInput[];
  purchases: Array<{ id: Uuid; merchant: string | null; amount: number; created_at: IsoDateTime }>;
};

/** tg_resolve_pending: what happened to the purchase. */
export type TgResolveResult = "shared" | "personal" | "already_resolved" | "too_small";

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

/** A personal order inside a shared purchase (table purchase_orders): `user_id` owes `amount` on top of the equal part. */
export type PurchaseOrder = {
  purchase_id: Uuid;
  user_id: Uuid;
  amount: number;
  note: string | null;
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
  kind?: SettlementKind;
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

export type BillIcon = "home" | "internet" | "gas" | "utility" | "receipt";

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

// ---------------------------------------------------------------- «Очередь» (slice 14)

export type DutyKind = "cooking" | "trash" | "water" | "custom";

/** A duty of a household with its rotation (`order` = member user ids, first = start_date's cook). */
export type Duty = {
  id: Uuid;
  household_id: Uuid;
  kind: DutyKind;
  title: string;
  start_date: IsoDate;
  active: boolean;
  order: Uuid[];
  /** Вода only (slice 15): price of a liter, litres per bottle, bottles in the stock, bottles still full. */
  price_per_liter?: number;
  bottle_liters?: number;
  bottles_total?: number;
  bottles_full?: number;
};

export type DutyEventKind = "done" | "ping" | "empty";

/**
 * One fact of an event duty (Мусор / Вода). `partner_id`: the second carrier of a water trip on `done`; the person who
 * was current (and got the push) on `ping` / `empty`.
 */
export type DutyEvent = {
  id: Uuid;
  duty_id: Uuid;
  kind: DutyEventKind;
  user_id: Uuid;
  partner_id: Uuid | null;
  liters: number | null;
  purchase_id: Uuid | null;
  created_at: IsoDateTime;
};

/** Who to push after a ping / «вода кончилась» (duty_event_notice); never reaches a browser. */
export type DutyEventNotice = {
  event_id: Uuid;
  kind: "ping" | "empty";
  title: string;
  target_user: Uuid | null;
  /** The target is the caller: nobody to push. */
  self: boolean;
  actor_name: string;
  subscriptions: PushSubscriptionInput[];
};

export type DutySource = "rotation" | "swap" | "admin" | "skip";

/** One day of the plan (duty_schedule). `skipped_user` = who it would have been if they had not been away. */
export type DutyDay = {
  day: IsoDate;
  user_id: Uuid;
  source: DutySource;
  done: boolean;
  /** A still-pending swap request that touches this day. */
  request_id: Uuid | null;
  skipped_user: Uuid | null;
};

export type SwapStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export type SwapRequest = {
  id: Uuid;
  duty_id: Uuid;
  from_user: Uuid;
  from_day: IsoDate;
  to_user: Uuid;
  to_day: IsoDate;
  reason: string | null;
  status: SwapStatus;
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
  decided_at: IsoDateTime | null;
};

/** The payload for one push / Telegram DM about a swap (swap_notice, tg_respond_swap). */
export type DutyNotice = {
  request_id: Uuid;
  target_user: Uuid;
  subscriptions: PushSubscriptionInput[];
  telegram_user_id: number | null;
  from_name: string;
  to_name: string;
  from_day: IsoDate;
  to_day: IsoDate;
  from_label: string;
  to_label: string;
  reason: string | null;
};

export type DutyNoticeEvent = "requested" | "declined";

export type TgSwapResult = { result: "accepted" | "declined" | "expired" | "stale"; notice: DutyNotice | null };

/** One duty of the 09:00 run (run_duty_morning): today's and tomorrow's cook, today's devices and the group chat. */
export type DutyMorningItem = {
  duty_id: Uuid;
  household_id: Uuid;
  kind: DutyKind;
  title: string;
  telegram_chat_id: number | null;
  today_user: Uuid;
  today_name: string;
  tomorrow_user: Uuid | null;
  tomorrow_name: string | null;
  subscriptions: PushSubscriptionInput[];
};

export type NewDuty = { household_id: Uuid; kind: DutyKind; title: string; start_date?: IsoDate | null; order?: Uuid[] | null };

// ---- «Ты перевёл?» (slice 17)
export type PaidPromptStatus = "pending" | "yes" | "no" | "expired";

/** One «opened Kaspi» of the debtor. Visible to its from_user only. */
export type PaidPrompt = {
  id: Uuid;
  household_id: Uuid;
  from_user: Uuid;
  to_user: Uuid;
  amount: number;
  opened_at: IsoDateTime;
  status: PaidPromptStatus;
  asked_at: IsoDateTime | null;
};

/** What the answer did: marked = a settlement now waits for the creditor; no = «Ещё нет». */
export type PaidAnswer = "marked" | "no" | "already" | "expired" | "stale" | "too_small";
export type PaidAnswerResult = { result: PaidAnswer; to_name: string };

/** paid_prompt_notice: ask = false means nothing to send (answered, expired, already asked, or opened again meanwhile). */
export type PaidPromptNotice =
  | { ask: false }
  | {
      ask: true;
      prompt_id: Uuid;
      household_id: Uuid;
      to_user: Uuid;
      to_name: string;
      to_username: string | null;
      amount: number;
      telegram_user_id: number | null;
      subscriptions: PushSubscriptionInput[];
    };
