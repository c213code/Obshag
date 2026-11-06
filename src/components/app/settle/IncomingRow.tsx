"use client";

import { ReceivedRow } from "@/components/ui/ReceivedRow";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { avatarColorFor } from "../avatars";
import type { Incoming } from "./useSettleData";

/**
 * «<Имя> отметил оплату N ₸» with the lime «Получил» button (Главная and the settle screen). Wraps the approved
 * reference #4 row: the button shrinks into a ✓ and the progress fills to «все скинули».
 */
export function IncomingRow({
  row,
  meId,
  received,
  onReceive,
}: {
  row: Incoming;
  meId: string;
  received: boolean;
  onReceive: (row: Incoming) => void;
}) {
  const name = row.from.profile.display_name;
  const total = Math.max(1, row.covered);
  return (
    <div data-testid="incoming-row" data-received={received ? "true" : "false"}>
      <ReceivedRow
        name={name}
        avatarColor={avatarColorFor(row.from.profile, meId)}
        paid={received ? total : 0}
        total={total}
        received={received}
        onReceive={() => onReceive(row)}
        pendingLabel={ru.settle.markedPaid(formatTenge(row.settlement.amount))}
        receivedLabel={ru.settle.receivedDone}
        buttonLabel={ru.settle.received}
      />
    </div>
  );
}
