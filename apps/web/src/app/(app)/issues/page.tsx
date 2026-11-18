import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { IssuesInbox } from "./issues-inbox";

export const metadata: Metadata = { title: "Issues" };

export default function IssuesPage() {
  return (
    <>
      <PageHeader
        title="Issues"
        subtitle="Every problem in one place: who is on it from each side, whose turn it is, and what happened. Solved only when the parcel moves or the money is in."
      />
      <Suspense>
        <IssuesInbox />
      </Suspense>
    </>
  );
}
