import type { Metadata } from "next";
import { ResetScreen } from "@/components/app/ResetScreen";

export const metadata: Metadata = { title: "Новый пароль · Общак" };

export default function ResetPage() {
  return <ResetScreen />;
}
