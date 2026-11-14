import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Payments & COD" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments & COD" subtitle="Cash the couriers are carrying, what they owe us, advances paid at checkout, and what shipping cost." />
      <PaymentsView />
    </>
  );
}
