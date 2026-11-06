import { Money } from "./Money";
import { cx } from "./cx";
import { ru } from "@/lib/i18n/ru";

/** Shared by BalanceCard and CardStack so the stack's geometry always matches the card. */
export const CARD_HEIGHT = 176;

export type CardTone = "lime" | "orange" | "periwinkle";

export type BalanceCardData = {
  id: string;
  name: string;
  paid: number;
  total: number;
  balance: number;
  tone?: CardTone;
};

const toneClass: Record<CardTone, { card: string; chip: string }> = {
  lime: { card: "bg-lime text-on-lime", chip: "bg-on-lime text-lime" },
  orange: { card: "bg-orange text-on-orange", chip: "bg-on-orange text-orange" },
  periwinkle: { card: "bg-periwinkle text-on-periwinkle", chip: "bg-on-periwinkle text-periwinkle" },
};

export function BalanceCard({
  data,
  className,
  balanceId,
}: {
  data: BalanceCardData;
  className?: string;
  balanceId?: string;
}) {
  const tone = toneClass[data.tone ?? "lime"];
  return (
    <div
      style={{ height: CARD_HEIGHT }}
      className={cx("relative overflow-hidden rounded-lg p-4", tone.card, className)}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 200 200"
        className="pointer-events-none absolute -top-10 -right-10 size-[220px] overflow-visible opacity-[0.12]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="100" cy="100" r="30" />
        <circle cx="100" cy="100" r="55" />
        <circle cx="100" cy="100" r="80" />
        <circle cx="100" cy="100" r="105" />
      </svg>
      <div className="relative flex items-center justify-between">
        <p className="text-headline">{data.name}</p>
        <span className={cx("rounded-pill px-3 py-[6px] text-label", tone.chip)}>
          {ru.common.members(data.paid, data.total)}
        </span>
      </div>
      <Money id={balanceId} value={data.balance} sign className="relative mt-8 block text-display" />
    </div>
  );
}
