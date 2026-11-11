import type { Metadata } from "next";
import { PayLinkScreen } from "@/components/paylink/PayLinkScreen";
import { viewPayLink } from "@/lib/server/payLinkHandler";
import { getPayLinkDeps } from "@/lib/server/reminderDeps";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Перевод · Общак", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * /k/<code>: PUBLIC (the roommates open it from the Telegram group; src/proxy.ts does not run on it, so there is no
 * redirect to /login). Outside the (shell) group too: no app data, no bottom nav. The page only LOOKS (open = false): a
 * link preview must not count as «opened Kaspi».
 */
export default async function PayLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await viewPayLink(code, getPayLinkDeps());
  return <PayLinkScreen code={code} view={view} />;
}
