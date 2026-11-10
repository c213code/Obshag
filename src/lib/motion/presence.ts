"use client";

import { useEffect, useState } from "react";

/**
 * Exit support without motion/react: keeps a value mounted for `exitMs` after it went away so a CSS `leave` animation
 * can play on the compositor. `shown` is the live value, or the last one while it is leaving.
 */
export function usePresenceValue<T>(value: T | null | undefined, exitMs: number) {
  const [held, setHeld] = useState<T | null>(value ?? null);
  if (value != null && held !== value) setHeld(value);
  const leaving = value == null && held != null;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setHeld(null), exitMs);
    return () => clearTimeout(t);
  }, [leaving, exitMs]);
  return { shown: value ?? held, exiting: leaving };
}

export type PresenceEntry<T> = {
  key: string;
  item: T;
  /** Cheap fingerprint of what the row shows; the entries are only rebuilt when the keys or a fingerprint change. */
  version: string;
  /** Removed from the data, still mounted while its `leave` animation plays. */
  exiting: boolean;
  /** Added after the list first rendered: plays the `enter` animation (the first render never animates). */
  fresh: boolean;
};

/** Merges the next items into the previous entries, keeping removed ones (in place) as exiting. */
export function mergeEntries<T>(
  prev: ReadonlyArray<PresenceEntry<T>>,
  items: ReadonlyArray<T>,
  keyOf: (item: T) => string,
  versionOf: (item: T) => string = keyOf,
): PresenceEntry<T>[] {
  const nextKeys = new Set(items.map(keyOf));
  const known = new Set(prev.map((e) => e.key));
  const out: PresenceEntry<T>[] = [];
  let p = 0;
  for (const item of items) {
    const key = keyOf(item);
    const version = versionOf(item);
    const at = prev.findIndex((e) => e.key === key);
    if (at >= 0) {
      for (; p < at; p++) if (!nextKeys.has(prev[p].key)) out.push({ ...prev[p], exiting: true });
      p = Math.max(p, at + 1);
      out.push({ key, item, version, exiting: false, fresh: prev[at].fresh });
    } else {
      out.push({ key, item, version, exiting: false, fresh: !known.has(key) });
    }
  }
  for (; p < prev.length; p++) if (!nextKeys.has(prev[p].key)) out.push({ ...prev[p], exiting: true });
  return out;
}

function sameShape<T>(entries: ReadonlyArray<PresenceEntry<T>>, items: ReadonlyArray<T>, keyOf: (item: T) => string, versionOf: (item: T) => string) {
  if (entries.length !== items.length) return false;
  return entries.every((e, i) => !e.exiting && e.key === keyOf(items[i]) && e.version === versionOf(items[i]));
}

/**
 * List version of `usePresenceValue`: rows that disappear stay `exitMs` longer, rows that appear are `fresh`.
 * `items` may be a new array with new objects on every render: state is only rebuilt when a key (or `versionOf`) changes.
 */
export function usePresenceList<T>(
  items: ReadonlyArray<T>,
  keyOf: (item: T) => string,
  exitMs: number,
  versionOf: (item: T) => string = keyOf,
): PresenceEntry<T>[] {
  const [entries, setEntries] = useState<PresenceEntry<T>[]>(() =>
    items.map((item) => ({ key: keyOf(item), item, version: versionOf(item), exiting: false, fresh: false })),
  );
  if (!sameShape(entries, items, keyOf, versionOf)) {
    const next = mergeEntries(entries, items, keyOf, versionOf);
    if (next.length !== entries.length || next.some((e, i) => e.key !== entries[i].key || e.exiting !== entries[i].exiting || e.version !== entries[i].version)) {
      setEntries(next);
    }
  }
  const leaving = entries.some((e) => e.exiting);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setEntries((cur) => cur.filter((e) => !e.exiting)), exitMs);
    return () => clearTimeout(t);
  }, [leaving, exitMs]);
  // live rows always show the freshest item
  const live = new Map(items.map((item) => [keyOf(item), item]));
  return entries.map((e) => (e.exiting ? e : { ...e, item: live.get(e.key) ?? e.item }));
}
