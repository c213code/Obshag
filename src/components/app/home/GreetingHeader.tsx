import Link from "next/link";
import { BellIcon } from "@/components/ui/icons";
import { ru } from "@/lib/i18n/ru";

/** Main.dc.html header: greeting + title on the left, bell and profile circle on the right. */
export function GreetingHeader({ name, initial, unread }: { name: string; initial: string; unread: number }) {
  return (
    <header className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-caption">{ru.main.greeting(name)}</span>
        <h1 className="text-title">{ru.main.appName}</h1>
      </div>
      <button
        type="button"
        disabled
        aria-label={ru.main.notifications}
        className="relative grid size-[44px] place-items-center rounded-full bg-card text-text"
      >
        <BellIcon />
        {unread > 0 ? <span aria-hidden="true" className="absolute top-[10px] right-[11px] size-2 rounded-full bg-orange" /> : null}
      </button>
      <Link
        href="/flat"
        aria-label={ru.main.profile}
        className="grid size-[44px] place-items-center rounded-full bg-lime text-headline text-on-lime transition-transform duration-200 ease-smooth active:scale-[0.94]"
      >
        {Array.from(initial)[0]?.toUpperCase()}
      </Link>
    </header>
  );
}
