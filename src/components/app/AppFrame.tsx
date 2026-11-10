"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TabBar, defaultTabs, type FabAction, type TabDef } from "@/components/ui/TabBar";
import { BadgeSync } from "./BadgeSync";
import { Guard } from "./Guard";
import { InstallPrompt } from "./InstallPrompt";
import { OfflineBanner } from "./OfflineBanner";

const HREFS: Record<TabDef["id"], string> = { home: "/", purchases: "/purchases", duty: "/duty", monthly: "/monthly", household: "/flat" };
const tabs: ReadonlyArray<TabDef> = defaultTabs.map((t) => ({ ...t, href: HREFS[t.id] }));

/** Signed-in frame: the guard plus the floating TabBar (the purchase form brings its own bottom bar). */
export function AppFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const onAction = (action: FabAction) => router.push(action === "purchase" ? "/purchases/new" : "/monthly/new");
  const ownBar = pathname.startsWith("/purchases/") || pathname.startsWith("/settle") || pathname.startsWith("/settings") || pathname.startsWith("/monthly") || pathname.startsWith("/duty/");
  return (
    <Guard page="app">
      <OfflineBanner />
      <BadgeSync />
      {children}
      <InstallPrompt />
      {ownBar ? null : <TabBar value="home" tabs={tabs} onAction={onAction} />}
    </Guard>
  );
}
