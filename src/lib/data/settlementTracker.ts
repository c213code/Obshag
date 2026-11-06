import type { Settlement } from "./types";

const newestFirst = (a: Settlement, b: Settlement) => b.marked_at.localeCompare(a.marked_at) || a.id.localeCompare(b.id);

/** An optimistic change that nobody resolved for this long is dropped: the screen shows the server's rows again. */
export const OVERRIDE_TTL_MS = 30_000;

type Entry = { row: Settlement; at: number };

/**
 * This device's own settlement changes (optimistic UI), merged into every list a load brings back, so a load that
 * started before the tap cannot wipe or revert them.
 *
 *  - `begin`: a temporary `marked` row that exists only on this device until the server answers.
 *  - `resolve`: the server accepted it; the real row takes the temp row's place.
 *  - `patch`: an optimistic status change of a known row (confirm or cancel).
 *  - `release`: the change failed (or is over): the list shows the server's truth again.
 *
 * Callers must feed `view` the last SERVER list, never a previous view. As a second line of defence, optimistic rows
 * that were released or resolved are also stripped from the list passed in, so a chained view cannot resurrect them.
 * An override disappears by itself as soon as a list agrees with it, or after OVERRIDE_TTL_MS.
 */
export class SettlementTracker {
  private readonly overrides = new Map<string, Entry>();
  /** Temporary ids that are over (resolved or failed): never rendered again. */
  private readonly retired = new Set<string>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = OVERRIDE_TTL_MS,
  ) {}

  clear(): void {
    this.overrides.clear();
    this.retired.clear();
  }

  begin(temp: Settlement): void {
    this.overrides.set(temp.id, { row: temp, at: this.now() });
  }

  resolve(tempId: string, real: Settlement): void {
    this.overrides.delete(tempId);
    this.retired.add(tempId);
    this.overrides.set(real.id, { row: real, at: this.now() });
  }

  patch(row: Settlement): void {
    this.overrides.set(row.id, { row, at: this.now() });
  }

  release(id: string): void {
    this.overrides.delete(id);
    this.retired.add(id);
  }

  private prune(): void {
    const t = this.now();
    for (const [id, e] of [...this.overrides]) if (t - e.at > this.ttlMs) this.overrides.delete(id);
  }

  /** Rows this device changed to `confirmed` that no list has caught up with yet (their shares must show as settled too). */
  locallyConfirmed(): Settlement[] {
    this.prune();
    return [...this.overrides.values()].map((e) => e.row).filter((s) => s.status === "confirmed");
  }

  view(householdId: string, list: ReadonlyArray<Settlement>): Settlement[] {
    this.prune();
    const rows = new Map<string, Settlement>();
    for (const s of list) if (!(this.retired.has(s.id) && s.id.startsWith("optimistic-"))) rows.set(s.id, s);
    for (const [id, { row: local }] of [...this.overrides]) {
      if (local.household_id !== householdId) continue;
      const known = rows.get(id);
      if (known && known.status === local.status && !id.startsWith("optimistic-")) {
        this.overrides.delete(id); // the server agrees now
        continue;
      }
      rows.set(id, local);
    }
    return [...rows.values()].sort(newestFirst);
  }
}
