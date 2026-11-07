import type { Metadata } from "next";
import { BillFormScreen } from "@/components/app/bills/BillFormScreen";

export const metadata: Metadata = { title: "Платёж · Общак" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillFormScreen billId={id} />;
}
