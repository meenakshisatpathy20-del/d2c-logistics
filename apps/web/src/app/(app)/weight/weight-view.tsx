"use client";

import { AllClear, NeedsYouCard } from "@/components/home/needs-you";
import { Card } from "@/components/ui/primitives";
import { getToday } from "@/lib/api";
import { useLive } from "@/lib/use-live";

export function WeightView() {
  const { data, refresh } = useLive(getToday, 30_000);
  if (!data) return <Card className="h-40 animate-pulse" />;
  const disputes = data.needsYou.filter((n) => n.type === "WEIGHT_DISPUTE");
  return disputes.length === 0 ? (
    <AllClear />
  ) : (
    <ul className="grid gap-3 lg:grid-cols-2">
      {disputes.map((d) => (
        <li key={d.id}>
          <NeedsYouCard item={d} onChanged={refresh} />
        </li>
      ))}
    </ul>
  );
}
