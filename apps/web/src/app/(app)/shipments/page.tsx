import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { JourneyBoard } from "./journey-board";
import { NewShipmentButton } from "./new-shipment-button";

export const metadata: Metadata = { title: "Shipments" };

export default function ShipmentsPage() {
  return (
    <>
      <PageHeader
        title="Shipments"
        subtitle="Every parcel's journey, left to right. Anything stuck, failed or late is pinned first, with its owner."
        actions={<NewShipmentButton />}
      />
      <JourneyBoard />
    </>
  );
}
