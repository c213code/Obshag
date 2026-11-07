import type { Metadata } from "next";
import { BillFormScreen } from "@/components/app/bills/BillFormScreen";

export const metadata: Metadata = { title: "Новый платёж · Общак" };

export default function NewBillPage() {
  return <BillFormScreen billId={null} />;
}
