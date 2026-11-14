import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderDetailView } from "./order-detail";

export const metadata: Metadata = { title: "Order" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailView id={decodeURIComponent(id)} />;
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Detail params={params} />
    </Suspense>
  );
}
