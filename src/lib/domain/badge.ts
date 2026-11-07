export type BadgeInput = {
  /** Apple Pay purchases waiting for «Общее / Моё». */
  pending: number;
  /** Settlements people marked as paid to me, waiting for my «Получил». */
  incoming: number;
  /** People I owe money to. */
  owe: number;
};

/** The Home Screen icon badge: everything that is waiting for me. Never negative or fractional. */
export function badgeCount({ pending, incoming, owe }: BadgeInput): number {
  const n = [pending, incoming, owe].reduce((sum, v) => sum + (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0), 0);
  return n;
}

type BadgeNav = { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** setAppBadge(n), or clearAppBadge at 0. Does nothing where the API is missing; errors are swallowed. */
export function applyBadge(n: number, nav: BadgeNav | undefined = typeof navigator === "undefined" ? undefined : (navigator as BadgeNav)): void {
  if (!nav) return;
  try {
    if (n > 0 && nav.setAppBadge) void nav.setAppBadge(n).catch(() => undefined);
    else if (n <= 0 && nav.clearAppBadge) void nav.clearAppBadge().catch(() => undefined);
    else if (n <= 0 && nav.setAppBadge) void nav.setAppBadge(0).catch(() => undefined);
  } catch {
    // unsupported or blocked: the badge is a nicety
  }
}
