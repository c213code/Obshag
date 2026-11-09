"use client";

import { useState, type ReactNode } from "react";
import { canDelete } from "@/lib/domain/canDelete";
import { formatTenge } from "@/lib/format/money";
import { useReducedMotionSafe } from "@/lib/motion";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { useAppActions, useAppData } from "../AppDataProvider";
import { DeleteConfirmSheet } from "./DeleteConfirmSheet";
import { SwipeDeleteRow } from "./SwipeDeleteRow";

/** Swipe-to-delete for a list of purchases: `wrap(purchase, row)` and render `sheet` once. */
export function useSwipeDelete() {
  const { me, members } = useAppData();
  const { deletePurchase } = useAppActions();
  const { reduced } = useReducedMotionSafe();
  const [target, setTarget] = useState<UiPurchase | null>(null);
  const [open, setOpen] = useState(false);

  const wrap = (p: UiPurchase, row: ReactNode): ReactNode => {
    const allowed = Boolean(me) && !reduced && !p.id.startsWith("optimistic-") && canDelete(p, me?.id ?? "", members[p.household_id]);
    return (
      <SwipeDeleteRow
        enabled={allowed}
        onRequest={() => {
          setTarget(p);
          setOpen(true);
        }}
      >
        {row}
      </SwipeDeleteRow>
    );
  };

  const sheet = (
    <DeleteConfirmSheet
      open={open}
      what={target?.description ?? ""}
      amount={target ? formatTenge(target.amount) : ""}
      onClose={() => setOpen(false)}
      onConfirm={() => {
        setOpen(false);
        if (target) void deletePurchase(target.id);
      }}
    />
  );
  return { wrap, sheet };
}
