import type { Metadata } from "next";
import { SoonScreen } from "@/components/app/SoonScreen";
import { ru } from "@/lib/i18n/ru";

export const metadata: Metadata = { title: "Покупки · Общак" };

export default function PurchasesPage() {
  return <SoonScreen title={ru.soon.purchasesTitle} text={ru.soon.purchasesText} />;
}
