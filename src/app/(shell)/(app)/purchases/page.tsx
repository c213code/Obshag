import type { Metadata } from "next";
import { PurchasesScreen } from "@/components/app/purchases/PurchasesScreen";

export const metadata: Metadata = { title: "Покупки · Общак" };

export default function PurchasesPage() {
  return <PurchasesScreen />;
}
