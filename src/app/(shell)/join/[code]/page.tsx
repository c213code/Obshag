import type { Metadata } from "next";
import { codeFromPath } from "@/lib/domain/deepLink";
import { JoinScreen } from "@/components/app/JoinScreen";

export const metadata: Metadata = { title: "Тебя зовут в квартиру · Общак" };

export default async function JoinDeepLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinScreen initialCode={codeFromPath(code)} />;
}
