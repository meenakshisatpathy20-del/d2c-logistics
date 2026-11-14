import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { PickupsView } from "./pickups-view";

export const metadata: Metadata = { title: "Pickups" };

export default function PickupsPage() {
  return (
    <>
      <PageHeader
        title="Pickups"
        subtitle="2-hour slots. Each courier confirms 2 hours before; if not, parcels move to the most reliable courier. No pickups on Sundays or holidays."
      />
      <PickupsView />
    </>
  );
}
