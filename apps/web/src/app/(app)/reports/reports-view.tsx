"use client";

import { Card } from "@/components/ui/primitives";
import { getOrders, getToday } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const loadCounts = () => getOrders({ size: 5 });

export function ReportsView() {
  const { data: today } = useLive(getToday, 60_000);
  const { data: orders } = useLive(loadCounts, 60_000);
  const c = orders?.counts;
  const finished = c ? c.DELIVERED + c.RTO : 0;
  const rtoPct = c && finished ? Math.round((c.RTO / finished) * 100) : 0;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Delivery outcome</h2>
        {c ? (
          <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
            <Stat label="Delivered" value={String(c.DELIVERED)} />
            <Stat label="Returned (RTO)" value={String(c.RTO)} />
            <Stat label="RTO rate" value={`${rtoPct}%`} warn={rtoPct > 10} />
          </dl>
        ) : null}
      </Card>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Our brands today</h2>
        <table className="mt-3 w-full text-[13px]">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1.5">Brand</th>
              <th className="py-1.5 text-right">Ordered</th>
              <th className="py-1.5 text-right">Shipped</th>
            </tr>
          </thead>
          <tbody>
            {(today?.brands ?? []).map((b) => (
              <tr key={b.name} className="border-t border-line">
                <td className="py-2 font-medium text-ink">{b.name}</td>
                <td className="py-2 text-right tabular-nums">{b.orders}</td>
                <td className="py-2 text-right tabular-nums">{b.shipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-page p-3">
      <dd className={`font-display text-2xl font-bold ${warn ? "text-flag-red" : "text-navy"}`}>{value}</dd>
      <dt className="mt-0.5 text-xs text-muted">{label}</dt>
    </div>
  );
}
