import type { Metadata } from "next";
import { DutyScreen } from "@/components/app/duty/DutyScreen";

export const metadata: Metadata = { title: "Очередь · Общак" };

export default function DutyPage() {
  return <DutyScreen />;
}
