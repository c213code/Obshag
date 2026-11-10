"use client";

import { Dot } from "./parts";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import type { MemberWithProfile } from "@/lib/data/repo";
import { toneMap } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";

const small =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card-2 text-text transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.94] disabled:opacity-30";

/** Reorders a rotation with up / down buttons; members who are not in it can be added back. Controlled. */
export function OrderEditor({
  order,
  onChange,
  roster,
  meId,
}: {
  order: string[];
  onChange: (next: string[]) => void;
  roster: ReadonlyArray<MemberWithProfile>;
  meId: string | null;
}) {
  const names = new Map(roster.map((m) => [m.user_id, m.profile.display_name]));
  const tones = toneMap(order, meId);
  const rest = roster.filter((m) => m.active && !order.includes(m.user_id));
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2" data-testid="order-editor">
        {order.map((id, i) => {
          const name = names.get(id) ?? "?";
          return (
            <li key={id} data-testid="order-row" className="flex items-center gap-3 rounded-[20px] border border-hairline bg-card p-[10px]">
              <span className="w-4 text-center text-[13px] text-muted">{i + 1}</span>
              <Dot name={name} tone={tones.get(id) ?? "blue"} size={36} />
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{name}</span>
              <button type="button" aria-label={ru.duty.create.up(name)} disabled={i === 0} onClick={() => move(i, -1)} className={small}>
                <ArrowUpIcon size={16} />
              </button>
              <button type="button" aria-label={ru.duty.create.down(name)} disabled={i === order.length - 1} onClick={() => move(i, 1)} className={small}>
                <ArrowDownIcon size={16} />
              </button>
              <button
                type="button"
                aria-label={ru.duty.create.remove(name)}
                disabled={order.length <= 1}
                onClick={() => onChange(order.filter((x) => x !== id))}
                className={small}
              >
                <CloseIcon size={14} />
              </button>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="pl-[6px] text-caption">{ru.duty.create.notIn}</span>
          {rest.map((m) => (
            <button
              key={m.user_id}
              type="button"
              aria-label={ru.duty.create.add(m.profile.display_name)}
              onClick={() => onChange([...order, m.user_id])}
              className="flex items-center gap-3 rounded-[20px] border border-dashed border-outline p-[10px] text-left text-muted transition-transform duration-200 ease-smooth active:scale-[0.99]"
            >
              <Dot name={m.profile.display_name} tone="blue" size={36} faded />
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{m.profile.display_name}</span>
              <PlusIcon size={16} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
