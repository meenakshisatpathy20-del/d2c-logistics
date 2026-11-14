"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { Timeline } from "@/app/(app)/today-view";
import { Card, DemoBadge } from "@/components/ui/primitives";
import { type CourierInfo, getCouriers, getToday } from "@/lib/api";
import { useLive } from "@/lib/use-live";

export function PickupsView() {
  const { data } = useLive(getToday, 30_000);
  const [couriers, setCouriers] = useState<CourierInfo[] | null>(null);
  useEffect(() => {
    getCouriers().then((c) => setCouriers([...c].sort((a, b) => (b.pickupOnTimePct ?? 0) - (a.pickupOnTimePct ?? 0))), () => {});
  }, []);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
      {data ? <Timeline data={data} /> : <Card className="h-64 animate-pulse" />}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Pickup reliability</h2>
          <DemoBadge />
        </div>
        <Card className="divide-y divide-line">
          {(couriers ?? []).map((c) => {
            const pct = c.pickupOnTimePct ?? 0;
            const weak = pct < 85;
            return (
              <div key={c.code} className="px-4 py-3">
                <div className="flex items-center justify-between text-[13.5px]">
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className={clsx("font-semibold tabular-nums", weak ? "text-flag-red" : "text-ink")}>{pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-page">
                  <div className={clsx("h-1.5 rounded-full", weak ? "bg-flag-red" : "bg-brand-green")} style={{ width: `${pct}%` }} />
                </div>
                {weak ? <p className="mt-1 text-[11.5px] text-flag-red">Below 85%: never recommended over a reliable courier</p> : null}
              </div>
            );
          })}
        </Card>
        <p className="mt-2 text-xs text-muted">Share of pickups done inside the agreed slot. Recommendations use the cheapest courier at 85% or above.</p>
      </section>
    </div>
  );
}
