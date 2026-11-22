"use client";

import { ArrowLeft, Camera, Printer } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { getReviewPack } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The review pack for one courier: every breach with when and the proof, to send and to walk through on the weekly call. */
export function ReviewPackView({ code }: { code: string }) {
  const [days, setDays] = useState<7 | 30>(7);
  const load = useCallback(() => getReviewPack(code, days), [code, days]);
  const { data, error } = useLive(load, 120_000);

  if (error) return <p className="text-flag-red">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const c = data.card;
  const facts: [string, string][] = [
    ["Pickups on time", c.pickups.pct === null ? `${c.pickups.onTime} of ${c.pickups.due}` : `${c.pickups.pct}% (${c.pickups.onTime} of ${c.pickups.due})`],
    ["Delivered on time", c.deliveries.pct === null ? `${c.deliveries.onTime} of ${c.deliveries.done}` : `${c.deliveries.pct}% (${c.deliveries.onTime} of ${c.deliveries.done})`],
    ["Answered within 2 h", `${c.issues.answeredInTime} of ${c.issues.askedOfThem}`],
    ["Reminders ignored", String(c.issues.remindersIgnored)],
    ["Promises broken", `${c.issues.promisesBroken} of ${c.issues.promisesMade} made`],
    ["Waiting on them now", String(c.issues.waitingOnThem)],
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft size={15} /> Reports
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-[12.5px]">
            {([7, 30] as const).map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-2.5 py-1 font-medium ${days === d ? "bg-navy text-white" : "text-ink-2"}`}>
                {d === 7 ? "This week" : "30 days"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer size={14} /> Print or save PDF
          </Button>
        </div>
      </div>

      <h1 className="font-display text-[26px] font-bold text-navy">{data.courier.name}: review pack</h1>
      <p className="mt-1 text-[14px] text-muted">
        {day(data.period.from)} to {day(data.period.to)} · from our own records: pickups, scans and issue rooms. Score {c.score ?? "–"}/100.
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-white px-4 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <Section title="Pickups missed, not confirmed or late" empty="None this period." count={data.pickups.length}>
        {data.pickups.map((p, i) => (
          <Row key={i} left={`${when(p.when)} · ${p.vendor} · ${p.slot} · ${p.parcels} parcel${p.parcels === 1 ? "" : "s"}`} right={p.what} />
        ))}
      </Section>

      <Section title="Deliveries past the promised date" empty="None this period." count={data.lateDeliveries.length}>
        {data.lateDeliveries.map((d) => (
          <Row
            key={d.awb}
            left={`AWB ${d.awb} · #${d.order} · ${d.city}`}
            right={`Promised ${day(d.promised)} · ${d.delivered ? `delivered ${day(d.delivered)}` : "not delivered yet"} · ${d.daysLate} day${d.daysLate > 1 ? "s" : ""} late`}
          />
        ))}
      </Section>

      <Section title="Reminders ignored" empty="None this period." count={data.ignored.length}>
        {data.ignored.map((x) => (
          <Row key={x.id} href={`/issues/${x.id}`} left={`${x.title} · ${x.about}`} right={`${x.reminders} reminder${x.reminders > 1 ? "s" : ""}${x.open ? " · still open" : ""}`} />
        ))}
      </Section>

      <Section title="Promises broken" empty="None this period." count={data.brokenPromises.length}>
        {data.brokenPromises.map((x, i) => (
          <Row key={i} href={`/issues/${x.id}`} left={`${x.title} · ${x.about}`} right={x.what} />
        ))}
      </Section>

      <Section title={'"Warehouse closed" and other pickup claims'} empty="None this period." count={data.claims.length}>
        {data.claims.map((x) => (
          <Row
            key={x.id}
            href={`/issues/${x.id}`}
            left={`${x.title} · ${x.about}`}
            right={
              <span className="inline-flex items-center gap-1">
                {x.withPhoto ? <Camera size={13} /> : null}
                {x.withPhoto ? "With photo" : "No photo"}
                {x.hoursCheck ? ` · ${x.hoursCheck.includes("inside") ? "slot was inside vendor hours" : "slot was outside vendor hours"}` : ""}
                {x.outcome ? ` · ${x.outcome}` : ""}
              </span>
            }
          />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, count, children }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <Card className="mt-5 overflow-hidden break-inside-avoid">
      <h2 className="border-b border-line px-5 py-3 text-[14.5px] font-semibold text-ink">
        {title} <span className="font-normal text-muted">· {count}</span>
      </h2>
      {count ? <ul className="divide-y divide-line">{children}</ul> : <p className="px-5 py-4 text-[13px] text-muted">{empty}</p>}
    </Card>
  );
}

function Row({ left, right, href }: { left: string; right: React.ReactNode; href?: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-5 py-2.5 text-[13px]">
      {href ? (
        <Link href={href} className="text-ink hover:text-brand-blue hover:underline">
          {left}
        </Link>
      ) : (
        <span className="text-ink">{left}</span>
      )}
      <span className="text-ink-2">{right}</span>
    </li>
  );
}
