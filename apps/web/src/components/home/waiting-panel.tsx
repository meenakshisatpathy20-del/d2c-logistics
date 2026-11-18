"use client";

import clsx from "clsx";
import { ArrowRight, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { IssueLine } from "@/components/issues/issue-bits";
import { Card } from "@/components/ui/primitives";
import { getIssues } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const loadOurs = () => getIssues({ waiting: "OURS" });
const loadAll = () => getIssues({});

/** Where the day is stuck: what waits on us, and what waits on couriers, vendors and customers, by name. */
export function WaitingPanel() {
  const [tab, setTab] = useState<"us" | "partners">("us");
  const { data: ours } = useLive(loadOurs, 30_000);
  const { data: all } = useLive(loadAll, 30_000);
  const partners = (all?.rows ?? []).filter((r) => r.waitingOn !== "OURS").sort((a, b) => b.waitedMinutes - a.waitedMinutes);
  const partnerCount = all ? all.total - (ours?.total ?? 0) : undefined;
  const rows = tab === "us" ? (ours?.rows ?? []) : partners;

  return (
    <section aria-labelledby="waiting">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="waiting" className="text-[15px] font-semibold text-ink">
          Issues
        </h2>
        <Link href="/issues" className="flex items-center gap-1 text-[12.5px] font-medium text-brand-blue hover:underline">
          All issues <ArrowRight size={13} />
        </Link>
      </div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 border-b border-line">
          {(
            [
              ["us", "Waiting on us", ours?.total],
              ["partners", "Waiting on partners", partnerCount],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx("relative px-4 py-3 text-[13px] font-medium", tab === k ? "text-ink" : "text-muted hover:text-ink")}
            >
              {label}{" "}
              {n ? <span className={clsx("ml-1 rounded-full px-1.5 text-[11px] font-bold text-white", k === "us" ? "bg-flag-red" : "bg-brand-blue")}>{n}</span> : null}
              {tab === k ? <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-brand-orange" /> : null}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <PartyPopper size={22} className="text-brand-green" />
            <p className="text-sm font-medium text-ink">{tab === "us" ? "Nothing is waiting on us" : "Nothing is waiting on partners"}</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {rows.slice(0, 5).map((r) => (
              <IssueLine key={r.id} r={r} />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
