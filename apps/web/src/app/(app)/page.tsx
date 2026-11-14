import clsx from "clsx";
import { AlertTriangle, ArrowRight, Check, CircleDashed, Clock, Siren, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { BrandLogo } from "@/components/ui/logo";
import { Badge, Card, DemoBadge, type Tone } from "@/components/ui/primitives";
import { BRANDS_TODAY, NEEDS_YOU, NOW_HOUR, PICKUP_TIMELINE, PULSE, type SlotStatus } from "@/lib/sample-data";

export const metadata: Metadata = { title: "Today" };

const START = 10;
const END = 18;
const pct = (h: number) => `${((h - START) / (END - START)) * 100}%`;

const slotStyle: Record<SlotStatus, string> = {
  done: "bg-brand-green-soft border-brand-green/40 text-[#0e6e05]",
  confirmed: "bg-brand-blue-soft border-brand-blue/40 text-brand-blue",
  waiting: "bg-brand-amber-soft border-dashed border-brand-amber text-[#b54708]",
  missed: "bg-flag-red-soft border-flag-red/50 text-flag-red",
  scheduled: "bg-white border-line text-ink-2",
};

const slotIcon: Record<SlotStatus, typeof Check> = {
  done: Check,
  confirmed: Check,
  waiting: Clock,
  missed: X,
  scheduled: CircleDashed,
};

const pulseDot: Record<Tone, string> = {
  orange: "bg-brand-orange",
  blue: "bg-brand-blue",
  green: "bg-brand-green",
  amber: "bg-brand-amber",
  red: "bg-flag-red",
  grey: "bg-faint",
};

export default function TodayPage() {
  return (
    <>
      <PageHeader
        title="Good afternoon"
        subtitle={
          <>
            Friday, 14 November · <span className="font-medium text-ink">14 pickups today, 9 done</span> ·{" "}
            <span className="font-medium text-flag-red">4 things need you</span>
          </>
        }
      />

      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-brand-amber/30 bg-brand-amber-soft px-4 py-3">
        <AlertTriangle size={18} className="shrink-0 text-brand-amber" />
        <p className="flex-1 text-[13.5px] text-ink-2">
          <span className="font-semibold text-ink">Gujarat:</span> diesel shortage at courier hubs. 3 shipments may be 1–2 days
          late. Customers have been told automatically.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_1fr] [&>*]:min-w-0">
        <section aria-labelledby="needs-you">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="needs-you" className="text-[15px] font-semibold text-ink">
              Needs you
            </h2>
            <span className="text-xs text-muted">Oldest first · each has one owner</span>
          </div>
          <ul className="space-y-3">
            {NEEDS_YOU.map((n) => (
              <li key={n.id}>
                <Card className="group p-4 transition-shadow hover:shadow-md">
                  <div className="flex gap-3">
                    <span
                      className={clsx(
                        "grid size-9 shrink-0 place-items-center rounded-xl",
                        n.severity === "critical" ? "bg-flag-red-soft text-flag-red" : "bg-brand-amber-soft text-brand-amber",
                      )}
                    >
                      <Siren size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink">{n.title}</div>
                      <div className="mt-0.5 truncate text-[13px] text-muted">{n.detail}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between pl-12">
                    <span
                      className={clsx(
                        "text-xs font-medium",
                        n.severity === "critical" ? "text-flag-red" : "text-[#b54708]",
                      )}
                    >
                      {n.due}
                    </span>
                    <Link
                      href={n.href}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-navy-2"
                    >
                      {n.action} <ArrowRight size={13} />
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pickups">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="pickups" className="text-[15px] font-semibold text-ink">
              Pickups today
            </h2>
            <DemoBadge />
          </div>
          <Card className="p-5">
            <div className="overflow-x-auto">
              <div className="relative min-w-[560px]">
                <div className="grid grid-cols-[150px_1fr] gap-x-4">
                  <div />
                  <div className="relative mb-2 h-5 text-[11px] text-muted">
                    {[10, 12, 14, 16, 18].map((h) => (
                      <span
                        key={h}
                        className={clsx("absolute whitespace-nowrap", h === START ? "" : h === END ? "-translate-x-full" : "-translate-x-1/2")}
                        style={{ left: pct(h) }}
                      >
                        {h > 12 ? `${h - 12} pm` : h === 12 ? "12 pm" : `${h} am`}
                      </span>
                    ))}
                  </div>
                </div>

                {PICKUP_TIMELINE.map((row) => (
                  <div key={row.vendor} className="grid grid-cols-[150px_1fr] gap-x-4 border-t border-line">
                    <div className="flex flex-col justify-center py-3">
                      <span className="truncate text-sm font-medium text-ink">{row.vendor}</span>
                      <span className="text-xs text-muted">{row.area}</span>
                    </div>
                    <div className="relative py-3">
                      {[12, 14, 16].map((h) => (
                        <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(h) }} aria-hidden />
                      ))}
                      <div className="relative h-12">
                        {row.slots.map((s) => {
                          const Icon = slotIcon[s.status];
                          return (
                            <div
                              key={`${s.start}-${s.courier}`}
                              className={clsx(
                                "absolute inset-y-0 flex flex-col justify-center overflow-hidden rounded-xl border px-2.5",
                                slotStyle[s.status],
                              )}
                              style={{
                                left: `calc(${pct(s.start)} + 2px)`,
                                width: `calc(${((s.end - s.start) / (END - START)) * 100}% - 4px)`,
                              }}
                              title={`${s.courier} · ${s.parcels} parcels · ${s.label}`}
                            >
                              <span className="flex items-center gap-1 truncate text-[12px] font-semibold">
                                <Icon size={12} className="shrink-0" /> {s.label}
                              </span>
                              <span className="truncate text-[11px] opacity-80">
                                {s.courier} · {s.parcels} parcels
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}

                {/* "Now" line across every vendor row: track starts after the 150px label + 16px gap */}
                <div className="pointer-events-none absolute inset-y-0 left-[166px] right-0" aria-hidden>
                  <span className="absolute bottom-0 top-6 w-0.5 -translate-x-1/2 rounded-full bg-flag-red/70" style={{ left: pct(NOW_HOUR) }} />
                  <span
                    className="absolute -bottom-6 -translate-x-1/2 whitespace-nowrap rounded-full bg-flag-red px-2 py-0.5 text-[10.5px] font-semibold text-white"
                    style={{ left: pct(NOW_HOUR) }}
                  >
                    Now 1:30 pm
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
              <Legend className="bg-brand-green" label="Picked up" />
              <Legend className="bg-brand-blue" label="Courier confirmed" />
              <Legend className="bg-brand-amber" label="Awaiting confirmation (2 h before)" />
              <Legend className="bg-flag-red" label="Missed, moved to backup" />
              <Legend className="border border-faint bg-white" label="Scheduled" />
            </div>
          </Card>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[400px_1fr] [&>*]:min-w-0">
        <Card className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden">
          {PULSE.map((p) => (
            <div key={p.label} className="p-4">
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <span className={clsx("size-2 rounded-full", pulseDot[p.tone])} />
                {p.label}
              </div>
              <div className="mt-1 font-display text-2xl font-bold text-navy">{p.value}</div>
            </div>
          ))}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Our brands today</h2>
            <span className="text-xs text-muted">Shipped / ordered</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {BRANDS_TODAY.map((b) => {
              const done = Math.round((b.shipped / b.orders) * 100);
              return (
                <div key={b.slug} className="rounded-xl border border-line p-3">
                  <div className="grid h-10 place-items-center">
                    <BrandLogo slug={b.slug} name={b.name} className="max-h-9" />
                  </div>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {b.shipped}/{b.orders}
                    </span>
                    <Badge tone={done === 100 ? "green" : "grey"}>{done}%</Badge>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-page">
                    <div className="h-1.5 rounded-full bg-brand-green" style={{ width: `${done}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx("size-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}
