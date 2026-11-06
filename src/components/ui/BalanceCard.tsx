import { Avatar, type AvatarColor } from "./Avatar";
import { Money } from "./Money";
import { cx } from "./cx";
import { ru } from "@/lib/i18n/ru";

/** Shared by BalanceCard and CardStack so the stack's geometry always matches the card. */
export const CARD_HEIGHT = 192;

export type CardTone = "lime" | "orange" | "periwinkle";

export type BalanceCardPerson = { name: string; color: AvatarColor };

export type BalanceCardData = {
  id: string;
  name: string;
  paid: number;
  total: number;
  balance: number;
  tone?: CardTone;
  /** Housemates shown as overlapped dots (max 4). */
  people?: ReadonlyArray<BalanceCardPerson>;
  /** Bottom-right caption, e.g. the month. */
  caption?: string;
  /** Spoken version of the "N из M" chip. */
  chipLabel?: string;
};

const toneClass: Record<CardTone, { card: string; ring: string; me: string }> = {
  lime: { card: "bg-lime text-on-lime", ring: "border-lime", me: "!bg-on-lime !text-lime" },
  orange: { card: "bg-orange text-on-orange", ring: "border-orange", me: "!bg-on-orange !text-orange" },
  periwinkle: { card: "bg-periwinkle text-on-periwinkle", ring: "border-periwinkle", me: "!bg-on-periwinkle !text-periwinkle" },
};

/** Main.dc.html front card: 28px radius, 20px padding, two soft rings, big rounded balance. */
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
      className={cx("relative flex flex-col justify-between overflow-hidden rounded-lg p-5", tone.card, className)}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 190 190"
        className="pointer-events-none absolute -top-10 -right-10 size-[190px]"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.08"
      >
        <circle cx="95" cy="95" r="86" strokeWidth="22" />
        <circle cx="95" cy="95" r="38" strokeWidth="12" />
      </svg>
      <div className="relative flex items-center justify-between">
        <p className="text-headline">{data.name}</p>
        {data.total > 0 ? (
          <span aria-label={data.chipLabel} className="rounded-pill bg-current/10 px-[10px] py-1 text-label">
            {ru.common.members(data.paid, data.total)}
          </span>
        ) : null}
      </div>
      <div className="relative flex flex-col gap-1">
        <span className="text-label">{ru.main.balance}</span>
        <Money id={balanceId} value={data.balance} sign className="text-display" />
      </div>
      <div className="relative flex items-center justify-between">
        <div className="flex">
          {(data.people ?? []).slice(0, 4).map((p, i) => (
            <Avatar
              key={`${p.name}-${i}`}
              name={p.name}
              color={p.color}
              size={26}
              decorative
              className={cx("border-2", tone.ring, i > 0 && "-ml-2", p.color === "me" && tone.me)}
            />
          ))}
        </div>
        {data.caption ? <span className="text-label">{data.caption}</span> : null}
      </div>
    </div>
  );
}
