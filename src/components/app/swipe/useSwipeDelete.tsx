"use client";

import { useCallback, useState, type ReactNode } from "react";
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

  const request = useCallback((p: UiPurchase) => {
    setTarget(p);
    setOpen(true);
  }, []);

  // stable between renders unless the permissions change, so memoised rows are not re-rendered by it
  const wrap = useCallback(
    (p: UiPurchase, row: ReactNode): ReactNode => {
      const allowed = Boolean(me) && !reduced && !p.id.startsWith("optimistic-") && canDelete(p, me?.id ?? "", members[p.household_id]);
      return (
        <SwipeDeleteRow enabled={allowed} onRequest={() => request(p)}>
          {row}
        </SwipeDeleteRow>
      );
    },
    [me, members, reduced, request],
  );

  // mounted only while a delete is being asked about (the target stays until the sheet has finished closing)
  const sheet = target ? (
    <DeleteConfirmSheet
      open={open}
      what={target.description}
      amount={formatTenge(target.amount)}
      onClose={() => setOpen(false)}
      onClosed={() => setTarget(null)}
      onConfirm={() => {
        setOpen(false);
        void deletePurchase(target.id);
      }}
    />
  ) : null;
  return { wrap, sheet };
}
