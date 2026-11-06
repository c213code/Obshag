import type { Metadata } from "next";
import { NewPurchaseScreen } from "@/components/app/purchase/NewPurchaseScreen";

export const metadata: Metadata = { title: "Новая покупка · Общак" };

export default function NewPurchasePage() {
  return <NewPurchaseScreen />;
}
