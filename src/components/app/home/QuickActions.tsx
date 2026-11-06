import Link from "next/link";
import type { ReactNode } from "react";
import { PlusIcon, BellIcon, TransferIcon, CalendarIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { ru } from "@/lib/i18n/ru";

const circle = "grid size-[56px] place-items-center rounded-full";

function Soon({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button type="button" disabled className="relative flex cursor-not-allowed flex-col items-center gap-2 text-label text-muted">
      <span className={cx(circle, "relative bg-card text-muted")}>
        {icon}
        {/* a tiny badge on the circle: no extra text line, so the row keeps the mockup height */}
        <span className="absolute -top-[2px] -right-[6px] rounded-pill border border-bg bg-card-2 px-[6px] py-[2px] text-[9px] leading-[10px] font-medium text-muted">
          {ru.main.quick.soon}
        </span>
      </span>
      {label}
    </button>
  );
}

/** Four round actions. Покупка works; the rest are visible but marked «скоро» until their slices land. */
export function QuickActions() {
  return (
    <nav aria-label={ru.main.quick.purchase} className="grid grid-cols-4 gap-2">
      <Link
        href="/purchases/new"
        className="flex flex-col items-center gap-2 text-label text-text transition-transform duration-200 ease-smooth active:scale-[0.96]"
      >
        <span className={cx(circle, "bg-lime text-on-lime")}>
          <PlusIcon size={24} strokeWidth={2.2} />
        </span>
        {ru.main.quick.purchase}
      </Link>
      <Soon icon={<BellIcon />} label={ru.main.quick.remind} />
      <Soon icon={<TransferIcon />} label={ru.main.quick.settle} />
      <Soon icon={<CalendarIcon />} label={ru.main.quick.monthly} />
    </nav>
  );
}
