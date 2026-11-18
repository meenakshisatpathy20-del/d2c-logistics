"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IssueLine } from "@/components/issues/issue-bits";
import { Button, Card, Field, inputClass } from "@/components/ui/primitives";
import { type CourierInfo, getCouriers, getIssues, getIssueTypes, type IssueGroup, type IssueType, type Party, raiseIssue } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const GROUPS: { key: IssueGroup | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PICKUPS", label: "Pickups" },
  { key: "TRANSIT", label: "In transit" },
  { key: "DELIVERY", label: "Delivery & NDR" },
  { key: "RETURNS", label: "Returns" },
  { key: "WEIGHT", label: "Weight" },
  { key: "MONEY", label: "Money" },
  { key: "BOOKING", label: "Booking & account" },
  { key: "OTHER", label: "Other" },
];
const WAITING: { key: Party | "ALL"; label: string }[] = [
  { key: "ALL", label: "Anyone" },
  { key: "OURS", label: "Us" },
  { key: "COURIER", label: "Courier" },
  { key: "VENDOR", label: "Vendor" },
  { key: "CUSTOMER", label: "Customer" },
];

export function IssuesInbox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const group = (params.get("group") as IssueGroup | null) ?? "ALL";
  const waiting = (params.get("waiting") as Party | null) ?? "ALL";
  const status = params.get("status") === "closed" ? "closed" : "open";
  const mine = params.get("mine") === "1";
  const page = Number(params.get("page") ?? 1);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const load = useCallback(() => getIssues({ group, waiting, status, mine, page }), [group, waiting, status, mine, page]);
  const { data, refresh } = useLive(load, 30_000);
  // "Raise issue" from an order or a pickup opens the form already pointed at it.
  const preOrder = params.get("order");
  const prePickup = params.get("pickup");
  const [raising, setRaising] = useState(params.get("raise") === "1");

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line pr-3">
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist">
          {GROUPS.map((g) => {
            const n = g.key === "ALL" ? undefined : data?.counts.groups[g.key];
            const active = group === g.key;
            return (
              <button
                key={g.key}
                role="tab"
                aria-selected={active}
                onClick={() => set({ group: g.key === "ALL" ? null : g.key })}
                className={clsx("relative shrink-0 px-4 py-3.5 text-[13.5px] font-medium", active ? "text-brand-orange-dark" : "text-muted hover:text-ink")}
              >
                {g.label} {n ? <span className="font-semibold text-ink">{n}</span> : null}
                {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand-orange" /> : null}
              </button>
            );
          })}
        </div>
        <Button size="sm" onClick={() => setRaising((v) => !v)}>
          <Plus size={14} /> Raise issue
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
        <span className="text-muted">Waiting on</span>
        {WAITING.map((w) => {
          const n = w.key === "ALL" ? undefined : data?.counts.waiting[w.key];
          return (
            <button
              key={w.key}
              onClick={() => set({ waiting: w.key === "ALL" ? null : w.key })}
              className={clsx(
                "h-8 rounded-full border px-3 font-medium",
                waiting === w.key ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2 hover:border-faint",
              )}
            >
              {w.label}
              {n ? ` ${n}` : ""}
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={() => set({ mine: mine ? null : "1" })} className={clsx("h-8 rounded-full border px-3 font-medium", mine ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2")}>
          Mine
        </button>
        <span className="flex-1" />
        <div className="flex rounded-lg border border-line p-0.5">
          {(["open", "closed"] as const).map((s) => (
            <button key={s} onClick={() => set({ status: s === "open" ? null : s })} className={clsx("rounded-md px-3 py-1 text-[12.5px] font-medium", status === s ? "bg-navy text-white" : "text-muted")}>
              {s === "open" ? "Open" : "Solved"}
            </button>
          ))}
        </div>
      </div>

      {raising ? (
        <RaiseForm
          order={preOrder}
          pickup={prePickup}
          onDone={(id) => {
            setRaising(false);
            if (id) router.push(`/issues/${id}`);
            else void refresh();
          }}
        />
      ) : null}

      {!data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading issues…
        </div>
      ) : data.rows.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted">{status === "open" ? "Nothing open here. New problems appear the moment the rules spot them." : "Nothing solved here yet."}</p>
      ) : (
        <div className="divide-y divide-line border-t border-line">
          {data.rows.map((r) => (
            <IssueLine key={r.id} r={r} />
          ))}
        </div>
      )}

      {data && data.pages > 1 ? (
        <div className="flex items-center justify-end gap-1 border-t border-line px-4 py-3 text-[13px]">
          <button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40" aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span className="px-2">
            Page {data.page} of {data.pages}
          </span>
          <button disabled={page >= data.pages} onClick={() => set({ page: String(page + 1) })} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40" aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </Card>
  );
}

const GROUP_NAME: Record<string, string> = {
  PICKUPS: "Pickups",
  TRANSIT: "In transit",
  DELIVERY: "Delivery",
  RETURNS: "Returns",
  WEIGHT: "Weight",
  MONEY: "Money",
  BOOKING: "Booking & account",
  OTHER: "Other",
};

/** Raise a problem the rules did not catch: on a pickup, an order (by its number) or a courier (money, account). */
function RaiseForm({ order, pickup, onDone }: { order: string | null; pickup: string | null; onDone: (id?: string) => void }) {
  const [types, setTypes] = useState<IssueType[]>([]);
  const [couriers, setCouriers] = useState<CourierInfo[]>([]);
  const [f, setF] = useState({ type: pickup ? "PICKUP_CLAIM" : order ? "FAKE_ATTEMPT" : "PAYMENT_NOT_CREDITED", order: order ?? "", courier: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getIssueTypes().then(setTypes, () => {});
    getCouriers().then(setCouriers, () => {});
  }, []);
  const scope = types.find((t) => t.key === f.type)?.scope ?? "courier";
  // From a pickup only pickup problems make sense; from an order, order problems.
  const offered = types.filter((t) => (pickup ? t.scope === "pickup" : order ? t.scope === "order" || t.key === "OTHER" : true));
  const groups = [...new Set(offered.map((t) => t.group))];
  const ready = f.body.trim().length >= 3 && (pickup ? true : scope === "order" ? !!f.order.trim() : scope === "courier" ? !!f.courier : false);
  return (
    <form
      className="grid gap-3 border-t border-line bg-page/50 px-4 py-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await raiseIssue({
            type: f.type,
            body: f.body,
            ...(pickup ? { pickupId: pickup } : scope === "order" ? { orderId: f.order.replace(/^#/, "") } : { courierCode: f.courier }),
          });
          onDone(r.id);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Field label="What happened">
        <select className={inputClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {groups.map((g) => (
            <optgroup key={g} label={GROUP_NAME[g]}>
              {offered
                .filter((t) => t.group === g)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {pickup ? (
        <Field label="About">
          <input className={inputClass} value="This pickup" disabled />
        </Field>
      ) : scope === "order" ? (
        <Field label="Order number" hint="The issue goes on that order's shipment">
          <input className={inputClass} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} placeholder="e.g. 18908" />
        </Field>
      ) : (
        <Field label="Courier or aggregator">
          <select className={inputClass} value={f.courier} onChange={(e) => setF({ ...f, courier: e.target.value })}>
            <option value="">Pick one</option>
            {couriers.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Details" hint="Amounts, UTR, AWBs, what was said and when">
        <input className={inputClass} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="e.g. Paid Rs 1,788 on 17 Nov, UTR INFT0467, not credited" />
      </Field>
      {error ? <p className="text-[13px] font-medium text-flag-red sm:col-span-3">{error}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !ready}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null} Raise and open
        </Button>
      </div>
    </form>
  );
}
