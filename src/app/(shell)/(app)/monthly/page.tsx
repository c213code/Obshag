import type { Metadata } from "next";
import { MonthlyScreen } from "@/components/app/bills/MonthlyScreen";

export const metadata: Metadata = { title: "Ежемесячно · Общак" };

export default function MonthlyPage() {
  return <MonthlyScreen />;
}
