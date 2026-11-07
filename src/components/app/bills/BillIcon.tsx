import type { ReactNode } from "react";
import { BoltIcon, DropIcon, HomeIcon, ReceiptIcon, WifiIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import type { BillIcon as BillIconName } from "@/lib/data/types";

const GLYPH: Record<BillIconName, (size: number) => ReactNode> = {
  home: (size) => <HomeIcon size={size} />,
  drop: (size) => <DropIcon size={size} />,
  wifi: (size) => <WifiIcon size={size} />,
  bolt: (size) => <BoltIcon size={size} />,
  other: (size) => <ReceiptIcon size={size} />,
};

const TONE: Record<BillIconName, string> = {
  home: "bg-lime-soft text-lime",
  bolt: "bg-lime-soft text-lime",
  other: "bg-lime-soft text-lime",
  wifi: "bg-blue-soft text-blue",
  drop: "bg-blue-soft text-blue",
};

export const isBillIcon = (s: string): s is BillIconName => s in GLYPH;

/** Round 44px chip of a bill (Bills.dc.html .ic). `alert` turns it orange: the bill waits for an amount. */
export function BillIcon({ icon, alert = false, size = 22 }: { icon: string; alert?: boolean; size?: number }) {
  const name: BillIconName = isBillIcon(icon) ? icon : "other";
  return (
    <span aria-hidden="true" className={cx("grid size-[44px] shrink-0 place-items-center rounded-full", alert ? "bg-orange-soft text-orange" : TONE[name])}>
      {GLYPH[name](size)}
    </span>
  );
}
