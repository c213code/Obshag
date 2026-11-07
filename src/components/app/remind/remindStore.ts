import { COOLDOWN_SECONDS } from "@/lib/remindClient";

/** What a «Напомнить» button shows for one (household, debtor) pair. */
export type RemindEntry =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "cooldown"; seconds: number };

export const IDLE: RemindEntry = { kind: "idle" };
const SENT_MS = 2200;

const entries = new Map<string, RemindEntry>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const remindKey = (householdId: string, debtorId: string) => `${householdId}:${debtorId}`;

function put(key: string, entry: RemindEntry) {
  entries.set(key, entry);
  for (const l of listeners) l();
}

export const subscribeRemind = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const getRemind = (key: string): RemindEntry => entries.get(key) ?? IDLE;

export const remindServerSnapshot = (): RemindEntry => IDLE;

export function setSending(key: string) {
  put(key, { kind: "sending" });
}
/** «Напомнили» for a moment, then the pair sits in the 6 hour cooldown. */
export function setSent(key: string) {
  put(key, { kind: "sent" });
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => put(key, { kind: "cooldown", seconds: COOLDOWN_SECONDS }), SENT_MS),
  );
}
export function setCooldown(key: string, seconds: number) {
  clearTimeout(timers.get(key));
  put(key, { kind: "cooldown", seconds });
}
export function setIdle(key: string) {
  put(key, IDLE);
}
/** Sign-out and tests: forget every pair. */
export function resetRemind() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  entries.clear();
  for (const l of listeners) l();
}
