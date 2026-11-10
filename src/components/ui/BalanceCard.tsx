import { memo } from "react";
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

/** The tone now colours the sun, the lit windows and "me" (the sky is the same night for every flat). */
const toneClass: Record<CardTone, { sun: string; light: string; me: string }> = {
  lime: { sun: "bg-card-sun", light: "fill-card-window", me: "!bg-lime !text-on-lime" },
  orange: { sun: "bg-card-sun-orange", light: "fill-card-window-orange", me: "!bg-orange !text-on-orange" },
  periwinkle: { sun: "bg-card-sun-periwinkle", light: "fill-card-window-periwinkle", me: "!bg-periwinkle !text-on-periwinkle" },
};

/** Night-sky card: paper-cut hill layers, house silhouettes with lit windows and a sun in the flat's tone. */
export const BalanceCard = memo(function BalanceCard({
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
      className={cx("relative flex flex-col justify-between overflow-hidden rounded-lg bg-night-sky p-5 text-night-text", className)}
    >
      <span aria-hidden="true" className={cx("pointer-events-none absolute top-[78px] right-[64px] size-[56px] rounded-full", tone.sun)} />
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 300 110"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[112px] w-full"
      >
        <path className="fill-night-1" d="M0 40 Q60 10 120 35 T240 25 T300 30 V110 H0Z" />
        <path className="fill-night-2" d="M0 60 Q80 35 160 58 T300 50 V110 H0Z" />
        <path className="fill-night-3" d="M0 80 Q90 60 180 80 T300 72 V110 H0Z" />
        <g className="fill-night-ink">
          <rect x="121" y="80" width="26" height="30" />
          <path d="M117 82 L134 68 L151 82Z" />
          <rect x="159" y="74" width="20" height="36" />
          <rect x="187" y="86" width="30" height="24" />
          <path d="M183 88 L202 72 L221 88Z" />
        </g>
        <g className={tone.light}>
          <rect x="130" y="89" width="7" height="7" />
          <rect x="166" y="82" width="6" height="6" />
          <rect x="199" y="94" width="7" height="7" />
        </g>
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
        <span className="text-label text-night-muted">{ru.main.balance}</span>
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
              className={cx("border-2 border-night-3", i > 0 && "-ml-2", p.color === "me" && tone.me)}
            />
          ))}
        </div>
        {data.caption ? <span className="text-label text-night-on-hill">{data.caption}</span> : null}
      </div>
    </div>
  );
});
