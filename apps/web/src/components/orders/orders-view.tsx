"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, Columns3, Download, Flag, Loader2, Printer, Rows3, Search, Send, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { JourneyBoard } from "@/app/(app)/shipments/journey-board";
import { Badge, Card, DemoBadge, type Tone } from "@/components/ui/primitives";
import { getOrderFilters, getOrders, labelsUrl, ORDER_TABS, type OrderRow, type OrderTab } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { previewShipments, type ShipPreviewRow, shipOrders } from "@/lib/ship-orders";
import { useShell } from "@/components/shell/app-shell";
import { useLive } from "@/lib/use-live";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  UNBOOKED: { label: "New", tone: "amber" },
  BOOKED: { label: "Ready to ship", tone: "orange" },
  PICKUP_SCHEDULED: { label: "Ready to ship", tone: "orange" },
  PICKED_UP: { label: "Picked up", tone: "blue" },
  IN_TRANSIT: { label: "In transit", tone: "blue" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "green" },
  DELIVERED: { label: "Delivered", tone: "green" },
  NDR: { label: "Delivery failed", tone: "red" },
  RTO_INITIATED: { label: "RTO in transit", tone: "red" },
  RTO_DELIVERED: { label: "RTO delivered", tone: "grey" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
};

const RISK_TONE = { HIGH: "red", MEDIUM: "amber", LOW: "green" } as const;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The Orders list: status tabs with counts, search, filters, pages, bulk
 * actions, and the journey board as a second view. Everything lives in the
 * URL, so a link (or the back button) brings back the same view.
 */
