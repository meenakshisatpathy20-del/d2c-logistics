import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, Clock, Download, PackagePlus, Siren, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge, Button, Card, CardHeader, DemoBadge, type Tone } from "@/components/ui/primitives";
import { BrandLogo } from "@/components/ui/logo";
import { BRANDS_TODAY, CONTROL_TOWER_KPIS, COURIER_SCORES, RED_FLAGS, TODAY_PICKUPS } from "@/lib/sample-data";

export const metadata: Metadata = { title: "Control Tower" };

const kpiAccent: Record<Tone, string> = {
  orange: "bg-brand-orange",
  blue: "bg-brand-blue",
  green: "bg-brand-green",
  amber: "bg-brand-amber",
  red: "bg-flag-red",
  grey: "bg-faint",
};

function scoreTone(pct: number): string {
  if (pct >= 90) return "bg-brand-green";
  if (pct >= 80) return "bg-brand-amber";
  return "bg-flag-red";
}

export default function ControlTowerPage() {
  return (
    <>
      <PageHeader
        title="Control Tower"
        subtitle="Everything moving today, in one view. Updates live as couriers scan."
        actions={
          <>
            <Button variant="secondary">
              <Download size={16} /> Today&apos;s summary
            </Button>
            <Link href="/orders/new">
              <Button>
                <PackagePlus size={16} /> Book shipment
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-brand-amber/30 bg-brand-amber-soft px-4 py-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-brand-amber" />
        <p className="text-[13.5px] text-ink-2">
          <span className="font-semibold text-ink">Disruption · Gujarat:</span> courier hubs report diesel shortage
          delays. 3 shipments to Gujarat pin codes may arrive 1–2 days late; customers have been told.
        </p>
      </div>

      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {CONTROL_TOWER_KPIS.map((k) => (
          <Card key={k.label} className="relative overflow-hidden p-4">
            <span className={clsx("absolute inset-x-0 top-0 h-1", kpiAccent[k.tone])} aria-hidden />
            <div className="text-[12.5px] font-medium text-muted">{k.label}</div>
            <div className="mt-1.5 font-display text-[28px] font-bold leading-none text-navy">{k.value}</div>
            <div className="mt-2 text-xs text-muted">{k.sub}</div>
          </Card>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Red flags"
            subtitle="Raised automatically. Each has one owner and escalates if it is not resolved in time."
            action={<Badge tone="red" dot>4 open</Badge>}
          />
          <ul className="divide-y divide-line">
            {RED_FLAGS.map((f) => (
              <li key={f.id} className="flex gap-4 px-5 py-4">
                <span
                  className={clsx(
                    "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg",
                    f.severity === "critical" ? "bg-flag-red-soft text-flag-red" : "bg-brand-amber-soft text-brand-amber",
                  )}
                >
                  <Siren size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{f.title}</span>
                    <Badge tone={f.severity === "critical" ? "red" : "amber"}>
                      {f.severity === "critical" ? "Critical" : "Warning"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">{f.detail}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
                    <span className="inline-flex items-center gap-1">
                      <UserRound size={13} /> {f.owner}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={13} /> {f.age} open
                    </span>
                    <span className="font-medium text-brand-orange-dark">{f.escalation}</span>
                  </div>
                </div>
                <Button variant="secondary" size="sm" className="self-center">
                  Open <ArrowUpRight size={14} />
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Today's pickups"
            subtitle="Couriers must confirm 2 hours before each slot."
            action={<DemoBadge />}
          />
          <ul className="divide-y divide-line">
            {TODAY_PICKUPS.map((p) => (
              <li key={p.vendor} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{p.vendor}</span>
                  <span className="text-xs text-muted">{p.slot}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] text-muted">
                    {p.courier} · {p.parcels} parcels · {p.cluster}
                  </span>
                  <Badge tone={p.tone} dot>
                    {p.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader
          title="Courier scorecard"
          subtitle="From our own shipments, last 30 days. Couriers that miss pickups get fewer orders automatically."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-5 py-3">Courier</th>
                <th className="px-5 py-3">Pickup on time</th>
                <th className="px-5 py-3">Delivered on time</th>
                <th className="px-5 py-3 text-right">RTO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COURIER_SCORES.map((c) => (
                <tr key={c.courier}>
                  <td className="px-5 py-3 font-medium text-ink">{c.courier}</td>
                  {[c.pickupOnTime, c.deliveredOnTime].map((v, i) => (
                    <td key={i} className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 w-28 rounded-full bg-page">
                          <div className={clsx("h-1.5 rounded-full", scoreTone(v))} style={{ width: `${v}%` }} />
                        </div>
                        <span className="tabular-nums text-ink-2">{v}%</span>
                      </div>
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right tabular-nums text-ink-2">{c.rto}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Today by brand" subtitle="Orders received and shipped for our brands." />
        <ul className="divide-y divide-line">
          {BRANDS_TODAY.map((b) => (
            <li key={b.slug} className="flex items-center gap-4 px-5 py-3">
              <span className="grid h-10 w-24 shrink-0 place-items-center rounded-lg border border-line bg-white px-2">
                <BrandLogo slug={b.slug} name={b.name} className="max-h-8" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{b.name}</span>
                <span className="mt-1 block h-1.5 rounded-full bg-page">
                  <span
                    className="block h-1.5 rounded-full bg-brand-green"
                    style={{ width: `${Math.round((b.shipped / b.orders) * 100)}%` }}
                  />
                </span>
              </span>
              <span className="text-right text-xs text-muted">
                <span className="block text-sm font-semibold tabular-nums text-ink">
                  {b.shipped}/{b.orders}
                </span>
                shipped
              </span>
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </>
  );
}
