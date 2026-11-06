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
  avatar_color: string | null;
  created_at: IsoDateTime;
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
};

export type Share = {
  purchase_id: Uuid;
  debtor_id: Uuid;
  amount: number;
  settled_at: IsoDateTime | null;
  settlement_id: Uuid | null;
};

export type Settlement = {
  id: Uuid;
  household_id: Uuid;
  from_id: Uuid;
  to_id: Uuid;
  amount: number;
  status: SettlementStatus;
  marked_at: IsoDateTime;
  confirmed_at: IsoDateTime | null;
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
};
