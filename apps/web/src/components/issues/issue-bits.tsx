"use client";

import clsx from "clsx";
import { BellRing, Clock, Handshake, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type IssueRow, type Party, waited } from "@/lib/api";

export const PARTY_TONE: Record<string, string> = {
  OURS: "bg-brand-orange-soft text-brand-orange-dark",
  COURIER: "bg-brand-blue-soft text-brand-blue",
  VENDOR: "bg-brand-amber-soft text-[#b54708]",
  CUSTOMER: "bg-brand-green-soft text-[#0e6e05]",
  SYSTEM: "bg-page text-ink-2",
};
export const PARTY_NAME: Record<string, string> = { OURS: "Us", COURIER: "Courier", VENDOR: "Vendor", CUSTOMER: "Customer", SYSTEM: "System" };

/** "Waiting on Courier · Rohit S. · 3 h 20 m": whose turn it is, by name, and for how long. */
export function WaitingOn({ party, person, minutes, compact = false }: { party: Party | string; person: string; minutes: number; compact?: boolean }) {
  const long = minutes >= 120;
  return (
    <span className={clsx("inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium", PARTY_TONE[party])}>
      <Clock size={12} className="shrink-0" />
      <span className="truncate">
        Waiting on {party === "OURS" ? "us" : PARTY_NAME[party].toLowerCase()}
        {!compact ? ` · ${person}` : ""} · <span className={clsx(long && "font-bold")}>{waited(minutes)}</span>
      </span>
    </span>
  );
}

export function IssueChips({ r }: { r: Pick<IssueRow, "reminders" | "promiseAt" | "promisesBroken" | "overdue" | "escalationLevel"> }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {r.promiseAt ? (
        <Chip tone="blue" icon={<Handshake size={11} />}>
          Promised {new Date(r.promiseAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}
        </Chip>
      ) : null}
      {r.reminders ? (
        <Chip tone="amber" icon={<BellRing size={11} />}>
          Ignored {r.reminders}×
        </Chip>
      ) : null}
      {r.promisesBroken ? (
        <Chip tone="red" icon={<TriangleAlert size={11} />}>
          {r.promisesBroken} broken promise{r.promisesBroken > 1 ? "s" : ""}
        </Chip>
      ) : null}
      {r.escalationLevel ? <Chip tone="red">Escalated</Chip> : null}
    </span>
  );
}

function Chip({ tone, icon, children }: { tone: "blue" | "amber" | "red"; icon?: React.ReactNode; children: React.ReactNode }) {
  const cls = { blue: "bg-brand-blue-soft text-brand-blue", amber: "bg-brand-amber-soft text-[#b54708]", red: "bg-flag-red-soft text-flag-red" }[tone];
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", cls)}>{icon}{children}</span>;
}

/** One issue in a list: what, about what, whose turn, how long. */
export function IssueLine({ r }: { r: IssueRow }) {
  return (
    <Link href={`/issues/${r.id}`} className="block px-4 py-3 transition-colors hover:bg-page/70">
      <div className="flex items-start gap-3">
        <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", r.resolvedAt ? "bg-brand-green" : r.severity === "critical" ? "bg-flag-red" : "bg-brand-amber")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[13.5px] font-semibold text-ink">{r.title}</span>
            <span className="text-xs text-muted">{r.owner ? `Owner ${r.owner.name}` : "No owner"}</span>
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-muted">
            {r.about ? `${r.about.label} · ${r.about.sub} · ` : ""}
            {r.message}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {r.resolvedAt ? (
              <span className="rounded-full bg-brand-green-soft px-2 py-0.5 text-[12px] font-medium text-[#0e6e05]">
                Solved: {r.outcome}
                {r.faultParty && r.faultParty !== "NONE" ? ` · fault: ${PARTY_NAME[r.faultParty].toLowerCase()}` : ""}
              </span>
            ) : (
              <WaitingOn party={r.waitingOn} person={r.waitingPerson} minutes={r.waitedMinutes} />
            )}
            {!r.resolvedAt ? <IssueChips r={r} /> : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