export function OrdersView({
  tabs = ORDER_TABS.map((t) => t.key),
  defaultTab = "ALL",
  allowBoard = true,
}: {
  tabs?: readonly OrderTab[];
  defaultTab?: OrderTab;
  allowBoard?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (params.get("tab") as OrderTab | null) ?? defaultTab;
  const view = allowBoard && params.get("view") === "board" ? "board" : "table";
  const q = params.get("q") ?? "";
  const brand = params.get("brand") ?? "";
  const courier = params.get("courier") ?? "";
  const payment = params.get("payment") ?? "";
  const page = Number(params.get("page") ?? 1);

  const setParams = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(
    () => getOrders({ tab, q, brand, courier, payment, page, size: 25 }),
    [tab, q, brand, courier, payment, page],
  );
  const { data, error, refresh } = useLive(load, 30_000);
  const [filters, setFilters] = useState<{ brands: string[]; couriers: { code: string; name: string }[] } | null>(null);
  useEffect(() => {
    getOrderFilters().then(setFilters, () => {});
  }, []);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shipping, setShipping] = useState(false);
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [search, setSearch] = useState(q);
  // A search from the top bar changes the URL; keep this box in step with it.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    setSearch(q);
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const printable = visibleSelected.filter((r) => r.shipmentId).map((r) => r.shipmentId!);
  const shippable = visibleSelected.filter((r) => r.status === "UNBOOKED");

  const { canShip } = useShell();
  const [preview, setPreview] = useState<ShipPreviewRow[] | null>(null);

  /** Step 1: show what will be booked. Nothing books until Confirm. */
  async function openPreview() {
    setShipping(true);
    setNotice(null);
    try {
      setPreview(await previewShipments(shippable.map((r) => r.id)));
    } catch (e) {
      setNotice({ tone: "red", text: (e as Error).message });
    } finally {
      setShipping(false);
    }
  }

  /** Step 2: book the previewed orders that have a courier. */
  async function shipSelected() {
    const ready = (preview ?? []).filter((p) => !p.problem);
    setShipping(true);
    setNotice(null);
    try {
      const res = await shipOrders(
        ready.map((p) => p.order.id),
        ready.map((p) => p.order),
      );
      setPreview(null);
      setNotice({
        tone: res.failed ? "red" : "green",
        text: res.failed
          ? `${res.booked} shipped, ${res.failed} need a fix: ${res.results.filter((r) => !r.ok).map((r) => `#${r.orderNumber} ${r.error}`).join("; ")}`
          : `${res.booked} order${res.booked === 1 ? "" : "s"} shipped with the recommended courier. Labels are ready.`,
      });
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setNotice({ tone: "red", text: (e as Error).message });
    } finally {
      setShipping(false);
    }
  }

  return (
    <>
      {/* Status tabs */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line pr-2">
          <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Order status">
            {tabs.map((key) => {
              const t = ORDER_TABS.find((x) => x.key === key)!;
              const active = tab === key;
              const n = data?.counts[key];
              const red = key === "ATTENTION" || key === "RTO";
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSelected(new Set());
                    setParams({ tab: key, view: null });
                  }}
                  className={clsx(
                    "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3.5 text-[13.5px] font-medium transition-colors",
                    active ? (red ? "text-flag-red" : "text-brand-orange-dark") : "text-muted hover:text-ink",
                  )}
                >
                  {key === "ATTENTION" ? <Flag size={13} className={active ? "" : "text-flag-red"} /> : null}
                  {t.label}
                  {n !== undefined ? (
                    <span className={clsx("tabular-nums font-semibold", active ? "" : red && n ? "text-flag-red" : "text-ink")}>{n}</span>
                  ) : null}
                  {active ? <span className={clsx("absolute inset-x-3 bottom-0 h-0.5 rounded-full", red ? "bg-flag-red" : "bg-brand-orange")} /> : null}
                </button>
              );
            })}
          </div>
          {allowBoard ? (
            <div className="hidden shrink-0 rounded-lg border border-line bg-white p-0.5 md:flex" aria-label="View">
              {(
                [
                  ["table", "Table", Rows3],
                  ["board", "Board", Columns3],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  onClick={() => setParams({ view: k === "board" ? "board" : null })}
                  aria-pressed={view === k}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium",
                    view === k ? "bg-navy text-white" : "text-muted hover:text-ink",
                  )}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {view === "board" ? (
          <div className="p-4">
            <JourneyBoard onSeeAll={() => setParams({ view: null, tab: "ALL" })} />
          </div>
        ) : (
          <>
            {/* Filters and bulk actions */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <form
                className="relative w-full sm:w-64"
                onSubmit={(e) => {
                  e.preventDefault();
                  setParams({ q: search.trim() });
                }}
              >
                <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Order no., AWB, phone, name"
                  aria-label="Search in orders"
                  className="h-9 w-full rounded-lg border border-line bg-white pl-8 pr-8 text-[13px] focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                />
                {q ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearch("");
                      setParams({ q: null });
                    }}
                    className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted hover:bg-page"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </form>
              <Select label="Brand" value={brand} onChange={(v) => setParams({ brand: v })} options={(filters?.brands ?? []).map((b) => [b, b])} />
              <Select label="Courier" value={courier} onChange={(v) => setParams({ courier: v })} options={(filters?.couriers ?? []).map((c) => [c.code, c.name])} />
              <Select label="Payment" value={payment} onChange={(v) => setParams({ payment: v })} options={[["COD", "COD"], ["PREPAID", "Prepaid"]]} />
              <span className="flex-1" />
              {visibleSelected.length ? (
                <span className="text-[13px] font-medium text-ink-2">{visibleSelected.length} selected</span>
              ) : null}
              {shippable.length && canShip ? (
                <button
                  onClick={openPreview}
                  disabled={shipping}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-brand-orange px-3 text-[13px] font-semibold text-white hover:bg-brand-orange-dark disabled:opacity-60"
                >
                  {shipping && !preview ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Ship {shippable.length} with best courier
                </button>
              ) : null}
              <a
                href={printable.length ? labelsUrl(printable) : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!printable.length}
                className={clsx(
                  "flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-medium",
                  printable.length ? "text-ink-2 hover:bg-page" : "pointer-events-none text-faint",
                )}
                title="One PDF with every selected label, one per page"
              >
                <Printer size={14} /> Print {printable.length || ""} label{printable.length === 1 ? "" : "s"}
              </a>
              <button
                onClick={async () => {
                  setNotice(null);
                  try {
                    await exportCsv({ tab, q, brand, courier, payment });
                  } catch (e) {
                    setNotice({ tone: "red", text: (e as Error).message });
                  }
                }}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink-2 hover:bg-page"
              >
                <Download size={14} /> Export
              </button>
            </div>

            {notice ? (
              <div
                className={clsx(
                  "mx-4 mb-3 rounded-lg px-3 py-2 text-[13px] font-medium",
                  notice.tone === "green" ? "bg-brand-green-soft text-[#0e6e05]" : "bg-flag-red-soft text-flag-red",
                )}
              >
                {notice.text}
              </div>
            ) : null}

            {error && !data ? (
              <p className="px-4 py-14 text-center text-sm text-flag-red">Couldn&apos;t load orders: {error}</p>
            ) : !data ? (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted">
                <Loader2 size={18} className="animate-spin" /> Loading orders…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <p className="text-[15px] font-semibold text-ink">{q ? `Nothing matches “${q}”` : "Nothing here right now"}</p>
                <p className="mt-1 text-sm text-muted">{q ? "Try the order number, AWB or the customer's mobile." : "Orders move into this tab as their status changes."}</p>
              </div>
            ) : (
              <OrdersTable
                rows={rows}
                selected={selected}
                onToggle={(id) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
                }
                onToggleAll={(all) => setSelected(all ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            )}

            {data && data.total > 0 ? (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
                <span>
                  {(data.page - 1) * data.size + 1}–{Math.min(data.page * data.size, data.total)} of {data.total}
                </span>
                <div className="flex items-center gap-1">
                  <PageButton disabled={data.page <= 1} onClick={() => setParams({ page: data.page - 1 }, false)} label="Previous page">
                    <ChevronLeft size={16} />
                  </PageButton>
                  <span className="px-2 font-medium text-ink">
                    Page {data.page} of {data.pages}
                  </span>
                  <PageButton disabled={data.page >= data.pages} onClick={() => setParams({ page: data.page + 1 }, false)} label="Next page">
                    <ChevronRight size={16} />
                  </PageButton>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
      {preview ? <ShipPreview rows={preview} busy={shipping} onCancel={() => setPreview(null)} onConfirm={shipSelected} /> : null}
    </>
  );
}

function ShipPreview({ rows, busy, onCancel, onConfirm }: { rows: ShipPreviewRow[]; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ok = rows.filter((r) => !r.problem);
  const total = ok.reduce((n, r) => n + (r.quote?.total ?? 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Review before shipping">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-navy">Review before shipping</h2>
          <p className="mt-0.5 text-[13px] text-muted">Each order goes with the cheapest courier that picks up on time (85%+), at the earliest pickup slot it can confirm.</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead className="sticky top-0 border-b border-line bg-page text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5">Order</th>
                <th className="py-2.5 pr-3">Deliver to</th>
                <th className="py-2.5 pr-3">Courier</th>
                <th className="py-2.5 pr-3">Delivery</th>
                <th className="py-2.5 pr-5 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order.id} className={clsx("border-b border-line/70", r.problem && "bg-flag-red-soft/50")}>
                  <td className="px-5 py-2.5">
                    <div className="font-semibold text-ink">#{r.order.orderNumber}</div>
                    <div className="text-xs text-muted">{r.order.brand}</div>
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">
                    {r.order.customer.city || r.order.customer.pincode} {r.order.customer.pincode}
                  </td>
                  <td className="py-2.5 pr-3">
                    {r.quote ? (
                      <span className="flex items-center gap-1.5 text-ink">
                        {r.quote.courierName} {r.quote.mode === "DEMO" ? <DemoBadge /> : null}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-flag-red">{r.problem}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">{r.quote ? `${r.quote.etaDays} days` : "—"}</td>
                  <td className="py-2.5 pr-5 text-right font-semibold text-ink">{r.quote ? formatINR(r.quote.total) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <span className="text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{ok.length}</span> to ship · {formatINR(total)}
            {rows.length - ok.length ? <span className="text-flag-red"> · {rows.length - ok.length} skipped</span> : null}
          </span>
          <span className="flex gap-2">
            <button onClick={onCancel} className="h-10 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink-2 hover:bg-page">
              Go back
            </button>
            <button
              onClick={onConfirm}
              disabled={busy || ok.length === 0}
              className="flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-sm font-semibold text-white hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Confirm and ship {ok.length}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function OrdersTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: OrderRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
}) {
  const router = useRouter();
  const all = rows.every((r) => selected.has(r.id));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-left text-[13px]">
        <thead className="border-y border-line bg-page/60 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          <tr>
            <th className="w-10 py-2.5 pl-4">
              <input type="checkbox" aria-label="Select all on this page" checked={all} onChange={(e) => onToggleAll(e.target.checked)} className="size-4 accent-brand-orange" />
            </th>
            <th className="py-2.5 pr-3">Order</th>
            <th className="py-2.5 pr-3">Brand / product</th>
            <th className="py-2.5 pr-3">Customer</th>
            <th className="py-2.5 pr-3">Payment</th>
            <th className="py-2.5 pr-3">Courier</th>
            <th className="py-2.5 pr-3">Status</th>
            <th className="py-2.5 pr-3">Owner</th>
            <th className="py-2.5 pr-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, tone: "grey" as const };
            const problem = !!r.flag || r.status === "NDR";
            const open = () => router.push(`/orders/${r.id}`);
            return (
              <tr
                key={r.id}
                onClick={open}
                className={clsx("cursor-pointer border-b border-line/70 align-top transition-colors hover:bg-page/70", problem && "bg-flag-red-soft/40")}
              >
                <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select order ${r.orderNumber}`} checked={selected.has(r.id)} onChange={() => onToggle(r.id)} className="size-4 accent-brand-orange" />
                </td>
                <td className="py-3 pr-3">
                  <Link href={`/orders/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-ink hover:text-brand-blue">
                    #{r.orderNumber}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted">{fmtDate(r.createdAt)}</div>
                </td>
                <td className="py-3 pr-3">
                  <div className="font-medium text-ink">{r.brand}</div>
                  <div className="mt-0.5 max-w-[160px] truncate text-xs text-muted">{r.product}</div>
                </td>
                <td className="py-3 pr-3">
                  <div className="text-ink">{r.customer}</div>
                  <div className="mt-0.5 whitespace-nowrap text-xs text-muted">{r.phone}</div>
                  <div className="whitespace-nowrap text-xs text-muted">
                    {r.city || "—"} {r.pincode}
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <div className="text-ink">
                    {r.payment} {formatINR(r.amount)}
                  </div>
                  {r.payment === "COD" && r.advance > 0 ? (
                    <div className="mt-0.5 text-xs text-[#b54708]">{formatINR(r.advance)} advance paid</div>
                  ) : null}
                </td>
                <td className="py-3 pr-3">
                  {r.courier ? (
                    <>
                      <div className="flex items-center gap-1.5 text-ink">
                        {r.courier}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-muted">{r.awb}</div>
                    </>
                  ) : (
                    <span className="text-xs text-muted">Not booked</span>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {problem ? (
                      <Badge tone="red" className="max-w-[240px]">
                        <Flag size={11} className="shrink-0" /> <span className="truncate" title={r.flag?.title ?? st.label}>{r.flag?.title ?? st.label}</span>
                      </Badge>
                    ) : (
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    )}
                    {r.rtoRisk && r.rtoRisk !== "LOW" && ["UNBOOKED", "BOOKED", "PICKUP_SCHEDULED"].includes(r.status) ? (
                      <Badge tone={RISK_TONE[r.rtoRisk]}>RTO risk {r.rtoRisk.toLowerCase()}</Badge>
                    ) : null}
                  </div>
                  {r.note && r.note !== r.flag?.title ? <div className="mt-1 max-w-[220px] truncate text-xs text-muted">{r.note}</div> : null}
                </td>
                <td className="py-3 pr-3">
                  {r.flag?.owner ? (
                    <span className="inline-grid size-7 place-items-center rounded-full bg-page text-[11px] font-semibold text-ink-2 ring-1 ring-line" title={r.flag.owner}>
                      {r.flag.owner.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                    </span>
                  ) : (
                    <span className="text-xs text-faint">—</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <RowAction row={r} onOpen={open} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowAction({ row, onOpen }: { row: OrderRow; onOpen: () => void }) {
  const primary = "inline-flex h-8 items-center whitespace-nowrap rounded-lg bg-brand-orange px-3 text-[12.5px] font-semibold text-white hover:bg-brand-orange-dark";
  const secondary = "inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-line bg-white px-3 text-[12.5px] font-medium text-ink-2 hover:bg-page";
  if (row.paymentHold && row.status === "UNBOOKED")
    return row.flag ? (
      <a className={primary} href={`/issues/${row.flag.id}`} title={row.paymentHold.reason ?? undefined}>
        Payment held
      </a>
    ) : (
      <button className={primary} onClick={onOpen}>
        Payment held
      </button>
    );
  if (row.status === "UNBOOKED")
    return (
      <button className={primary} onClick={onOpen}>
        Ship now
      </button>
    );
  if (row.flag || row.status === "NDR")
    return (
      <button className={primary} onClick={onOpen} title={row.flag?.action ?? undefined}>
        Fix it
      </button>
    );
  if (row.labelUrl && ["BOOKED", "PICKUP_SCHEDULED"].includes(row.status))
    return (
      <a className={secondary} href={row.labelUrl} target="_blank" rel="noreferrer">
        Label
      </a>
    );
  return (
    <button className={secondary} onClick={onOpen}>
      {row.status === "CANCELLED" ? "View" : "Track"}
    </button>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "h-9 rounded-lg border bg-white px-2.5 text-[13px] focus:border-brand-blue focus:outline-none",
        value ? "border-navy font-medium text-ink" : "border-line text-ink-2",
      )}
    >
      <option value="">{label === "Payment" ? "COD + prepaid" : `All ${label.toLowerCase()}s`}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function PageButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-page disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Every order matching the current tab, search and filters (up to 5,000), not just this page. */
async function exportCsv(query: { tab: OrderTab; q: string; brand: string; courier: string; payment: string }) {
  const rows: OrderRow[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await getOrders({ ...query, page, size: 100 });
    rows.push(...res.rows);
    if (page >= res.pages) break;
  }
  const head = ["order", "date", "brand", "product", "customer", "city", "pincode", "payment", "amount", "advance", "courier", "awb", "status"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.orderNumber, r.createdAt, r.brand, r.product, r.customer, r.city, r.pincode, r.payment, r.amount, r.advance, r.courier, r.awb, STATUS[r.status]?.label ?? r.status]
      .map(esc)
      .join(","),
  );
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
