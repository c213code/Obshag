import { CheckIcon } from "@/components/ui/icons";
import { PillLink } from "@/components/ui/Pill";
import { ru } from "@/lib/i18n/ru";

/** «Все в расчёте»: nothing to transfer. */
export function EmptySettle({ title = ru.settle.emptyTitle, text = ru.settle.emptyText, action = ru.settle.emptyAction, href = "/" }: {
  title?: string;
  text?: string;
  action?: string;
  href?: string;
}) {
  return (
    <div data-testid="settle-empty" className="flex flex-col items-start gap-3 rounded-lg border border-hairline bg-card p-5">
      <span aria-hidden="true" className="grid size-[44px] place-items-center rounded-full bg-lime text-on-lime">
        <CheckIcon size={22} strokeWidth={2.4} />
      </span>
      <h2 className="text-headline">{title}</h2>
      <p className="text-caption">{text}</p>
      <PillLink href={href} variant="lime">
        {action}
      </PillLink>
    </div>
  );
}
