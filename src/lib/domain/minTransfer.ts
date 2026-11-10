/** Kaspi cannot transfer less than this many tenge. Mirrors `private.min_transfer()` in supabase/migrations/0011. */
export const MIN_TRANSFER = 100;

/** A debt between 1 and 99 ₸: nobody can transfer it, so it accumulates (or the creditor writes it off). */
export function isAccumulating(net: number): boolean {
  return Number.isFinite(net) && net > 0 && net < MIN_TRANSFER;
}

/** A debt Kaspi can transfer: remind, mark as paid and the Kaspi button are for these only. */
export function isTransferable(net: number): boolean {
  return Number.isFinite(net) && net >= MIN_TRANSFER;
}
