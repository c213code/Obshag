import type { Metadata } from "next";
import { PurchaseDetailScreen } from "@/components/app/purchases/PurchaseDetailScreen";

export const metadata: Metadata = { title: "Покупка · Общак" };

export default function PurchasePage() {
  return <PurchaseDetailScreen />;
}
