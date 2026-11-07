/** Math of the «Свои суммы» form. Pure, so the bottom bar and the ✓ button cannot disagree. */

/** Digits only, at most 8 (10 000 000 is the cap); "" when nothing usable. Spaces and ₸ are ignored. */
export function sanitizeAmountText(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 8).replace(/^0+(?=\d)/, "");
}

/** "2 000" / "2000" -> 2000; "" -> 0 (an empty field is zero); anything else -> null. */
export function parseAmountText(raw: string): number | null {
  const digits = sanitizeAmountText(raw);
  return digits === "" ? 0 : Number(digits);
}

export type CustomSplit = {
  /** Sum of the amounts typed so far. */
  sum: number;
  /** total - sum: positive = still to hand out, negative = too much. */
  remaining: number;
  /** One entry per picked person, in `ids` order. */
  entries: Array<{ user_id: string; amount: number }>;
  /** Someone besides the payer is part of it. */
  hasOther: boolean;
  /** The ✓ button may be enabled: sum equals the total (> 0), someone besides the payer is in. */
  ready: boolean;
};

export function customSplit(total: number | null, ids: ReadonlyArray<string>, texts: Readonly<Record<string, string>>, payerId: string): CustomSplit {
  const entries = ids.map((user_id) => ({ user_id, amount: parseAmountText(texts[user_id] ?? "") ?? 0 }));
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  const remaining = (total ?? 0) - sum;
  const hasOther = ids.some((id) => id !== payerId);
  return { sum, remaining, entries, hasOther, ready: !!total && total > 0 && remaining === 0 && hasOther };
}
