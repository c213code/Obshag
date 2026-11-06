import type { Metadata } from "next";
import { OnboardingScreen } from "@/components/app/OnboardingScreen";

export const metadata: Metadata = { title: "Знакомство · Общак" };

export default function OnboardingPage() {
  return <OnboardingScreen />;
}
