import { PendingScreen } from "@/components/app/pending/PendingScreen";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ choice?: string | string[] }> };

export default async function PendingPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const raw = Array.isArray(query.choice) ? query.choice[0] : query.choice;
  return <PendingScreen id={id} choice={raw === "shared" || raw === "personal" ? raw : null} />;
}
