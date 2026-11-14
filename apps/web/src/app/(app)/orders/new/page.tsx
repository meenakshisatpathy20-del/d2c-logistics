import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { BookShipment } from "./book-shipment";

export const metadata: Metadata = { title: "Book shipment" };

export default function BookShipmentPage() {
  return (
    <>
      <PageHeader
        title="Book shipment"
        subtitle="One order at a time, or a whole CSV in one go. Three steps: details, courier, pickup slot."
      />
      <BookShipment />
    </>
  );
}
