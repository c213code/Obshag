"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellIcon, CheckIcon, ChevronDownIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { ru } from "@/lib/i18n/ru";

export type FlatOption = { id: string; name: string };

const pill = "flex h-11 items-center gap-2 rounded-pill bg-card px-4 text-headline transition-transform duration-200 ease-smooth active:scale-[0.97]";

/** Flat switcher pill: with several flats a small menu switches the active one (same action as the card stack), with one it opens Квартира. */
function FlatSwitcher({ flats, activeId, onSwitch }: { flats: ReadonlyArray<FlatOption>; activeId: string | null; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = flats.find((f) => f.id === activeId) ?? flats[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!active) return <div className="flex-1" />;
  if (flats.length < 2) {
    return (
      <Link href="/flat" data-testid="flat-switcher" className={cx(pill, "min-w-0")}>
        <span className="truncate">{active.name}</span>
        <ChevronDownIcon size={16} className="shrink-0 text-muted" />
      </Link>
    );
  }
  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        data-testid="flat-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${ru.main.switchFlat}: ${active.name}`}
        onClick={() => setOpen((o) => !o)}
        className={cx(pill, "max-w-full")}
      >
        <span className="truncate">{active.name}</span>
        <ChevronDownIcon size={16} className={cx("shrink-0 text-muted transition-transform duration-200 ease-smooth", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="enter absolute top-[50px] left-0 z-20 flex min-w-[200px] flex-col gap-1 rounded-md border border-hairline bg-card p-2 shadow-[0_12px_32px_-12px] shadow-text/30 [--enter-d:0.2s] [--enter-y:-6px]">
          {flats.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitemradio"
              aria-checked={f.id === active.id}
              onClick={() => {
                setOpen(false);
                if (f.id !== active.id) onSwitch(f.id);
              }}
              className={cx("flex h-11 items-center justify-between gap-3 rounded-sm px-3 text-left text-body", f.id === active.id ? "bg-card-2" : "active:bg-card-2")}
            >
              <span className="truncate">{f.name}</span>
              {f.id === active.id ? <CheckIcon size={16} className="text-lime" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Главная header (bento mockup): flat switcher pill, the bell, my avatar. */
export function HomeHeader({
  name,
  flats,
  activeId,
  onSwitch,
  unread,
}: {
  name: string;
  flats: ReadonlyArray<FlatOption>;
  activeId: string | null;
  onSwitch: (id: string) => void;
  unread: number;
}) {
  return (
    <header className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <FlatSwitcher flats={flats} activeId={activeId} onSwitch={onSwitch} />
      </div>
      <button
        type="button"
        disabled
        aria-label={ru.main.notifications}
        className="relative grid size-[44px] place-items-center rounded-full bg-card text-text"
      >
        <BellIcon />
        {unread > 0 ? <span aria-hidden="true" className="absolute top-[10px] right-[11px] size-2 rounded-full bg-orange" /> : null}
      </button>
      <Link
        href="/flat"
        aria-label={ru.main.profileOf(name)}
        className="grid size-[44px] place-items-center rounded-full bg-lime text-headline text-on-lime transition-transform duration-200 ease-smooth active:scale-[0.94]"
      >
        {Array.from(name)[0]?.toUpperCase()}
      </Link>
    </header>
  );
}
