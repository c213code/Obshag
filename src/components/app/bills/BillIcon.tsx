import type { ReactNode } from "react";
import { DocLinesIcon, FlameIcon, HomeIcon, ReceiptIcon, WifiIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import type { BillIcon as BillIconName } from "@/lib/data/types";

const GLYPH: Record<BillIconName, (size: number) => ReactNode> = {
  home: (size) => <HomeIcon size={size} />,
  internet: (size) => <WifiIcon size={size} />,
  gas: (size) => <FlameIcon size={size} />,
  utility: (size) => <DocLinesIcon size={size} />,
  receipt: (size) => <ReceiptIcon size={size} />,
};

const TONE: Record<BillIconName, string> = {
  home: "bg-lime-soft text-lime",
  receipt: "bg-lime-soft text-lime",
  utility: "bg-lime-soft text-lime",
  internet: "bg-blue-soft text-blue",
  gas: "bg-orange-soft text-orange",
};

export const isBillIcon = (s: string): s is BillIconName => s in GLYPH;

/** Round 44px chip of a bill (Bills.dc.html .ic). `alert` turns it orange: the bill waits for an amount. `tile` is the rounded-square variant of purchase rows. */
export function BillIcon({ icon, alert = false, size = 22, tile = false }: { icon: string; alert?: boolean; size?: number; tile?: boolean }) {
  const name: BillIconName = isBillIcon(icon) ? icon : "receipt";
  return (
    <span aria-hidden="true" className={cx("grid size-[44px] shrink-0 place-items-center", tile ? "rounded-[14px]" : "rounded-full", alert ? "bg-orange-soft text-orange" : TONE[name])}>
      {GLYPH[name](size)}
    </span>
  );
}
