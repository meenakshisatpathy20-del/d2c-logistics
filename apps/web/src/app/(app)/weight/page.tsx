import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { WeightView } from "./weight-view";

export const metadata: Metadata = { title: "Weight disputes" };

export default function WeightPage() {
  return (
    <>
      <PageHeader
        title="Weight disputes"
        subtitle="When a courier weighs a parcel heavier than we declared, a dispute opens for Finance with the packing details as proof."
      />
      <WeightView />
    </>
  );
}
