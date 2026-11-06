import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isKitEnabled } from "@/lib/env/public";
import { KitGallery } from "./KitGallery";

export const metadata: Metadata = { title: "UI-кит · Общак" };

export default function KitPage() {
  if (!isKitEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_E2E)) notFound();
  return <KitGallery />;
}
