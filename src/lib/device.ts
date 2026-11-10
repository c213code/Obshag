"use client";

import { useSyncExternalStore } from "react";

let cached: boolean | null = null;

/**
 * Does this iPhone have a Dynamic Island? There is no API for it, so it is read from the top safe area:
 * island models report ~59–62 px, notch models 44–50 px, older phones 20 px, desktops 0.
 */
function measure(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)";
    document.body.appendChild(probe);
    const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    cached = top >= 51;
  } catch {
    cached = false;
  }
  return cached;
}

const noop = () => () => {};

/** True only on phones with a Dynamic Island; false on the server and everywhere else. */
export function useHasDynamicIsland(): boolean {
  return useSyncExternalStore(noop, measure, () => false);
}
