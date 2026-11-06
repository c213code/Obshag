import { Bar } from "@/components/ui/Bar";
import { PillLink } from "@/components/ui/Pill";
import { ru } from "@/lib/i18n/ru";
import { Screen } from "./Screen";

/** Placeholder for tabs whose slices have not landed yet (Покупки, Ежемесячно). */
export function SoonScreen({ title, text }: { title: string; text: string }) {
  return (
    <Screen topOffset={54}>
      <Bar className="self-start px-5 py-3">
        <h1 className="text-headline">{title}</h1>
      </Bar>
      <div className="flex flex-col items-start gap-3 rounded-lg bg-card p-5">
        <span className="rounded-pill bg-lime-soft px-[10px] py-1 text-label text-lime">{ru.main.quick.soon}</span>
        <p className="text-body">{text}</p>
        <PillLink href="/" variant="lime">
          {ru.soon.back}
        </PillLink>
      </div>
    </Screen>
  );
}
