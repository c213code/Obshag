import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenSkeleton } from "@/components/app/ScreenSkeleton";
import { VerifyScreen } from "@/components/app/VerifyScreen";

export const metadata: Metadata = { title: "Код · Общак" };

export default function VerifyPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <VerifyScreen />
    </Suspense>
  );
}
