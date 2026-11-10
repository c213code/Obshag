import type { Metadata } from "next";
import { CalendarScreen } from "@/components/app/duty/CalendarScreen";

export const metadata: Metadata = { title: "Календарь готовки · Общак" };

export default function DutyCalendarPage() {
  return <CalendarScreen />;
}
