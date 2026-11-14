import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" subtitle="How our brands and couriers are doing. Courier scorecards and the daily 9 pm summary come next." />
      <ReportsView />
    </>
  );
}
