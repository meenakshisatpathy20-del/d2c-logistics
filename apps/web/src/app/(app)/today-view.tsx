"use client";

import clsx from "clsx";
import { ArrowRight, Check, CircleDashed, Clock, Loader2, X } from "lucide-react";
import Link from "next/link";
import { AllClear, NeedsYouCard } from "@/components/home/needs-you";
import { StepCards } from "@/components/home/step-cards";
import { BrandLogo, OUR_BRANDS } from "@/components/ui/logo";
import { Badge, Card, DemoBadge } from "@/components/ui/primitives";
import { getToday, type SlotState, type TodayData } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { useLive } from "@/lib/use-live";

const START = 10;
const END = 18;
const pct = (h: number) => `${((Math.min(Math.max(h, START), END) - START) / (END - START)) * 100}%`;

const slotStyle: Record<SlotState, string> = {
  done: "bg-brand-green-soft border-brand-green/40 text-[#0e6e05]",
  confirmed: "bg-brand-blue-soft border-brand-blue/40 text-brand-blue",
  waiting: "bg-brand-amber-soft border-dashed border-brand-amber text-[#b54708]",
  missed: "bg-flag-red-soft border-flag-red/50 text-flag-red",
  scheduled: "bg-white border-line text-ink-2",
};
const slotIcon: Record<SlotState, typeof Check> = {
  done: Check,
  confirmed: Check,
  waiting: Clock,
  missed: X,
  scheduled: CircleDashed,
};

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const brandSlug = (name: string) => OUR_BRANDS.find((b) => b.name === name)?.slug;

