import type { Metadata } from "next";
import { HouseholdChoice } from "@/components/app/HouseholdChoice";

export const metadata: Metadata = { title: "Квартира · Общак" };

export default function HouseholdPage() {
  return <HouseholdChoice />;
}
