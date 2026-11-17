import { isTransferable } from "./minTransfer";
import type { Counterparty } from "./netting";

/**
 * Slice 27: the one number on Главная's hero card. Only payable pairs count — a net of 100 ₸ and up (the Kaspi minimum)
 * with someone still in the household. Smaller nets are simply not shown on home.
 *   owe  — I owe anyone: the sum of what I owe;
 *   owed — else they owe me: the sum owed to me;
 *   even — nothing payable either way.
 */
export type HeroState = { kind: "owe"; amount: number } | { kind: "owed"; amount: number } | { kind: "even" };

type Pair = Pick<Counterparty, "userId" | "net" | "direction" | "active">;

/** The pairs Главная shows: still in the household and at least the Kaspi minimum. */
export function payablePairs<P extends Pair>(counterparties: ReadonlyArray<P>): P[] {
  return counterparties.filter((c) => c.active && isTransferable(c.net));
}

export function heroState(counterparties: ReadonlyArray<Pair>): HeroState {
  const payable = payablePairs(counterparties);
  const sum = (direction: Pair["direction"]) => payable.filter((c) => c.direction === direction).reduce((s, c) => s + c.net, 0);
  const owe = sum("i_pay");
  if (owe > 0) return { kind: "owe", amount: owe };
  const owed = sum("they_pay");
  if (owed > 0) return { kind: "owed", amount: owed };
  return { kind: "even" };
}

/** Where «Оплатить» goes straight away: the one person I owe a payable net, or null (several: the «К оплате» list). */
export function payTarget(counterparties: ReadonlyArray<Pair>): string | null {
  const owe = payablePairs(counterparties).filter((c) => c.direction === "i_pay");
  return owe.length === 1 ? owe[0].userId : null;
}
