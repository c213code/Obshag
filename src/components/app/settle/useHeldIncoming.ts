"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Incoming } from "./useSettleData";

/** How long a confirmed row stays on screen so the ✓ animation of reference #4 can be seen (shrink 0.5s + check 0.55s). */
export const HOLD_MS = 1400;

/**
 * After «Получил» the confirmation is applied at once (optimistic), which would drop the row from the live list
 * before its animation is seen. This keeps tapped rows around for HOLD_MS, flagged `received`.
 */
export function useHeldIncoming<T = undefined>(live: ReadonlyArray<Incoming>) {
  const [held, setHeld] = useState<ReadonlyMap<string, { row: Incoming; snapshot: T | undefined }>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const all = timers.current;
    return () => {
      all.forEach(clearTimeout);
      all.clear();
    };
  }, []);

  const heldIds = useRef(new Set<string>());

  const drop = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    heldIds.current.delete(id);
    setHeld((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  /** Returns false when this row is already held (a double tap): the caller must not confirm twice. */
  const hold = useCallback((row: Incoming, snapshot?: T): boolean => {
    const id = row.settlement.id;
    if (heldIds.current.has(id)) return false;
    heldIds.current.add(id);
    setHeld((m) => new Map(m).set(id, { row, snapshot }));
    timers.current.set(id, setTimeout(() => drop(id), HOLD_MS));
    return true;
  }, [drop]);

  /** The confirmation failed: stop holding the row so it falls back to what the server says (the ✓ plays backwards). */
  const release = useCallback((id: string) => drop(id), [drop]);

  const liveIds = new Set(live.map((r) => r.settlement.id));
  const rows: Array<Incoming & { received: boolean }> = [
    ...live.map((r) => ({ ...(held.get(r.settlement.id)?.row ?? r), received: held.has(r.settlement.id) })),
    ...[...held.values()].filter((h) => !liveIds.has(h.row.settlement.id)).map((h) => ({ ...h.row, received: true })),
  ].sort((a, b) => a.settlement.marked_at.localeCompare(b.settlement.marked_at) || a.settlement.id.localeCompare(b.settlement.id));

  /** What the caller passed to `hold` for the first row still held (e.g. the numbers on screen when the button was pressed). */
  const snapshot = [...held.values()][0]?.snapshot ?? null;
  return { rows, hold, release, snapshot, holding: held.size > 0 };
}
