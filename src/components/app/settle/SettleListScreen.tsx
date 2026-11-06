"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { ChevronRightIcon } from "@/components/ui/icons";
import { ListRow } from "@/components/ui/ListRow";
import { listRedirect } from "@/lib/domain/settleNav";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useAppData } from "../AppDataProvider";
import { IncomingSection } from "../home/IncomingSection";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { EmptySettle } from "./EmptySettle";
import { useSettleData } from "./useSettleData";

/** /settle: the people I have a non-zero net with. One person goes straight to their screen; nobody shows «Все в расчёте». */
export function SettleListScreen() {
  const router = useRouter();
  const { me } = useAppData();
  const data = useSettleData();
  const counterparties = data?.net.counterparties ?? [];
  // one neighbour who is still here: straight to them. A departed one is never a redirect target (no loop with their screen)
  const only = data ? listRedirect(data.net, (id) => !!data.memberOf(id)) : null;
  /** The redirect is for arriving on the list. A refresh that changes the data while the user looks at it must not move them. */
  const [arrival, setArrival] = useState<"pending" | "redirect" | "stay">("pending");

  // decided once, while rendering the first data (React's "adjust state during render" pattern)
  if (data && arrival === "pending") setArrival(only ? "redirect" : "stay");

  useEffect(() => {
    // replace, so Back from the person's screen returns to where the user came from, not into a redirect loop
    if (arrival === "redirect" && only) router.replace(`/settle/${only}`);
  }, [arrival, only, router]);

  // until the first data is in and the arrival is decided, nothing is drawn (no flash of a one-row list)
  if (!data || !me || arrival !== "stay") return null;

  return (
    <Screen topOffset={54} bottomRoom={false} className="pb-10">
      <Header title={ru.settle.listTitle} onBack={() => (window.history.length > 1 ? router.back() : router.push("/"))} />
      <IncomingSection />
      {counterparties.length === 0 && data.incoming.length === 0 ? (
        <EmptySettle />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={ru.settle.listTitle}>
          {counterparties.map((c) => {
            const member = data.memberOf(c.userId);
            const amount = formatTenge(c.net);
            const caption = c.direction === "i_pay" ? ru.settle.iOwe(amount) : ru.settle.theyOwe(amount);
            if (!member) {
              // left the household: the debt is still real and still counted, but there is no screen to settle it on
              return (
                <li key={c.userId} data-testid="settle-departed-row">
                  <ListRow
                    name={ru.settle.departedName}
                    avatarColor="brown"
                    title={ru.settle.departedName}
                    caption={`${caption} · ${ru.settle.departedRow}`}
                    captionTone={c.direction === "i_pay" ? "orange" : "lime"}
                  />
                </li>
              );
            }
            const name = member.profile.display_name;
            return (
              <li key={c.userId}>
                <Link
                  href={`/settle/${c.userId}`}
                  aria-label={`${ru.settle.open(name)}, ${caption}`}
                  className="block transition-transform duration-200 ease-smooth active:scale-[0.98]"
                >
                  <ListRow
                    name={name}
                    avatarColor={avatarColorFor(member.profile, me.id)}
                    title={name}
                    caption={caption}
                    captionTone={c.direction === "i_pay" ? "orange" : "lime"}
                    trailing={<ChevronRightIcon size={20} className="text-muted" />}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
