import type { Metadata } from "next";
import { Suspense } from "react";
import { PartnerIssue } from "./partner-issue";

export const metadata: Metadata = { title: "Issue" };

async function Issue({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartnerIssue id={id} />;
}

export default function PartnerIssuePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Issue params={params} />
    </Suspense>
  );
}
