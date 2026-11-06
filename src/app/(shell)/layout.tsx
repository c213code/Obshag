import { AppDataProvider } from "@/components/app/AppDataProvider";
import { ScreenSkeleton } from "@/components/app/ScreenSkeleton";
import { Toast } from "@/components/app/Toast";
import { RepoProvider } from "@/components/RepoProvider";

/** Everything except the /kit gallery: repo, signed-in data and notices. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <RepoProvider fallback={<ScreenSkeleton />}>
      <AppDataProvider>
        {children}
        <Toast />
      </AppDataProvider>
    </RepoProvider>
  );
}
