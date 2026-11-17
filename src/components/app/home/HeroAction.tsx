"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BalanceCardData } from "@/components/ui/BalanceCard";
import { Pill, PillLink } from "@/components/ui/Pill";
import { formatTenge } from "@/lib/format/money";
import { useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";

/** The «К оплате» section's id on Главная: «Оплатить» with several people to pay scrolls to it. */
export const TO_PAY_ID = "to-pay";

/**
 * Slice 27: the hero card's one action, in the chip's place. I owe: a lime «Оплатить» — straight to the one person, or to
 * the «К оплате» list when there are several. I am owed: a secondary «Напомнить» link (the settle list carries the pills).
 * Even: nothing.
 */
export function HeroAction({ card }: { card: BalanceCardData }) {
  const router = useRouter();
  const { reduced } = useReducedMotionSafe();
  const { hero } = card;

  if (hero.kind === "owe") {
    const aria = ru.main.hero.payAria(formatTenge(hero.amount));
    if (card.payTo) {
      return (
        <PillLink href={`/settle/${card.payTo}`} prefetch={false} variant="lime" size="sm" aria-label={aria} data-testid="hero-pay">
          {ru.main.hero.pay}
        </PillLink>
      );
    }
    const toList = () => {
      const target = document.getElementById(TO_PAY_ID);
      if (target) target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      else router.push("/settle");
    };
    return (
      <Pill variant="lime" size="sm" onClick={toList} aria-label={aria} data-testid="hero-pay">
        {ru.main.hero.pay}
      </Pill>
    );
  }
  if (hero.kind === "owed") {
    return (
      <Link
        href="/settle"
        prefetch={false}
        data-testid="hero-remind"
        className="inline-flex h-8 items-center px-1 text-label font-semibold text-lime transition-opacity duration-200 ease-smooth active:opacity-70"
      >
        {ru.main.hero.remind}
      </Link>
    );
  }
  return null;
}

/** For CardStack's `frontAction`: a stable function, so the memoised stack does not re-render for nothing. */
export const heroAction = (card: BalanceCardData) => (card.hero.kind === "even" ? null : <HeroAction card={card} />);
