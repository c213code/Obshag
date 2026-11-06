import type { Metadata } from "next";
import { CreateHouseholdScreen } from "@/components/app/CreateHouseholdScreen";

export const metadata: Metadata = { title: "Новая квартира · Общак" };

export default function NewHouseholdPage() {
  return <CreateHouseholdScreen />;
}
