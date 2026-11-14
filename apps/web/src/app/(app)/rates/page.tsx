import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { RateCalculator } from "./rate-calculator";

export const metadata: Metadata = { title: "Rate calculator" };

export default function RatesPage() {
  return (
    <>
      <PageHeader title="Rate calculator" subtitle="Compare every courier for a parcel before you book: price, delivery days and pickup reliability." />
      <RateCalculator />
    </>
  );
}
