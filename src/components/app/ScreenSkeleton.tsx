import { SkeletonCard, SkeletonRow } from "@/components/ui/Skeleton";

/** Shown while the session and household data load, and while a guard redirect is in flight. */
export function ScreenSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-[390px] flex-col gap-6 px-5 pt-[max(0px,calc(58px-env(safe-area-inset-top)))]">
      <div className="h-[44px]" />
      <SkeletonCard />
      <SkeletonRow />
      <SkeletonRow />
    </main>
  );
}
