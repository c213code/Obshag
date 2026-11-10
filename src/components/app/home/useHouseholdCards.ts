"use client";

import { useAppDerived } from "../AppDataProvider";

/** One BalanceCard per household (Главная and the Квартира switcher). Computed once by the provider. */
export function useHouseholdCards() {
  return useAppDerived().cards;
}
