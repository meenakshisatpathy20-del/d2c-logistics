"use client";

import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getOrders, type TodayData } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const loadCounts = () => getOrders({ size: 5 });

/**
 * The day in five steps, left to right. Each card says what to do next and
 * opens the orders waiting in that step.
 */
export function StepCards({ pulse }: { pulse: TodayData["pulse"] }) {
  const { data } = useLive(loadCounts, 30_000);
  const c = data?.counts;
  const n = (v: number | undefined) => (v === undefined ? "–" : String(v));

  const steps = [
    { no: "1", title: "Ship it", value: n(c?.NEW), sub: "Pick courier, print label", href: "/orders?tab=NEW", hot: !!c?.NEW },
    { no: "2", title: "Hand over", value: n(c?.READY), sub: "Packed, waiting for pickup", href: "/orders?tab=READY" },
    {
      no: "3",
      title: "On the way",
      value: c ? String(c.IN_TRANSIT + c.OUT_FOR_DELIVERY) : "–",
      sub: `${pulse.outToday} out for delivery today`,
      href: "/orders?tab=IN_TRANSIT",
    },
    {
      no: "4",
      title: "Delivered",
      value: n(c?.DELIVERED),
      sub: `${pulse.deliveredToday} delivered today`,
      href: "/orders?tab=DELIVERED",
    },
    { no: "!", title: "Problems", value: n(c?.ATTENTION), sub: "Failed, stuck or missed", href: "/ndr", problem: true },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {steps.map((s) => (
        <Link
          key={s.title}
          href={s.href}
          className={clsx(
            "group relative rounded-[var(--radius-card)] border bg-white p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-md",
            s.hot ? "border-brand-orange ring-1 ring-brand-orange/40" : s.problem && s.value !== "0" ? "border-flag-red/40" : "border-line",
            s.problem && "col-span-2 md:col-span-1",
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "grid size-6 place-items-center rounded-full text-[11px] font-bold text-white",
                s.problem ? "bg-flag-red" : s.hot ? "bg-brand-orange" : "bg-navy",
              )}
            >
              {s.no}
            </span>
            <span className={clsx("text-[13.5px] font-semibold", s.problem ? "text-flag-red" : "text-ink")}>{s.title}</span>
            <ArrowRight size={14} className="ml-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
          </div>
          <div className={clsx("mt-2 font-display text-[28px] font-bold leading-none", s.problem && s.value !== "0" ? "text-flag-red" : "text-navy")}>
            {s.value}
          </div>
          <div className="mt-1.5 text-[12px] leading-snug text-muted">{s.sub}</div>
        </Link>
      ))}
    </div>
  );
}
