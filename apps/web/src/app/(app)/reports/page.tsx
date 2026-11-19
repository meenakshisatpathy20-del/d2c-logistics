import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" subtitle="The 9 pm daily summary, what open problems cost per courier, delivery outcomes and our brands." />
      <ReportsView />
    </>
  );
}
