import { AppFrame } from "@/components/app/AppFrame";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
