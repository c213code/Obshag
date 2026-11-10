import type { Metadata } from "next";
import { RequestScreen } from "@/components/app/duty/RequestScreen";

export const metadata: Metadata = { title: "Обмен днями · Общак" };

type Props = { params: Promise<{ id: string }> };

export default async function DutyRequestPage({ params }: Props) {
  const { id } = await params;
  return <RequestScreen id={id} />;
}