export function TodayView() {
  const { data, error, refresh } = useLive(getToday, 30_000);

  if (error && !data) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-flag-red">Couldn&apos;t load today: {error}</p>
        <p className="mt-1 text-xs text-muted">It retries every 30 seconds.</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
        <Loader2 size={18} className="animate-spin" /> Loading today…
      </div>
    );
  }

  const date = new Date(data.now).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <div className="mb-5">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-navy">{greeting(data.nowHour)}</h1>
        <p className="mt-1 text-[14px] text-muted">
          {date} ·{" "}
          <span className="font-medium text-ink">
            {data.summary.pickupsDue} pickups today, {data.summary.pickupsDone} done
          </span>{" "}
          ·{" "}
          <span className={clsx("font-medium", data.summary.needsYou ? "text-flag-red" : "text-[#0e6e05]")}>
            {data.summary.needsYou ? `${data.summary.needsYou} need${data.summary.needsYou === 1 ? "s" : ""} you` : "nothing needs you"}
          </span>
        </p>
      </div>

      <StepCards pulse={data.pulse} />

      <div className="grid gap-6 xl:grid-cols-[400px_1fr] [&>*]:min-w-0">
        <NeedsYou items={data.needsYou} onChanged={refresh} />
        <Timeline data={data} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[400px_1fr] [&>*]:min-w-0">
        <Card className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden">
          <Pulse dot="bg-brand-blue" label="Moving now" value={String(data.pulse.moving)} />
          <Pulse dot="bg-brand-green" label="Out for delivery" value={String(data.pulse.outToday)} />
          <Pulse dot="bg-brand-green" label="Delivered today" value={String(data.pulse.deliveredToday)} />
          <Pulse
            dot="bg-brand-amber"
            label={`COD to collect · ${data.pulse.codOrders}`}
            value={formatINR(data.pulse.codToCollect)}
            sub={data.pulse.advanceOrders ? `${formatINR(data.pulse.advancesHeld)} advances already paid` : undefined}
          />
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Our brands today</h2>
            <span className="text-xs text-muted">Shipped / ordered today</span>
          </div>
          {data.brands.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No orders yet today.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {data.brands.slice(0, 5).map((b) => {
                const done = b.orders ? Math.round((b.shipped / b.orders) * 100) : 0;
                const slug = brandSlug(b.name);
                return (
                  <div key={b.name} className="rounded-xl border border-line p-3">
                    <div className="grid h-10 place-items-center">
                      {slug ? (
                        <BrandLogo slug={slug} name={b.name} className="max-h-9" />
                      ) : (
                        <span className="text-sm font-semibold text-ink">{b.name}</span>
                      )}
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
          )}
        </Card>
      </div>
    </>
  );
}

function NeedsYou({ items, onChanged }: { items: TodayData["needsYou"]; onChanged: () => void }) {
  const open = items.filter((n) => !n.acted).length;
  return (
    <section aria-labelledby="needs-you">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="needs-you" className="text-[15px] font-semibold text-ink">
          Needs you {open ? <span className="ml-1 rounded-full bg-flag-red px-1.5 text-[11px] font-bold text-white">{open}</span> : null}
        </h2>
        <span className="text-xs text-muted">Critical first · each has one owner</span>
      </div>
      {items.length === 0 ? (
        <AllClear />
      ) : (
        <ul className="space-y-3">
          {items.slice(0, 5).map((n) => (
            <li key={n.id}>
              <NeedsYouCard item={n} onChanged={onChanged} />
            </li>
          ))}
          {items.length > 5 ? (
            <li>
              <Link href="/ndr" className="flex items-center justify-center gap-1 text-[13px] font-medium text-brand-blue hover:underline">
                See all {items.length} in NDR &amp; Returns <ArrowRight size={13} />
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function Timeline({ data }: { data: TodayData }) {
  const showNow = data.nowHour >= START && data.nowHour <= END;
  const nowText = new Date(data.now).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  return (
    <section aria-labelledby="pickups">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="pickups" className="text-[15px] font-semibold text-ink">
          Pickups today
        </h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          Tap a slot for its manifest <DemoBadge />
        </span>
      </div>
      <Card className="p-5">
        {data.pickups.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No pickups booked for today yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="relative min-w-[560px] pb-7">
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
              {data.pickups.map((row) => (
                <div key={row.vendor} className="grid grid-cols-[150px_1fr] gap-x-4 border-t border-line">
                  <div className="flex flex-col justify-center py-3">
                    <span className="truncate text-sm font-medium text-ink">{row.vendor}</span>
                    <span className="text-xs text-muted">{row.area}</span>
                  </div>
                  <div className="relative py-3">
                    {[12, 14, 16].map((h) => (
                      <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(h) }} aria-hidden />
                    ))}
                    <div className="relative" style={{ height: `${Math.max(1, overlapDepth(row.slots)) * 52}px` }}>
                      {row.slots.map((s, i) => {
                        const Icon = slotIcon[s.status];
                        const lane = laneIndex(row.slots, i);
                        return (
                          <a
                            key={s.id}
                            href={s.manifestUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={clsx(
                              "absolute flex h-12 flex-col justify-center overflow-hidden rounded-xl border px-2.5 transition-shadow hover:shadow-md",
                              slotStyle[s.status],
                            )}
                            style={{
                              top: lane * 52,
                              left: `calc(${pct(s.start)} + 2px)`,
                              width: `calc(${((s.end - s.start) / (END - START)) * 100}% - 4px)`,
                            }}
                            title={`${s.courier} · ${s.parcels} parcels · ${s.label} · open manifest`}
                          >
                            <span className="flex items-center gap-1 truncate text-[12px] font-semibold">
                              <Icon size={12} className="shrink-0" /> {s.label}
                            </span>
                            <span className="truncate text-[11px] opacity-80">
                              {s.courier} · {s.parcels} parcel{s.parcels === 1 ? "" : "s"}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {showNow ? (
                <div className="pointer-events-none absolute bottom-0 left-[166px] right-0 top-6" aria-hidden>
                  <span className="absolute bottom-6 top-0 w-0.5 -translate-x-1/2 rounded-full bg-flag-red/70" style={{ left: pct(data.nowHour) }} />
                  <span
                    className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-flag-red px-2 py-0.5 text-[10.5px] font-semibold text-white"
                    style={{ left: pct(data.nowHour) }}
                  >
                    Now {nowText}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
          <Legend className="bg-brand-green" label="Picked up" />
          <Legend className="bg-brand-blue" label="Courier confirmed" />
          <Legend className="bg-brand-amber" label="Awaiting confirmation (2 h before)" />
          <Legend className="bg-flag-red" label="Missed or not confirmed, moved" />
          <Legend className="border border-faint bg-white" label="Scheduled" />
        </div>
      </Card>
    </section>
  );
}

type Slot = TodayData["pickups"][number]["slots"][number];

/** Slots at the same time (e.g. a missed courier and its replacement) stack in rows. */
function laneIndex(slots: Slot[], i: number): number {
  return slots.slice(0, i).filter((s) => s.start < slots[i].end && slots[i].start < s.end).length;
}
function overlapDepth(slots: Slot[]): number {
  return slots.reduce((m, _, i) => Math.max(m, laneIndex(slots, i) + 1), 0);
}

export function Pulse({ dot, label, value, sub }: { dot: string; label: string; value: string; sub?: string }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className={clsx("size-2 rounded-full", dot)} />
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold text-navy">{value}</div>
      {sub ? <div className="mt-0.5 text-[11.5px] text-muted">{sub}</div> : null}
    </div>
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
