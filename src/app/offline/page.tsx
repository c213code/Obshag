import type { Metadata } from "next";
import { OfflineScreen } from "@/components/app/OfflineScreen";

export const metadata: Metadata = { title: "Офлайн · Общак" };

export default function OfflinePage() {
  return <OfflineScreen />;
}
