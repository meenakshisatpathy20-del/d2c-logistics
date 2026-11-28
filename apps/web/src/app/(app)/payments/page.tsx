import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Payments & COD" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments & COD" subtitle="Orders held until their money is really ours, cash the couriers are carrying, advances paid at checkout, and what shipping cost." />
      <Suspense>
        <PaymentsView />
      </Suspense>
    </>
  );
}
