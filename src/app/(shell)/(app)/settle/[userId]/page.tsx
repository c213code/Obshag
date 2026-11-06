import type { Metadata } from "next";
import { SettleScreen } from "@/components/app/settle/SettleScreen";

export const metadata: Metadata = { title: "Расчёт · Общак" };

export default function SettleWithPage() {
  return <SettleScreen />;
}
