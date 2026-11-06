import type { Metadata } from "next";
import { SettleListScreen } from "@/components/app/settle/SettleListScreen";

export const metadata: Metadata = { title: "Расчёт · Общак" };

export default function SettlePage() {
  return <SettleListScreen />;
}
