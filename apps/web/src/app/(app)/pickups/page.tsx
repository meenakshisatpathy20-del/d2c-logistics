import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { PickupsView } from "./pickups-view";

export const metadata: Metadata = { title: "Pickups" };

export default function PickupsPage() {
  return (
    <>
      <PageHeader
        title="Pickups"
        subtitle="2-hour slots. Couriers confirm 2 hours before or the parcels move to the most reliable courier. Postpone in one click; no pickups on Sundays or holidays."
      />
      <PickupsView />
    </>
  );
}
