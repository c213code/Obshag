import { PillLink } from "@/components/ui/Pill";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";

/** Main.dc.html Долги card: summary, orange/lime split bar, two captions and the «Рассчитаться» button (opens /settle). */
export function DebtsCard({ owe, owed }: { owe: number; owed: number }) {
  const net = owed - owe;
  const empty = owe === 0 && owed === 0;
  return (
    <section aria-label={ru.main.debts.title} className="flex flex-col gap-3 rounded-lg bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-headline">{ru.main.debts.title}</h2>
        <span className="text-caption">
          {ru.main.debts.total}{" "}
          <span className={net < 0 ? "text-orange" : "text-lime"}>{formatTenge(net, { sign: true })}</span>
        </span>
      </div>
      <div aria-hidden="true" className="flex h-2 gap-1">
        {empty ? <div className="flex-1 rounded-[4px] bg-card-2" /> : null}
        {owe > 0 ? <div style={{ flex: owe }} className="rounded-[4px] bg-orange" /> : null}
        {owed > 0 ? <div style={{ flex: owed }} className="rounded-[4px] bg-lime" /> : null}
      </div>
      <div className="flex justify-between text-label">
        <span className="text-orange">
          {ru.main.debts.owe} {formatTenge(owe)}
        </span>
        <span className="text-lime">
          {ru.main.debts.owed} {formatTenge(owed)}
        </span>
      </div>
      <PillLink href="/settle" variant="lime" size="lg" className="w-full">
        {ru.main.debts.settle}
      </PillLink>
    </section>
  );
}
