import { PillLink } from "@/components/ui/Pill";
import { isKitEnabled } from "@/lib/env/public";
import { ru } from "@/lib/i18n/ru";

export default function HomePage() {
  const kit = isKitEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_E2E);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-title">{ru.home.placeholder}</h1>
      {kit ? (
        <PillLink href="/kit" variant="lime">
          {ru.home.openKit}
        </PillLink>
      ) : null}
    </main>
  );
}
