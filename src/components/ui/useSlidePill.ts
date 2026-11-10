"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { SNAP_MS, css } from "@/lib/motion";

/**
 * A pill that "slides" between tabs on the compositor (replaces motion's `layoutId`). Only the active tab renders its pill
 * (SSR-correct, exact at rest); when the active key changes the new pill plays a WAAPI animation from where the previous
 * pill was: `translateX` + `scaleX` of the measured boxes (measured once per change), the `snap` bezier. Reduced motion:
 * a short fade instead of the move. Give the pill `origin-left`.
 */
export function useSlidePill(activeKey: string, reduced: boolean) {
  const pills = useRef(new Map<string, HTMLElement>());
  const previous = useRef<{ key: string; rect: DOMRect } | null>(null);

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) pills.current.set(key, el);
      else pills.current.delete(key);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = pills.current.get(activeKey);
    if (!el) {
      previous.current = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const prev = previous.current;
    previous.current = { key: activeKey, rect };
    if (!prev || prev.key === activeKey || typeof el.animate !== "function") return;
    if (reduced) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" });
      return;
    }
    const dx = prev.rect.left - rect.left;
    const sx = rect.width > 0 ? prev.rect.width / rect.width : 1;
    if (dx === 0 && sx === 1) return;
    el.animate([{ transform: `translateX(${dx}px) scaleX(${sx})` }, { transform: "none" }], { duration: SNAP_MS, easing: css.snap });
  }, [activeKey, reduced]);

  // The box of the active pill changes with the viewport: keep the remembered one fresh.
  useEffect(() => {
    const onResize = () => {
      const cur = previous.current;
      const el = cur ? pills.current.get(cur.key) : undefined;
      if (cur && el) previous.current = { key: cur.key, rect: el.getBoundingClientRect() };
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return register;
}
