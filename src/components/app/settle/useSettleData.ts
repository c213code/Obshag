"use client";

import { useAppDerived } from "../AppDataProvider";

export type { Incoming, SettleData } from "./settleData";

/** The active household's settle numbers. Computed once in the provider; every reader shares the same object. */
export function useSettleData() {
  return useAppDerived().settle;
}
