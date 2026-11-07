import Link from "next/link";
import { PlusIcon, BellIcon, TransferIcon, CalendarIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { ru } from "@/lib/i18n/ru";

const circle = "grid size-[56px] place-items-center rounded-full";

/** Four round actions. Покупка and Расчёт work; the rest are visible but marked «скоро» until their slices land. */
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
      <Link
        href="/settle"
        className="flex flex-col items-center gap-2 text-label text-text transition-transform duration-200 ease-smooth active:scale-[0.96]"
      >
        <span className={cx(circle, "bg-card text-text")}>
          <BellIcon />
        </span>
        {ru.main.quick.remind}
      </Link>
      <Link
        href="/settle"
        className="flex flex-col items-center gap-2 text-label text-text transition-transform duration-200 ease-smooth active:scale-[0.96]"
      >
        <span className={cx(circle, "bg-card text-text")}>
          <TransferIcon />
        </span>
        {ru.main.quick.settle}
      </Link>
      <Link
        href="/monthly"
        className="flex flex-col items-center gap-2 text-label text-text transition-transform duration-200 ease-smooth active:scale-[0.96]"
      >
        <span className={cx(circle, "bg-card text-text")}>
          <CalendarIcon />
        </span>
        {ru.main.quick.monthly}
      </Link>
    </nav>
  );
}
