"use client";

import { Card, DemoBadge } from "@/components/ui/primitives";
import { getPayments } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { useLive } from "@/lib/use-live";
import { PaymentGuardPanel } from "./payment-guard";

export function PaymentsView() {
  const { data } = useLive(getPayments, 60_000);
  if (!data) return <Card className="h-48 animate-pulse" />;
  const tiles = [
    { label: "COD with couriers", value: data.codOnTheWay.amount, sub: `${data.codOnTheWay.orders} parcels on the way`, dot: "bg-brand-blue" },
    { label: "COD collected, to be remitted", value: data.codDelivered.amount, sub: `${data.codDelivered.orders} delivered COD orders`, dot: "bg-brand-amber" },
    { label: "Advances held", value: data.advances.held.amount, sub: `${data.advances.held.orders} COD orders paid ₹49 / ₹99 online`, dot: "bg-brand-green" },
    { label: "Freight, last 30 days", value: data.freight30d.amount, sub: `${data.freight30d.shipments} shipments`, dot: "bg-brand-orange" },
  ];
  return (
    <>
      <PaymentGuardPanel />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <span className={`size-2 rounded-full ${t.dot}`} /> {t.label}
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-navy">{formatINR(t.value)}</div>
            <div className="mt-0.5 text-[12px] text-muted">{t.sub}</div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Advance COD</h2>
          <p className="mt-1 text-[13px] text-muted">₹49 below ₹1,000 and ₹99 from ₹1,000, paid online at checkout. The courier collects only the balance.</p>
          <dl className="mt-4 space-y-2 text-[13px]">
            {(
              [
                ["Held (parcel on the way)", data.advances.held],
                ["Adjusted against delivered orders", data.advances.adjusted],
                ["Refunded (cancelled before dispatch)", data.advances.refunded],
                ["Kept (customer refused, RTO)", data.advances.forfeited],
              ] as const
            ).map(([label, m]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted">{label}</dt>
                <dd className="font-medium text-ink">
                  {formatINR(m.amount)} <span className="text-xs font-normal text-muted">· {m.orders}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Remittance and wallet</h2>
            <DemoBadge />
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Courier COD remittance dates, wallet recharge and invoices connect when live courier accounts are added. Until then the amounts above come
            from our own orders.
          </p>
        </Card>
      </div>
    </>
  );
}
