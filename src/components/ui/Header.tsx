import type { ReactNode } from "react";
import { Bar } from "./Bar";
import { BackIcon } from "./icons";
import { ru } from "@/lib/i18n/ru";

const circle =
  "inline-flex size-[44px] shrink-0 items-center justify-center rounded-full bg-card-2 text-text transition-transform duration-200 ease-smooth active:scale-[0.94]";

export function Header({
  title,
  onBack,
  trailing,
}: {
  title: string;
  onBack?: () => void;
  trailing?: { label: string; icon: ReactNode; onClick?: () => void };
}) {
  return (
    <header className="flex items-center justify-between gap-2">
      <Bar className="min-w-0 pr-4">
        <button type="button" aria-label={ru.common.back} onClick={onBack} className={circle}>
          <BackIcon />
        </button>
        <h2 className="truncate pl-1 text-headline">{title}</h2>
      </Bar>
      {trailing ? (
        <Bar>
          <button type="button" aria-label={trailing.label} onClick={trailing.onClick} className={circle}>
            {trailing.icon}
          </button>
        </Bar>
      ) : null}
    </header>
  );
}
