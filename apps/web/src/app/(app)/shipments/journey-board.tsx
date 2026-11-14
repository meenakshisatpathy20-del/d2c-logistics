"use client";

import clsx from "clsx";
import { AlertTriangle, CalendarClock, Columns3, Printer, Rows3, Truck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, type Tone } from "@/components/ui/primitives";
import { formatINR, type Lane, LANE_TOTALS, LANES, type Shipment, SHIPMENTS } from "@/lib/sample-data";

const laneHeader: Record<Tone, string> = {
  red: "bg-flag-red",
  orange: "bg-brand-orange",
  amber: "bg-brand-amber",
  blue: "bg-brand-blue",
  green: "bg-brand-green",
  grey: "bg-faint",
};

const noteClass: Record<Tone, string> = {
  red: "bg-flag-red-soft text-flag-red",
  orange: "bg-brand-orange-soft text-brand-orange-dark",
  amber: "bg-brand-amber-soft text-[#b54708]",
  blue: "bg-brand-blue-soft text-brand-blue",
  green: "bg-brand-green-soft text-[#0e6e05]",
  grey: "bg-page text-ink-2",
};

const BRAND_FILTERS = ["All brands", ...Array.from(new Set(SHIPMENTS.map((s) => s.brand)))];

export function JourneyBoard() {
  const [view, setView] = useState<"board" | "table">("board");
  const [brand, setBrand] = useState("All brands");

  const shipments = useMemo(
    () => (brand === "All brands" ? SHIPMENTS : SHIPMENTS.filter((s) => s.brand === brand)),
    [brand],
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 gap-2 overflow-x-auto pb-1">
          {BRAND_FILTERS.map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              className={clsx(
                "h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                brand === b ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2 hover:border-faint",
              )}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-line bg-white p-1" role="tablist" aria-label="View">
          {(
            [
              ["board", "Journey", Columns3],
              ["table", "Table", Rows3],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                view === k ? "bg-navy text-white" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === "board" ? (
        <Board shipments={shipments} filtered={brand !== "All brands"} onSeeAll={() => setView("table")} />
      ) : (
        <Table shipments={shipments} />
      )}
    </>
  );
}

function Board({
  shipments,
  filtered,
  onSeeAll,
}: {
  shipments: Shipment[];
  filtered: boolean;
  onSeeAll: () => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="grid grid-cols-[repeat(6,minmax(216px,1fr))] gap-3">
        {LANES.map((lane) => {
          const cards = shipments.filter((s) => s.lane === lane.key);
          // All brands: the lane's full count. Filtered: only that brand's cards.
          const total = filtered ? cards.length : LANE_TOTALS[lane.key as Lane];
          const problem = lane.key === "PROBLEM";
          return (
            <section
              key={lane.key}
              aria-label={lane.label}
              className={clsx(
                "flex min-w-0 flex-col rounded-2xl p-2",
                problem ? "bg-flag-red-soft ring-1 ring-flag-red/20" : "bg-[#eef1f6]",
              )}
            >
              <header className="flex items-center gap-2 px-2 pb-2 pt-1.5">
                <span className={clsx("size-2 rounded-full", laneHeader[lane.tone])} />
                <h2 className={clsx("text-[13.5px] font-semibold", problem ? "text-flag-red" : "text-ink")}>{lane.label}</h2>
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-2">
                  {total}
                </span>
              </header>
              <p className="px-2 pb-2 text-[11.5px] text-muted">{lane.hint}</p>
              <div className="flex flex-col gap-2">
                {cards.map((s, i) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: i * 0.03 }}
                  >
                    <ShipmentCard s={s} />
                  </motion.div>
                ))}
                {cards.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                    Nothing here
                  </p>
                ) : null}
                {total > cards.length ? (
                  <button
                    onClick={onSeeAll}
                    className="rounded-xl py-2 text-[12.5px] font-medium text-muted hover:bg-white/70 hover:text-ink"
                  >
                    + {total - cards.length} more · see all in table
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ShipmentCard({ s }: { s: Shipment }) {
  return (
    <article className="rounded-xl border border-line bg-white p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-orange-dark">{s.brand}</span>
        <span className="ml-auto text-[11.5px] tabular-nums text-faint">#{s.id}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-ink">{s.product}</div>
      <div className="mt-0.5 truncate text-xs text-muted">
        {s.customer} · {s.city}
        {s.courier ? ` · ${s.courier}` : ""}
      </div>
      <p className={clsx("mt-2.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium leading-snug", noteClass[s.noteTone])}>
        {s.note}
      </p>
      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
        <Badge tone={s.payment === "COD" ? "amber" : "green"}>{s.payment}</Badge>
        {s.rtoRisk ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-flag-red">
            <AlertTriangle size={11} /> {s.rtoRisk} RTO risk
          </span>
        ) : null}
        <span
          className="ml-auto grid size-6 place-items-center rounded-full bg-brand-blue-soft text-[10px] font-semibold text-brand-blue"
          title={`Owner: ${s.ownerName}`}
        >
          {s.owner}
        </span>
      </div>
    </article>
  );
}

function Table({ shipments }: { shipments: Shipment[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allChecked = shipments.length > 0 && shipments.every((s) => selected.has(s.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <AnimatePresence>
        {selected.size > 0 ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="m-3 flex flex-wrap items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-white">
              <span className="mr-2 text-[13px] font-medium">{selected.size} selected</span>
              <Button size="sm">
                <Truck size={14} /> Book
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10">
                <CalendarClock size={14} /> Pickup slot
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10">
                <Printer size={14} /> Labels
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
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(shipments.map((s) => s.id)))}
                  className="size-4 accent-brand-orange"
                />
              </th>
              <th className="px-3 py-3">Order</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Latest</th>
              <th className="px-3 py-3">Courier</th>
              <th className="px-3 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shipments.map((s) => {
              const lane = LANES.find((l) => l.key === s.lane)!;
              return (
                <tr key={s.id} className={clsx("hover:bg-page/70", selected.has(s.id) && "bg-brand-orange-soft/40")}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select order ${s.id}`}
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="size-4 accent-brand-orange"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-brand-blue">#{s.id}</span>
                    <div className="text-xs text-muted">
                      {s.brand} · {s.product}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-ink">{s.customer}</div>
                    <div className="text-xs text-muted">
                      {s.city} · {s.pincode}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={lane.tone} dot>
                      {lane.label}
                    </Badge>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-ink-2">{s.note}</td>
                  <td className="px-3 py-3">
                    {s.courier ? (
                      <>
                        <div className="text-ink">{s.courier}</div>
                        <div className="font-mono text-[11px] text-muted">{s.awb}</div>
                      </>
                    ) : (
                      <span className="text-xs text-faint">Not booked</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-2">
                    {formatINR(s.amount)}
                    <div className="text-xs text-muted">{s.payment}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
