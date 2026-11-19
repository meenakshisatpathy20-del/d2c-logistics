"use client";

import clsx from "clsx";
import {
  ArrowLeft,
  Ban,
  Camera,
  CircleAlert,
  FileText,
  Flag,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Printer,
  Send,
  ShieldAlert,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";
import { useShell } from "@/components/shell/app-shell";
import { Badge, Button, Card, DemoBadge, Field, inputClass, type Tone } from "@/components/ui/primitives";
import { actOnFlag, announceShipmentsChanged, cancelOrder, editOrder, getOrder, type OrderDetail } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { shipOrders } from "@/lib/ship-orders";
import { useLive } from "@/lib/use-live";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: "New · not shipped", tone: "amber" },
  READY_TO_SHIP: { label: "Ready to ship", tone: "orange" },
  IN_TRANSIT: { label: "In transit", tone: "blue" },
  DELIVERED: { label: "Delivered", tone: "green" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "red" },
  RTO: { label: "Returning (RTO)", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
};

const SCAN: Record<string, string> = {
  BOOKED: "Booked",
  PICKUP_SCHEDULED: "Pickup scheduled",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  NDR: "Delivery failed",
  RTO_INITIATED: "Return started",
  RTO_DELIVERED: "Returned to seller",
  CANCELLED: "Cancelled",
};

const HISTORY: Record<string, string> = {
  SHIPMENT_BOOKED: "Shipment booked",
  SHIPMENT_CANCELLED: "Shipment cancelled",
  ORDER_CANCELLED: "Order cancelled",
  ORDER_EDITED: "Details changed",
  COURIER_BOOKING_CANCELLED: "Moved to another courier; old booking cancelled",
  PACKED_AND_READY: "Vendor marked packed and ready",
  PACKED_UNDONE: "Vendor undid packed",
};

