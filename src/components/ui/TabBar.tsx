"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { Bar } from "./Bar";
import { Fab } from "./Fab";
import { useSlidePill } from "./useSlidePill";
import { cx } from "./cx";
import { CalendarIcon, CartIcon, HomeIcon, ListIcon, PlusIcon, UsersIcon } from "./icons";

export type TabId = "home" | "purchases" | "monthly" | "household";

export type TabDef = { id: TabId; label: string; icon: ReactNode; href?: string };

export const defaultTabs: ReadonlyArray<TabDef> = [
  { id: "home", label: ru.nav.home, icon: <HomeIcon /> },
  { id: "purchases", label: ru.nav.purchases, icon: <ListIcon /> },
  { id: "monthly", label: ru.nav.monthly, icon: <CalendarIcon /> },
  { id: "household", label: ru.nav.household, icon: <UsersIcon /> },
];

export type FabAction = "purchase" | "monthly";

const isHrefActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

const menuItem = "flex items-center gap-[10px] rounded-pill px-3 py-[10px] text-left text-[14px] text-text";

/**
 * Floating tab bar: a Bar with 4 tabs (active = icon + label in a card-2 pill that slides
 * via a WAAPI transform, see useSlidePill) plus a lime Fab "+".
 *
 * Fab menu (approved reference, docs/design/motion-reference.html #1): the Fab does NOT rotate,
 * it shrinks to .6 and fades while the menu grows out of its bottom-right corner (scale .24 -> 1,
 * soft spring, all CSS transitions toggled by data-open). The menu has a highlighted first row, lime icons and a lime «Закрыть» pill.
 *
 * Tabs with `href` derive the active tab from the pathname; tabs without it use `value`.
 * Taps are never locked: every handler is idempotent.
 */
export function TabBar({
  value,
  onChange,
  onAction,
  tabs = defaultTabs,
  position = "fixed",
  soonActions = [],
}: {
  value: TabId;
  onChange?: (id: TabId) => void;
  onAction?: (action: FabAction) => void;
  tabs?: ReadonlyArray<TabDef>;
  position?: "fixed" | "static";
  /** Menu actions whose screen does not exist yet: shown disabled with a «скоро» badge, skipped by the arrow keys. */
  soonActions?: ReadonlyArray<FabAction>;
}) {
  const pathname = usePathname();
  const { reduced } = useReducedMotionSafe();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const monthlySoon = soonActions.includes("monthly");
  const activeId = tabs.find((t) => t.href && isHrefActive(pathname, t.href))?.id ?? value;
  const pillRef = useSlidePill(activeId, reduced);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-focus]") ?? []);

  // Focus: first item on open, the Fab on close.
  useEffect(() => {
    if (menuOpen) {
      items()[0]?.focus();
    } else if (wasOpen.current) {
      fabRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setMenuOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  const choose = (action: FabAction) => {
    setMenuOpen(false);
    onAction?.(action);
  };

  return (
    <>
      {position === "fixed" ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[136px] bg-gradient-to-t from-bg via-bg/85 to-transparent"
        />
      ) : null}
      <div
        className={cx(
          position === "fixed" &&
            "fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),28px)]",
        )}
      >
        <div
          className={cx(
            "relative flex items-center justify-between gap-3",
            position === "fixed" ? "w-full max-w-[390px] px-5" : "w-full",
          )}
        >
          <nav aria-label={ru.nav.label} className="min-w-0 flex-1">
              <Bar className="justify-between">
                {tabs.map((tab) => {
                  const active = tab.id === activeId;
                  const cls = cx(
                    "relative inline-flex h-11 items-center justify-center gap-2 rounded-pill whitespace-nowrap",
                    active ? "px-4" : "px-[10px]",
                    "text-label transition-colors duration-200 ease-smooth active:scale-[0.97]",
                    active ? "text-text" : "text-muted",
                  );
                  const inner = (
                    <>
                      {active ? (
                        <span
                          ref={pillRef(tab.id)}
                          aria-hidden="true"
                          className="absolute inset-0 origin-left rounded-pill bg-card-2"
                        />
                      ) : null}
                      <span className="relative inline-flex items-center gap-2">
                        {tab.icon}
                        {active ? (
                          <span className="enter [--enter-d:0.25s] [--enter-delay:0.05s]">{tab.label}</span>
                        ) : null}
                      </span>
                    </>
                  );
                  return tab.href ? (
                    <Link
                      key={tab.id}
                      href={tab.href}
                      aria-label={tab.label}
                      aria-current={active ? "page" : undefined}
                      className={cls}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      key={tab.id}
                      type="button"
                      aria-label={tab.label}
                      aria-current={active ? "page" : undefined}
                      className={cls}
                      onClick={() => onChange?.(tab.id)}
                    >
                      {inner}
                    </button>
                  );
                })}
              </Bar>
            </nav>

          <Fab
            ref={fabRef}
            aria-label={ru.nav.add}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            hidden={menuOpen}
            tabIndex={menuOpen ? -1 : 0}
            onClick={() => setMenuOpen(true)}
          >
            <PlusIcon size={26} strokeWidth={2.4} />
          </Fab>

          <div
            ref={menuRef}
            role="menu"
            aria-label={ru.nav.add}
            inert={!menuOpen}
            data-open={menuOpen}
            onKeyDown={onMenuKeyDown}
            className={cx(
              "fab-menu absolute right-5 bottom-0 z-10 flex w-[220px] flex-col gap-[6px] rounded-lg border border-card-2 bg-card p-2",
              !menuOpen && "pointer-events-none",
            )}
          >
            <button
              type="button"
              role="menuitem"
              data-menu-focus
              className={cx(menuItem, "bg-card-2")}
              onClick={() => choose("purchase")}
            >
              <CartIcon size={18} className="text-lime" />
              {ru.nav.addPurchase}
            </button>
            <button
              type="button"
              role="menuitem"
              data-menu-focus={monthlySoon ? undefined : ""}
              disabled={monthlySoon}
              className={cx(menuItem, monthlySoon && "cursor-not-allowed text-muted")}
              onClick={() => choose("monthly")}
            >
              <CalendarIcon size={18} className={monthlySoon ? "text-muted" : "text-lime"} />
              {ru.nav.addMonthly}
              {monthlySoon ? (
                <span className="ml-auto rounded-pill bg-card-2 px-[7px] py-[2px] text-[10px] leading-[12px] font-medium text-muted">
                  {ru.main.quick.soon}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              data-menu-focus
              className="rounded-pill bg-lime p-[11px] text-[14px] font-semibold text-on-lime"
              onClick={() => setMenuOpen(false)}
            >
              {ru.common.close}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
