import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" subtitle="The 9 pm daily summary, delivery outcomes and our brands. Courier scorecards come next." />
      <ReportsView />
    </>
  );
}
