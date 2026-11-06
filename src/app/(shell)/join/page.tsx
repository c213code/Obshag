import type { Metadata } from "next";
import { JoinScreen } from "@/components/app/JoinScreen";

export const metadata: Metadata = { title: "Вход по коду · Общак" };

export default function JoinPage() {
  return <JoinScreen />;
}
