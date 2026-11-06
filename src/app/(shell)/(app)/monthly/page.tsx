import type { Metadata } from "next";
import { SoonScreen } from "@/components/app/SoonScreen";
import { ru } from "@/lib/i18n/ru";

export const metadata: Metadata = { title: "Ежемесячно · Общак" };

export default function MonthlyPage() {
  return <SoonScreen title={ru.soon.monthlyTitle} text={ru.soon.monthlyText} />;
}
