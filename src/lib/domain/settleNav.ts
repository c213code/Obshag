import type { Counterparty, UserNet } from "./netting";

/**
 * Navigation rules of /settle and /settle/[userId]. They live here, pure, so the two screens cannot disagree and send
 * the user back and forth (a neighbour who left used to bounce between the list and their own screen forever).
 */

/**
 * The one neighbour /settle should open straight away, or null. Neighbours who left are never a target, and neither is
 * someone who owes ME: the list carries their «Напомнить» pill, so it stays.
 */
export function listRedirect(net: UserNet, isMember: (userId: string) => boolean): string | null {
  const [only] = net.counterparties;
  return net.counterparties.length === 1 && only.active && only.direction === "i_pay" && isMember(only.userId) ? only.userId : null;
}

export type PairScreenState = "ready" | "departed" | "unknown";

/**
 * What /settle/[userId] shows. `departed` = the person left but still has a debt with me: the screen explains it and stays.
 * `unknown` = not a neighbour and no debt either (or myself): back to the list, which never points back here.
 */
export function pairScreenState(
  userId: string,
  meId: string,
  net: UserNet,
  isMember: (userId: string) => boolean,
): PairScreenState {
  if (userId === meId) return "unknown";
  if (isMember(userId)) return "ready";
  return net.counterparties.some((c: Counterparty) => c.userId === userId && !c.active) ? "departed" : "unknown";
}
