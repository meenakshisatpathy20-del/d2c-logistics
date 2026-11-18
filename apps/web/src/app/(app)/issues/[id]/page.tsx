import type { Metadata } from "next";
import { Suspense } from "react";
import { IssueRoom } from "./issue-room";

export const metadata: Metadata = { title: "Issue" };

async function Room({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IssueRoom id={id} />;
}

export default function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Room params={params} />
    </Suspense>
  );
}
