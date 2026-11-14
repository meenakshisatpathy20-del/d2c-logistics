import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { OrdersView } from "@/components/orders/orders-view";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <>
      <PageHeader title="Orders" subtitle="Every order across our brands, by status. Click a row for its full journey." />
      <Suspense>
        <OrdersView />
      </Suspense>
    </>
  );
}
