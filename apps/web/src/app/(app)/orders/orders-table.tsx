"use client";

import clsx from "clsx";
import { AlertTriangle, CalendarClock, Filter, Printer, Search, Truck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, inputClass } from "@/components/ui/primitives";
import { formatINR, ORDER_TABS, type OrderTab, SAMPLE_ORDERS } from "@/lib/sample-data";

export function OrdersTable() {
  const [tab, setTab] = useState<OrderTab>("NEW");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_ORDERS.filter((o) => o.tab === tab).filter(
      (o) =>
        !q ||
        [o.id, o.customer, o.city, o.pincode, o.awb ?? "", o.vendor, o.brand, o.product].some((v) => v.toLowerCase().includes(q)),
    );
  }, [tab, query]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <div className="overflow-x-auto border-b border-line">
        <div role="tablist" aria-label="Order status" className="flex min-w-max gap-1 px-3">
          {ORDER_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setSelected(new Set());
              }}
              className={clsx(
                "relative px-3 py-3.5 text-[13.5px] font-medium transition-colors",
                tab === t.key ? "text-ink" : "text-muted hover:text-ink-2",
              )}
            >
              {t.label}
              <span
                className={clsx(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]",
                  tab === t.key ? "bg-brand-orange-soft text-brand-orange-dark" : "bg-page text-muted",
                  t.key === "NEEDS_ATTENTION" && t.count > 0 && "bg-brand-amber-soft text-[#b54708]",
                )}
              >
                {t.count}
              </span>
              {tab === t.key ? (
                <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-orange" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Order ID, AWB, brand, customer, pin code"
            className={`${inputClass} pl-9`}
          />
        </div>
        <Button variant="secondary" size="md">
          <Filter size={15} /> Filters
        </Button>
        {tab === "NEW" ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-[#b54708]">
            <AlertTriangle size={15} /> 2 orders have a weight mismatch. Check before booking.
          </span>
        ) : null}
      </div>

      <AnimatePresence>
        {selected.size > 0 ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mx-5 mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-white">
              <span className="mr-2 text-[13px] font-medium">{selected.size} selected</span>
              <Button size="sm">
                <Truck size={14} /> Book shipments
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10">
                <CalendarClock size={14} /> Schedule pickup
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10">
                <Printer size={14} /> Print labels
              </Button>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto grid size-8 place-items-center rounded-lg hover:bg-white/10"
                aria-label="Clear selection"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-y border-line bg-page/60 text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="size-4 accent-brand-orange"
                />
              </th>
              <th className="px-3 py-3">Order</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Brand · package</th>
              <th className="px-3 py-3">Payment</th>
              <th className="px-3 py-3">Pickup from</th>
              <th className="px-3 py-3">Courier</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((o) => (
              <tr key={o.id} className={clsx("transition-colors hover:bg-page/70", selected.has(o.id) && "bg-brand-orange-soft/40")}>
                <td className="px-5 py-3.5 align-top">
                  <input
                    type="checkbox"
                    aria-label={`Select order ${o.id}`}
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    className="size-4 accent-brand-orange"
                  />
                </td>
                <td className="px-3 py-3.5 align-top">
                  <div className="font-semibold text-brand-blue">#{o.id}</div>
                  <div className="mt-0.5 text-xs text-muted">{o.date}</div>
                  {o.rtoRisk ? (
                    <Badge tone={o.rtoRisk === "High" ? "red" : "amber"} className="mt-1.5">
                      {o.rtoRisk} RTO risk
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-3.5 align-top">
                  <div className="font-medium text-ink">{o.customer}</div>
                  <div className="mt-0.5 text-xs text-muted">{o.phone}</div>
                  <div className="text-xs text-muted">
                    {o.city} · {o.pincode}
                  </div>
                </td>
                <td className="px-3 py-3.5 align-top">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-orange-dark">{o.brand}</div>
                  <div className="text-ink">{o.product} × {o.qty}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {o.weightKg} kg · {o.dims} cm
                  </div>
                  {o.weightMismatch ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#b54708]">
                      <AlertTriangle size={12} /> Weight mismatch
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3.5 align-top">
                  <Badge tone={o.payment === "COD" ? "amber" : "green"}>{o.payment}</Badge>
                  <div className="mt-1 tabular-nums text-ink-2">{formatINR(o.amount)}</div>
                </td>
                <td className="px-3 py-3.5 align-top text-ink-2">{o.vendor}</td>
                <td className="px-3 py-3.5 align-top">
                  {o.courier ? (
                    <>
                      <div className="text-ink">{o.courier}</div>
                      <div className="mt-0.5 font-mono text-[11.5px] text-muted">{o.awb}</div>
                    </>
                  ) : (
                    <span className="text-xs text-faint">Not booked</span>
                  )}
                </td>
                <td className="px-3 py-3.5 align-top">
                  <Badge tone={o.statusTone} dot>
                    {o.status}
                  </Badge>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-14 text-center text-sm text-muted">
                  No orders here right now.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
