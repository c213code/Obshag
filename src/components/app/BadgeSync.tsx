"use client";

import { useEffect } from "react";
import { applyBadge, badgeCount } from "@/lib/domain/badge";
import { useAppData } from "./AppDataProvider";
import { useSettleData } from "./settle/useSettleData";

/** Keeps the Home Screen icon badge in step with every data refresh. Renders nothing. */
export function BadgeSync() {
  const { purchases, activeId } = useAppData();
  const settle = useSettleData();
  const pending = ((activeId && purchases[activeId]) || []).filter((p) => p.status === "pending").length;
  const incoming = settle?.incoming.length ?? 0;
  const owe = settle?.net.counterparties.filter((c) => c.direction === "i_pay").length ?? 0;
  const n = badgeCount({ pending, incoming, owe });
  useEffect(() => {
    applyBadge(n);
  }, [n]);
  useEffect(() => () => applyBadge(0), []);
  return null;
}
