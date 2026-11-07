"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TabBar, defaultTabs, type FabAction, type TabDef } from "@/components/ui/TabBar";
import { Guard } from "./Guard";

const HREFS: Record<TabDef["id"], string> = { home: "/", purchases: "/purchases", monthly: "/monthly", household: "/flat" };
const tabs: ReadonlyArray<TabDef> = defaultTabs.map((t) => ({ ...t, href: HREFS[t.id] }));

/** Signed-in frame: the guard plus the floating TabBar (the purchase form brings its own bottom bar). */
export function AppFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const onAction = (action: FabAction) => router.push(action === "purchase" ? "/purchases/new" : "/monthly/new");
  const ownBar = pathname.startsWith("/purchases/") || pathname.startsWith("/settle") || pathname.startsWith("/settings") || pathname.startsWith("/monthly");
  return (
    <Guard page="app">
      {children}
      {ownBar ? null : <TabBar value="home" tabs={tabs} onAction={onAction} />}
    </Guard>
  );
}
