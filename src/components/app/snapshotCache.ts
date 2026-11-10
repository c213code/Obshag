import type { Loaded } from "./snapshot";

/** Bump when the shape of `Loaded` changes: older entries are then ignored. */
const VERSION = 1;
const PREFIX = "obshak:snapshot:";

const keyFor = (userId: string) => `${PREFIX}${userId}`;

type Stored = { v: number; data: Loaded };

/** Remembers the last good load for this user, so the next start can paint at once. Never throws (private mode, quota). */
export function saveSnapshot(userId: string, data: Loaded): void {
  try {
    const stored: Stored = { v: VERSION, data };
    localStorage.setItem(keyFor(userId), JSON.stringify(stored));
  } catch {
    // storage full or unavailable: the app just starts without the cache
  }
}

/** The cached load for this user, or null (nothing stored, other version, other user, corrupt). */
export function readSnapshot(userId: string): Loaded | null {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored> | null;
    const data = stored?.data;
    if (!stored || stored.v !== VERSION || !data || !data.me || data.me.id !== userId || data.session?.user_id !== userId) return null;
    if (!Array.isArray(data.households) || !data.members || !data.purchases || !data.settlements || !data.bills) return null;
    return data;
  } catch {
    return null;
  }
}

/** Sign-out: nothing of the previous user may be left behind. */
export function clearSnapshots(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // nothing to clear
  }
}
