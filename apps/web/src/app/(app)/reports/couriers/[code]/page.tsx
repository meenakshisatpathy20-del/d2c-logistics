import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewPackView } from "./review-pack";

export const metadata: Metadata = { title: "Courier review pack" };

async function Pack({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ReviewPackView code={code} />;
}

export default function ReviewPackPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense>
      <Pack params={params} />
    </Suspense>
  );
}
