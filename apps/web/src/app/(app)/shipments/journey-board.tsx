"use client";

import clsx from "clsx";
import { AlertTriangle, Columns3, FileText, Loader2, Rows3, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, DemoBadge } from "@/components/ui/primitives";
import { type BoardCard, getBoard, type Lane, type Tone } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { useLive } from "@/lib/use-live";

const LANES: { key: Lane; label: string; hint: string; tone: Tone }[] = [
  { key: "PROBLEM", label: "Needs a fix", hint: "Stuck, failed or late", tone: "red" },
  { key: "TO_PACK", label: "To pack", hint: "Booked or waiting to book", tone: "orange" },
  { key: "READY", label: "Ready for pickup", hint: "Courier confirmed", tone: "amber" },
  { key: "MOVING", label: "On the way", hint: "Picked up, between hubs", tone: "blue" },
  { key: "OUT_TODAY", label: "Out today", hint: "Arriving today", tone: "green" },
  { key: "DELIVERED", label: "Done", hint: "Delivered or returned", tone: "green" },
];

const laneDot: Record<Tone, string> = {
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

/** Returned parcels share the last column with delivered ones. */
const columnOf = (c: BoardCard): Lane => (c.lane === "RETURNED" ? "DELIVERED" : c.lane);
const CARDS_PER_LANE = 6;

export function JourneyBoard() {
  const { data, error } = useLive(getBoard);
  const [view, setView] = useState<"board" | "table">("board");
  const [brand, setBrand] = useState("All brands");

  const brands = useMemo(
    () => ["All brands", ...Array.from(new Set((data ?? []).map((c) => c.brand))).sort()],
    [data],
  );
  const cards = useMemo(
    () => (brand === "All brands" ? data ?? [] : (data ?? []).filter((c) => c.brand === brand)),
    [data, brand],
  );

  if (error && !data) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-flag-red">Couldn&apos;t load shipments: {error}</p>
        <p className="mt-1 text-xs text-muted">It retries every 30 seconds.</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
        <Loader2 size={18} className="animate-spin" /> Loading shipments…
      </div>
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {brands.map((b) => (
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

      {data.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-[15px] font-semibold text-ink">No shipments yet</p>
          <p className="mt-1 text-sm text-muted">Book your first order with “New shipment”. It appears here at once.</p>
        </Card>
      ) : view === "board" ? (
        <Board cards={cards} onSeeAll={() => setView("table")} />
      ) : (
        <Table cards={cards} />
      )}
    </>
  );
}

function Board({ cards, onSeeAll }: { cards: BoardCard[]; onSeeAll: () => void }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="grid grid-cols-[repeat(6,minmax(216px,1fr))] gap-3">
        {LANES.map((lane) => {
          const inLane = cards.filter((c) => columnOf(c) === lane.key);
          const shown = inLane.slice(0, CARDS_PER_LANE);
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
                <span className={clsx("size-2 rounded-full", laneDot[lane.tone])} />
                <h2 className={clsx("text-[13.5px] font-semibold", problem ? "text-flag-red" : "text-ink")}>{lane.label}</h2>
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-2">
                  {inLane.length}
                </span>
              </header>
              <p className="px-2 pb-2 text-[11.5px] text-muted">{lane.hint}</p>
              <div className="flex flex-col gap-2">
                {shown.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(i, 6) * 0.03 }}
                  >
                    <ShipmentCard c={c} />
                  </motion.div>
                ))}
                {inLane.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                    {problem ? "Nothing needs a fix" : "Nothing here"}
                  </p>
                ) : null}
                {inLane.length > shown.length ? (
                  <button
                    onClick={onSeeAll}
                    className="rounded-xl py-2 text-[12.5px] font-medium text-muted hover:bg-white/70 hover:text-ink"
                  >
                    + {inLane.length - shown.length} more · see all in table
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

function ShipmentCard({ c }: { c: BoardCard }) {
  return (
    <article className="rounded-xl border border-line bg-white p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-brand-orange-dark">{c.brand}</span>
        <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-faint">#{c.orderNumber}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-ink">{c.product}</div>
      <div className="mt-0.5 truncate text-xs text-muted">
        {c.customer} · {c.city || c.pincode}
        {c.courier ? ` · ${c.courier}` : ""}
      </div>
      <p className={clsx("mt-2.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium leading-snug", noteClass[c.tone])}>{c.note}</p>
      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
        <Badge tone={c.payment === "COD" ? "amber" : "green"}>{c.payment}</Badge>
        {c.advance > 0 ? (
          <span className="text-[11px] font-medium text-[#b54708]" title={`${formatINR(c.advance)} advance paid online · collect ${formatINR(c.collect)}`}>
            +{formatINR(c.advance)} adv.
          </span>
        ) : null}
        {c.labelUrl ? (
          <a
            href={c.labelUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-blue hover:underline"
            title="Shipping label (PDF)"
          >
            <FileText size={12} /> Label
          </a>
        ) : null}
        <span
          className="ml-auto grid size-6 place-items-center rounded-full bg-brand-blue-soft text-[10px] font-semibold text-brand-blue"
          title={`Owner: ${c.ownerName}`}
        >
          {c.owner}
        </span>
      </div>
    </article>
  );
}

function Table({ cards }: { cards: BoardCard[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const booked = cards.filter((c) => c.labelUrl);
  const allChecked = booked.length > 0 && booked.every((c) => selected.has(c.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openLabels = () => {
    for (const c of cards) if (selected.has(c.id) && c.labelUrl) window.open(c.labelUrl, "_blank");
  };

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
              <Button size="sm" onClick={openLabels}>
                <FileText size={14} /> Open labels
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
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all booked"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(booked.map((c) => c.id)))}
                  className="size-4 accent-brand-orange"
                />
              </th>
              <th className="px-3 py-3">Order</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Latest</th>
              <th className="px-3 py-3">Courier</th>
              <th className="px-3 py-3 text-right">Value</th>
              <th className="px-3 py-3">Label</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cards.map((c) => {
              const lane = LANES.find((l) => l.key === columnOf(c))!;
              return (
                <tr key={c.id} className={clsx("hover:bg-page/70", selected.has(c.id) && "bg-brand-orange-soft/40")}>
                  <td className="px-4 py-3">
                    {c.labelUrl ? (
                      <input
                        type="checkbox"
                        aria-label={`Select order ${c.orderNumber}`}
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="size-4 accent-brand-orange"
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-brand-blue">#{c.orderNumber}</span>
                    <div className="text-xs text-muted">
                      {c.brand} · {c.product}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-ink">{c.customer}</div>
                    <div className="text-xs text-muted">
                      {c.city} · {c.pincode}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={c.lane === "RETURNED" ? "grey" : lane.tone} dot>
                      {c.lane === "RETURNED" ? "Returned" : lane.label}
                    </Badge>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-ink-2" title={c.note}>
                    {c.note}
                  </td>
                  <td className="px-3 py-3">
                    {c.courier ? (
                      <>
                        <div className="flex items-center gap-1.5 text-ink">
                          {c.courier} {c.isDemo ? <DemoBadge /> : null}
                        </div>
                        <div className="font-mono text-[11px] text-muted">{c.awb}</div>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-faint">
                        <AlertTriangle size={12} /> Not booked
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-2">
                    {formatINR(c.amount)}
                    <div className="text-xs text-muted">
                      {c.payment === "COD" && c.advance > 0
                        ? `${formatINR(c.advance)} advance · collect ${formatINR(c.collect)}`
                        : c.payment}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {c.labelUrl ? (
                      <a href={c.labelUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-brand-blue hover:underline">
                        PDF
                      </a>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
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
