/** One debtor's slice of a purchase. The payer's own slice is flagged `settled` (nobody owes themselves). */
export type SplitShare = { debtor_id: string; amount: number; settled: boolean };

/**
 * Equal split, exactly SDD §7 (and the SQL in `create_purchase_with_shares`, which must stay in sync):
 *  - base = floor(amount / N)
 *  - the remainder is added 1 tenge at a time to NON-payers, in the given participant order
 *  - the payer's own share is returned flagged as settled
 *
 * The payer does not have to be a participant (they paid for others): then everyone listed owes.
 * Output order = participant order. Throws RangeError on an invalid amount, an empty list or duplicates.
 */
export function splitEqual(amount: number, participantIds: ReadonlyArray<string>, payerId: string): SplitShare[] {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError("amount must be a positive integer");
  const n = participantIds.length;
  if (n < 1) throw new RangeError("at least one participant is required");
  if (new Set(participantIds).size !== n) throw new RangeError("participants must be unique");

  const base = Math.floor(amount / n);
  let remainder = amount - base * n;
  return participantIds.map((debtor_id) => {
    const isPayer = debtor_id === payerId;
    const extra = !isPayer && remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { debtor_id, amount: base + extra, settled: isPayer };
  });
}

/** Display helper: the per-person amount range for the "по X ₸" label. */
export function perPersonRange(amount: number, n: number): { min: number; max: number } {
  if (!Number.isInteger(amount) || amount <= 0 || n < 1) return { min: 0, max: 0 };
  const min = Math.floor(amount / n);
  return { min, max: amount % n === 0 ? min : min + 1 };
}
