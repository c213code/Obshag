import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { CheckIcon, PlaneIcon, SwapIcon } from "@/components/ui/icons";
import { letterOf, TONE_BG, type Tone } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";

/** The ring that marks today / me on a circle: a gap in the surface colour, then lime. */
export const RING: CSSProperties = { boxShadow: "0 0 0 3px var(--color-card), 0 0 0 5px var(--color-lime)" };
export const RING_BG: CSSProperties = { boxShadow: "0 0 0 3px var(--color-bg), 0 0 0 5px var(--color-lime)" };

/** A person as a coloured circle with one letter; `faded` is a past day (grey disc, letter at 28%). */
export function Dot({
  name,
  tone,
  size,
  faded = false,
  empty = false,
  fontSize,
  className,
  style,
  children,
  label,
}: {
  name: string;
  tone: Tone;
  size: number;
  faded?: boolean;
  empty?: boolean;
  fontSize?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Replaces the letter (e.g. «ТЫ»). */
  label?: string;
}) {
  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        empty ? "border border-dashed border-outline" : faded ? "bg-card-2 text-text" : TONE_BG[tone],
        className,
      )}
      style={{ width: size, height: size, fontSize: fontSize ?? Math.round(size * 0.39), ...style }}
    >
      {empty ? null : (
        <span aria-hidden="true" style={faded ? { opacity: 0.28 } : undefined}>
          {label ?? letterOf(name)}
        </span>
      )}
      {children}
    </span>
  );
}

/** The tick over a faded letter. */
export function Tick({ size }: { size: number }) {
  return (
    <span role="img" aria-label={ru.duty.week.done} className="absolute inline-flex text-text">
      <CheckIcon size={size} strokeWidth={2.7} />
    </span>
  );
}

/** ⇄ badge on a swapped day. `onSurface` = the white chip of the week cells, else the violet chip of the calendar. */
export function SwapBadge({ size, onSurface }: { size: number; onSurface?: boolean }) {
  return (
    <span
      role="img"
      aria-label={ru.duty.week.swap}
      className={cx(
        "absolute flex items-center justify-center rounded-full",
        onSurface ? "-right-1 -bottom-1 bg-card text-lime shadow-[0_1px_3px_rgb(0_0_0/0.18)]" : "-right-[5px] -top-[5px] bg-lime text-on-lime",
      )}
      style={{ width: size, height: size }}
    >
      <SwapIcon size={Math.round(size * 0.6)} strokeWidth={3} />
    </span>
  );
}

/** The plane of a day whose person is away (their grey disc), with the one who covers it as a small badge. */
export function AwayDot({ size, coverName, coverTone, big }: { size: number; coverName: string; coverTone: Tone; big?: boolean }) {
  return (
    <Dot name="" tone="blue" size={size} faded className="!bg-card-2">
      <span role="img" aria-label={ru.duty.week.away} className="absolute inline-flex text-muted">
        <PlaneIcon size={Math.round(size * 0.42)} strokeWidth={2} />
      </span>
      <span
        aria-hidden="true"
        className={cx("absolute flex items-center justify-center rounded-full font-bold", TONE_BG[coverTone], big ? "-right-1 -bottom-1 size-[18px] text-[10px]" : "-right-[5px] -bottom-[5px] size-[14px] text-[8px]")}
      >
        {letterOf(coverName)}
      </span>
    </Dot>
  );
}
