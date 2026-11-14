import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { OrdersView } from "@/components/orders/orders-view";

export const metadata: Metadata = { title: "NDR & Returns" };

export default function NdrPage() {
  return (
    <>
      <PageHeader
        title="NDR & Returns"
        subtitle="Failed deliveries, stuck parcels and returns. Each has one owner and a deadline; act from the order."
      />
      <Suspense>
        <OrdersView tabs={["ATTENTION", "RTO"]} defaultTab="ATTENTION" allowBoard={false} />
      </Suspense>
    </>
  );
}