export const ESCALATED = ["", "Overdue · escalated to the manager", "Overdue · escalated to the courier's account manager", "Overdue · escalated to the founder"];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function OrderDetailView({ id }: { id: string }) {
  const load = useCallback(() => getOrder(id), [id]);
  const { data: o, error, refresh } = useLive(load, 30_000);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { canShip } = useShell();

  if (error && !o) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-flag-red">{error}</p>
        <Link href="/orders" className="mt-3 inline-block text-sm font-medium text-brand-blue hover:underline">
          Back to orders
        </Link>
      </Card>
    );
  }
  if (!o) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
        <Loader2 size={18} className="animate-spin" /> Loading order…
      </div>
    );
  }

  const live = o.shipments.find((s) => s.status !== "CANCELLED") ?? null;
  const st = STATUS[o.status] ?? { label: o.status, tone: "grey" as const };
  const openFlags = [...(o.orderFlags ?? []), ...o.shipments.flatMap((s) => s.flags.filter((f) => f.open))];

  async function ship() {
    setShipping(true);
    setNotice(null);
    try {
      const r = await shipOrders([o!.id]);
      setNotice(r.failed ? { ok: false, text: r.results[0]?.error ?? "Could not book" } : { ok: true, text: `Booked with ${r.results[0]?.courier}, AWB ${r.results[0]?.awb}` });
      await refresh();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setShipping(false);
    }
  }

  return (
    <>
      <Link href="/orders" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Orders
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[26px] font-bold tracking-tight text-navy">#{o.orderNumber}</h1>
            <Badge tone={st.tone} dot>
              {st.label}
            </Badge>
            {o.rtoRisk.level !== "LOW" && !["DELIVERED", "CANCELLED"].includes(o.status) ? (
              <Badge tone={o.rtoRisk.level === "HIGH" ? "red" : "amber"}>RTO risk {o.rtoRisk.level.toLowerCase()}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] text-muted">
            {o.brand} · {o.items?.[0]?.name ?? "Order items"} · placed {when(o.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canShip && !live && o.status !== "CANCELLED" ? (
            <Button onClick={ship} disabled={shipping}>
              {shipping ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Ship with best courier
            </Button>
          ) : null}
          {live && ["BOOKED", "PICKUP_SCHEDULED"].includes(live.status) ? (
            <a href={live.labelUrl} target="_blank" rel="noreferrer">
              <Button variant="secondary">
                <Printer size={16} /> Label
              </Button>
            </a>
          ) : null}
          {live ? (
            <Link href={`/issues?raise=1&order=${encodeURIComponent(o.orderNumber)}`}>
              <Button variant="secondary">
                <Flag size={15} /> Raise issue
              </Button>
            </Link>
          ) : null}
          {live?.pickup ? (
            <a href={live.pickup.manifestUrl} target="_blank" rel="noreferrer">
              <Button variant="secondary">
                <FileText size={16} /> Manifest
              </Button>
            </a>
          ) : null}
          {canShip && o.canEdit ? (
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
              <Pencil size={15} /> Edit
            </Button>
          ) : null}
          {canShip && o.canCancel ? (
            <Button variant="secondary" onClick={() => setCancelling((v) => !v)} className="text-flag-red">
              <Ban size={15} /> Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p className={clsx("mb-4 rounded-lg px-3 py-2 text-[13px] font-medium", notice.ok ? "bg-brand-green-soft text-[#0e6e05]" : "bg-flag-red-soft text-flag-red")}>
          {notice.text}
        </p>
      ) : null}
      {cancelling ? <CancelBox order={o} onDone={() => (setCancelling(false), refresh())} /> : null}
      {editing ? <EditBox order={o} onDone={() => (setEditing(false), refresh())} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="space-y-6">
          {openFlags.length ? (
            <Card className="border-flag-red/30">
              <SectionTitle icon={<Flag size={16} className="text-flag-red" />} title="Needs attention" />
              <ul className="divide-y divide-line">
                {openFlags.map((f) => (
                  <FlagRow key={f.id} flag={f} onChanged={refresh} />
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <SectionTitle
              icon={<Truck size={16} className="text-brand-blue" />}
              title="Tracking"
              right={
                live ? (
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    {live.courier} · <span className="font-mono">{live.awb}</span> {live.isDemo ? <DemoBadge /> : null}
                  </span>
                ) : null
              }
            />
            {o.shipments.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">Not shipped yet. “Ship with best courier” books it and picks a pickup slot.</p>
            ) : (
              <div className="px-5 py-4">
                {live?.expectedDelivery && !["DELIVERED", "RTO_DELIVERED"].includes(live.status) ? (
                  <p className="mb-4 text-[13px] text-ink-2">
                    Expected delivery{" "}
                    <span className="font-semibold text-ink">
                      {new Date(live.expectedDelivery).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })}
                    </span>
                    {live.pickup ? (
                      <>
                        {" "}
                        · pickup {live.pickup.slot}, {new Date(live.pickup.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}
                        {live.pickup.executive ? ` · ${live.pickup.executive}` : ""}
                      </>
                    ) : null}
                  </p>
                ) : null}
                <ol className="relative space-y-4 border-l-2 border-line pl-5">
                  {o.shipments
                    .flatMap((s) => s.events.map((e) => ({ ...e, courier: s.courier })))
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((e, i) => (
                      <li key={`${e.at}-${i}`} className="relative">
                        <span
                          className={clsx(
                            "absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-white",
                            i === 0 ? (["NDR", "RTO_INITIATED"].includes(e.status) ? "bg-flag-red" : e.status === "DELIVERED" ? "bg-brand-green" : "bg-brand-orange") : "bg-faint",
                          )}
                        />
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className={clsx("text-[13.5px]", i === 0 ? "font-semibold text-ink" : "font-medium text-ink-2")}>{SCAN[e.status] ?? e.status}</span>
                          <span className="text-xs text-muted">{when(e.at)}</span>
                        </div>
                        <p className="text-[12.5px] text-muted">
                          {[e.remark, e.location].filter(Boolean).join(" · ")}
                        </p>
                      </li>
                    ))}
                </ol>
              </div>
            )}
          </Card>

          {live ? (
            <Card>
              <SectionTitle icon={<Package size={16} className="text-brand-orange" />} title="Shipment" />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-[13px] sm:grid-cols-4">
                <Info label="Courier" value={live.courier} />
                <Info label="Charged" value={formatINR(live.charged)} />
                <Info label="Charged weight" value={`${live.chargedWeightG / 1000} kg`} />
                <Info
                  label="Courier weighed"
                  value={live.courierWeightG ? `${live.courierWeightG / 1000} kg` : "—"}
                  warn={!!live.courierWeightG && live.courierWeightG > live.chargedWeightG}
                />
              </dl>
              {o.shipments.length > 1 ? (
                <p className="border-t border-line px-5 py-3 text-xs text-muted">
                  Earlier bookings: {o.shipments.filter((s) => s.id !== live.id).map((s) => `${s.courier} ${s.awb} (${SCAN[s.status] ?? s.status})`).join(", ")}
                </p>
              ) : null}
            </Card>
          ) : null}

          {live ? (
            <Card>
              <SectionTitle
                icon={<Camera size={16} className="text-brand-green" />}
                title="Packing proof"
                right={
                  live.packedAt ? (
                    <Badge tone="green" dot>
                      Packed and ready · {when(live.packedAt)}
                    </Badge>
                  ) : (
                    <Badge tone="amber">Not marked packed yet</Badge>
                  )
                }
              />
              {live.photos.length ? (
                <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6">
                  {live.photos.map((ph) => (
                    <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-line bg-page">
                      {/* Packing photos are private and served by the API, so a plain img is used. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.url} alt={`Packing photo ${when(ph.at)}`} className="size-full object-cover" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="px-5 py-4 text-[13px] text-muted">The vendor adds photos of the packed parcel on the scale from their phone. They are used as evidence in weight disputes.</p>
              )}
            </Card>
          ) : null}

          <Card>
            <SectionTitle icon={<CircleAlert size={16} className="text-muted" />} title="History" />
            {o.history.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No changes yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {o.history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                    <span className="text-ink-2">{HISTORY[h.action] ?? h.action.replaceAll("_", " ").toLowerCase()}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {h.by} · {when(h.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle icon={<MapPin size={16} className="text-brand-green" />} title="Customer" />
            <div className="space-y-1 px-5 py-4 text-[13.5px]">
              <p className="font-semibold text-ink">{o.customer.name}</p>
              <p className="text-ink-2">+91 {o.customer.phone}</p>
              <p className="text-muted">
                {o.customer.address}
                {o.customer.city ? `, ${o.customer.city}` : ""}
                {o.customer.state ? `, ${o.customer.state}` : ""} · <span className="font-medium text-ink-2">{o.customer.pincode}</span>
              </p>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={<Wallet size={16} className="text-brand-amber" />} title="Payment" />
            <dl className="space-y-2 px-5 py-4 text-[13px]">
              <Row label="Mode" value={o.payment.mode === "COD" ? "Cash on delivery" : "Prepaid"} />
              <Row label="Order value" value={formatINR(o.payment.orderValue)} />
              {o.payment.mode === "COD" ? (
                <>
                  <Row label="Advance paid online" value={o.payment.advance ? `${formatINR(o.payment.advance)} · ${(o.payment.advanceStatus ?? "").toLowerCase()}` : "None"} />
                  <Row label="Courier collects" value={formatINR(o.payment.collect)} strong />
                </>
              ) : null}
            </dl>
          </Card>

          <Card>
            <SectionTitle icon={<ShieldAlert size={16} className={o.rtoRisk.level === "HIGH" ? "text-flag-red" : "text-muted"} />} title={`RTO risk · ${o.rtoRisk.score}/100`} />
            <div className="px-5 py-4">
              <div className="h-2 rounded-full bg-page">
                <div
                  className={clsx("h-2 rounded-full", o.rtoRisk.level === "HIGH" ? "bg-flag-red" : o.rtoRisk.level === "MEDIUM" ? "bg-brand-amber" : "bg-brand-green")}
                  style={{ width: `${o.rtoRisk.score}%` }}
                />
              </div>
              {o.rtoRisk.reasons.length ? (
                <ul className="mt-3 space-y-1 text-[12.5px] text-ink-2">
                  {o.rtoRisk.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[12.5px] text-muted">No warning signs.</p>
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle icon={<Package size={16} className="text-muted" />} title="Parcel and places" />
            <dl className="space-y-2 px-5 py-4 text-[13px]">
              <Row label="Weight" value={`${o.parcel.weightGrams / 1000} kg`} />
              <Row label="Size" value={`${o.parcel.lengthCm} × ${o.parcel.breadthCm} × ${o.parcel.heightCm} cm`} />
              <Row label="Pickup from" value={`${o.pickupFrom.name}, ${o.pickupFrom.city}`} />
              <Row label="Returns to" value={o.returnTo ? `${o.returnTo.name}, ${o.returnTo.city}` : "Pickup address"} />
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function FlagRow({ flag, onChanged }: { flag: OrderDetail["shipments"][number]["flags"][number]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: "act") => {
    setBusy(true);
    setError(null);
    try {
      await actOnFlag(flag.id, { kind });
      announceShipmentsChanged();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const acted = !!flag.note;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-ink">{flag.title}</p>
        <p className="text-[12.5px] text-muted">
          {flag.message}
          {flag.owner ? ` · owner ${flag.owner}` : ""}
        </p>
        {flag.escalationLevel ? <p className="mt-0.5 text-[12px] font-medium text-flag-red">⬆ {ESCALATED[flag.escalationLevel]}</p> : null}
        {acted ? <p className="mt-0.5 text-[12.5px] font-medium text-[#0e6e05]">✓ {flag.note}</p> : null}
        {error ? <p className="mt-0.5 text-xs text-flag-red">{error}</p> : null}
      </div>
      <div className="flex gap-2">
        <Link href={`/issues/${flag.id}`} className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-page">
          Open the issue room
        </Link>
        {!acted && flag.action && flag.type !== "NOT_BOOKED" ? (
          <Button size="sm" disabled={busy} onClick={() => run("act")}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} {flag.action}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function EditBox({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [f, setF] = useState({
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    addressLine: order.customer.address,
    city: order.customer.city,
    state: order.customer.state,
    pincode: order.customer.pincode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError(null);
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) {
      const before = { customerName: order.customer.name, customerPhone: order.customer.phone, addressLine: order.customer.address, city: order.customer.city, state: order.customer.state, pincode: order.customer.pincode }[k];
      if (v.trim() !== before) patch[k] = v.trim();
    }
    try {
      if (Object.keys(patch).length) await editOrder(order.id, patch);
      announceShipmentsChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <h2 className="text-[15px] font-semibold text-ink">Edit delivery details</h2>
      <p className="mt-0.5 text-[13px] text-muted">
        {order.canEditPincode ? "Not booked yet, so everything can change." : "Booked: the pin code is fixed by the courier rate. To change it, cancel the shipment and book again."}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Customer name">
          <input className={inputClass} value={f.customerName} onChange={set("customerName")} />
        </Field>
        <Field label="Mobile">
          <input className={inputClass} value={f.customerPhone} inputMode="numeric" maxLength={10} onChange={set("customerPhone")} />
        </Field>
        <Field label="Pin code">
          <input className={inputClass} value={f.pincode} disabled={!order.canEditPincode} inputMode="numeric" maxLength={6} onChange={set("pincode")} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Address">
            <input className={inputClass} value={f.addressLine} onChange={set("addressLine")} />
          </Field>
        </div>
        <Field label="City">
          <input className={inputClass} value={f.city} onChange={set("city")} />
        </Field>
        <Field label="State">
          <input className={inputClass} value={f.state} onChange={set("state")} />
        </Field>
      </div>
      {error ? <p className="mt-3 text-[13px] font-medium text-flag-red">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Close
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null} Save changes
        </Button>
      </div>
    </Card>
  );
}

function CancelBox({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const booked = order.shipments.some((s) => s.status !== "CANCELLED");
  const [scope, setScope] = useState<"shipment" | "order">(booked ? "shipment" : "order");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await cancelOrder(order.id, scope, reason.trim());
      announceShipmentsChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 border-flag-red/30 p-5">
      <h2 className="text-[15px] font-semibold text-ink">Cancel before pickup</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {booked ? (
          <Choice active={scope === "shipment"} onClick={() => setScope("shipment")} title="Cancel the shipment only" body="The courier booking is cancelled (no charge, no executive). The order goes back to New to book again." />
        ) : null}
        <Choice
          active={scope === "order"}
          onClick={() => setScope("order")}
          title="Cancel the whole order"
          body={order.payment.advance ? `Also cancels the order and marks the ${formatINR(order.payment.advance)} advance for refund.` : "Also cancels the order. It moves to the Cancelled tab."}
        />
      </div>
      <div className="mt-4">
        <Field label="Reason">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer changed size" autoFocus />
        </Field>
      </div>
      {error ? <p className="mt-3 text-[13px] font-medium text-flag-red">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Keep it
        </Button>
        <Button onClick={confirm} disabled={busy || reason.trim().length < 3} className="bg-flag-red hover:bg-[#b42318]">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} Cancel {scope}
        </Button>
      </div>
    </Card>
  );
}

function Choice({ active, onClick, title, body }: { active: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx("rounded-xl border p-3.5 text-left transition-colors", active ? "border-navy bg-page ring-1 ring-navy" : "border-line hover:border-faint")}
    >
      <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-[12.5px] text-muted">{body}</span>
    </button>
  );
}

function SectionTitle({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
      <h2 className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
        {icon} {title}
      </h2>
      {right}
    </div>
  );
}

function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={clsx("mt-0.5 font-semibold", warn ? "text-flag-red" : "text-ink")}>
        {value}
        {warn ? <span className="ml-1 text-xs font-medium">· dispute</span> : null}
      </dd>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={clsx("text-right", strong ? "font-semibold text-ink" : "text-ink-2")}>{value}</dd>
    </div>
  );
}
