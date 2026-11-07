import type { Metadata } from "next";
import { ForgotScreen } from "@/components/app/ForgotScreen";

export const metadata: Metadata = { title: "Забыли пароль · Общак" };

export default function ForgotPage() {
  return <ForgotScreen />;
}
