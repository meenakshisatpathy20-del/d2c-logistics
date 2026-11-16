"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { useShell } from "@/components/shell/app-shell";
import { Card, DemoBadge } from "@/components/ui/primitives";
import { getLatestSummary, getOrders, getToday, sendSummaryNow, type Summary } from "@/lib/api";
import { formatINR } from "@/lib/format";
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
      <DailySummaryCard />
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
            {today && today.brands.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted">
                  No new orders yet today.
                </td>
              </tr>
            ) : null}
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

function DailySummaryCard() {
  const { me } = useShell();
  const { data, refresh } = useLive(getLatestSummary, 60_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = (data as Summary)?.data;
  return (
    <Card className="p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Daily summary {data ? <span className="font-normal text-muted">· {data.day}</span> : null}</h2>
          <p className="mt-0.5 text-[13px] text-muted">Sent to management every day at 9 pm on WhatsApp and email.</p>
        </div>
        <span className="flex items-center gap-2">
          <DemoBadge />
          {me?.role === "ADMIN" ? (
            <button
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await sendSummaryNow();
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-[13px] font-medium text-white hover:bg-navy-2 disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send today’s now
            </button>
          ) : null}
        </span>
      </div>
      {error ? <p className="mt-2 text-[13px] text-flag-red">{error}</p> : null}
      {!s ? (
        <p className="mt-4 text-sm text-muted">No summary yet. The first one goes out at 9 pm.</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="Booked" value={String(s.booked)} />
            <Stat label="Picked up" value={String(s.pickedUp)} />
            <Stat label="Delivered" value={String(s.delivered)} />
            <Stat label="RTO started" value={String(s.rtoStarted)} warn={s.rtoStarted > 0} />
            <Stat label="Pickups done" value={`${s.pickups.done}/${s.pickups.due}`} />
            <Stat label="Stuck 48 h+" value={String(s.stuck)} warn={s.stuck > 0} />
            <Stat label="Red flags open" value={String(s.redFlagsOpen)} warn={s.critical > 0} />
            <Stat label="COD with couriers" value={formatINR(s.codPending)} />
          </dl>
          {s.topProblems.length ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Top problems</p>
              <ol className="mt-2 space-y-1 text-[13px] text-ink-2">
                {s.topProblems.map((p, i) => (
                  <li key={i}>
                    {i + 1}. <span className="font-medium text-ink">{p.title}</span> · {p.owner}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
