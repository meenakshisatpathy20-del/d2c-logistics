"use client";

import clsx from "clsx";
import { CheckCircle2, FileSpreadsheet, FileText, Loader2, Sparkles, UploadCloud, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { OUR_BRANDS } from "@/components/ui/logo";
import { Badge, Button, DemoBadge, Field, inputClass } from "@/components/ui/primitives";
import {
  announceShipmentsChanged,
  bookOrder,
  type BookedShipment,
  type BulkResult,
  bulkBook,
  fetchRates,
  getWarehouses,
  type RateQuote,
  type Warehouse,
} from "@/lib/api";
import { BULK_COLUMNS, type BulkRow, parseBulkCsv, SAMPLE_BULK_CSV, SAMPLE_BULK_CSV_CLEAN } from "@/lib/bulk-csv";
import { codAdvanceFor } from "@/lib/cod-advance";
import { formatINR } from "@/lib/format";
import { slotOptions } from "@/lib/pickup-slots";

export function BookingPanel({
  open,
  onClose,
  initialMode = "single",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: "single" | "bulk";
}) {
  const [mode, setMode] = useState<"single" | "bulk">(initialMode);
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    if (!warehouses) getWarehouses().then(setWarehouses, () => setWarehouses([]));
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, warehouses]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-40 flex justify-end bg-navy/30 backdrop-blur-[1px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={onClose}
        >
          <motion.aside
            role="dialog"
            aria-label="New shipment"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-[600px] flex-col bg-white shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-6 py-4">
              <div className="flex-1">
                <h2 className="font-display text-xl font-bold text-navy">New shipment</h2>
                <p className="text-[13px] text-muted">Order, courier, pickup slot. That&apos;s it.</p>
              </div>
              <div role="tablist" className="flex rounded-xl bg-page p-1">
                {(
                  [
                    ["single", "One order"],
                    ["bulk", "Bulk CSV"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={mode === k}
                    onClick={() => setMode(k)}
                    className={clsx(
                      "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                      mode === k ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={onClose} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-page" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {!warehouses ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
                <Loader2 size={16} className="animate-spin" /> Loading warehouses…
              </div>
            ) : warehouses.length === 0 ? (
              <p className="p-8 text-sm text-flag-red">Couldn&apos;t load pickup warehouses. Check the connection and reopen.</p>
            ) : mode === "single" ? (
              <SingleOrder warehouses={warehouses} />
            ) : (
              <BulkUpload warehouses={warehouses} />
            )}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-6 py-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-navy text-[13px] font-semibold text-white">{n}</span>
        <h3 className="flex-1 text-[15px] font-semibold text-ink">{title}</h3>
        {hint}
      </div>
      {children}
    </section>
  );
}

const isPhone = (v: string) => /^[6-9]\d{9}$/.test(v);
const isPincode = (v: string) => /^[1-9]\d{5}$/.test(v);

function SingleOrder({ warehouses }: { warehouses: Warehouse[] }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [productBrand, setProductBrand] = useState<string>(OUR_BRANDS[0].name);
  const [productName, setProductName] = useState("");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [warehouse, setWarehouse] = useState(warehouses[0].code);
  const [pincode, setPincode] = useState("");
  const [weight, setWeight] = useState("");
  const [dims, setDims] = useState({ l: "", b: "", h: "" });
  const [payment, setPayment] = useState<"PREPAID" | "COD">("COD");
  const [orderValue, setOrderValue] = useState("");
  // D2C Mall asks every COD customer for a small advance online; on by default.
  const [advancePaid, setAdvancePaid] = useState(true);
  const [quotes, setQuotes] = useState<RateQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [slots] = useState(() => slotOptions(new Date()));
  const [slot, setSlot] = useState(() => slots[0].key);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookedShipment | null>(null);
  // One key per form: a double-click or retry returns the same booking, never a second one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const origin = warehouses.find((w) => w.code === warehouse)!.pincode;
  const box = { l: Number(dims.l), b: Number(dims.b), h: Number(dims.h) };
  const value = Number(orderValue);
  const advance = payment === "COD" && advancePaid ? codAdvanceFor(value) : 0;
  const collect = payment === "COD" ? Math.max(0, value - advance) : 0;
  const parcelReady = isPincode(pincode) && Number(weight) > 0 && box.l > 0 && box.b > 0 && box.h > 0 && value > 0;

  const problems = {
    orderNumber: orderNumber.trim() ? null : "Enter the order ID",
    customer: customer.trim().length >= 2 ? null : "Enter the customer's name",
    mobile: isPhone(mobile) ? null : "10-digit mobile number, starting 6–9",
    address: address.trim().length >= 8 ? null : "Enter the full delivery address",
    pincode: isPincode(pincode) ? null : "6-digit pin code",
    weight: Number(weight) > 0 ? null : "Weight above 0",
    box: box.l > 0 && box.b > 0 && box.h > 0 ? null : "Length, breadth and height",
    value: value > 0 ? null : "Order value above 0",
  };
  const show = (k: keyof typeof problems) => (touched[k] ? problems[k] : null);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  useEffect(() => {
    if (!parcelReady) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const q = await fetchRates(
          {
            originPincode: origin,
            destinationPincode: pincode,
            weightGrams: Math.round(Number(weight) * 1000),
            lengthCm: Number(dims.l),
            breadthCm: Number(dims.b),
            heightCm: Number(dims.h),
            paymentMode: payment,
            codAmount: collect,
          },
          ctrl.signal,
        );
        setQuotes(q);
        setChosen(q.find((x) => x.recommended)?.courierCode ?? q.find((x) => x.serviceable)?.courierCode ?? null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Couldn't get courier rates. Check the connection and try again.");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [origin, pincode, weight, dims, payment, collect, parcelReady]);

  const serviceable = quotes?.filter((q) => q.serviceable) ?? [];
  const fastest = serviceable.length ? Math.min(...serviceable.map((q) => q.etaDays)) : null;
  const recommendedQuote = serviceable.find((q) => q.recommended);
  const visible = showAll
    ? quotes ?? []
    : [...(recommendedQuote ? [recommendedQuote] : []), ...serviceable.filter((q) => q !== recommendedQuote)].slice(0, 3);
  const cheapest = serviceable[0];
  const chosenQuote = parcelReady ? quotes?.find((q) => q.courierCode === chosen && q.serviceable) : undefined;
  const chosenSlot = slots.find((x) => x.key === slot)!;
  const formValid = Object.values(problems).every((p) => p === null);

  async function book() {
    setTouched(Object.fromEntries(Object.keys(problems).map((k) => [k, true])));
    if (!formValid || !chosenQuote) return;
    setBooking(true);
    setBookError(null);
    try {
      const result = await bookOrder({
        orderNumber: orderNumber.trim(),
        productBrand,
        productName: productName.trim() || undefined,
        customerName: customer.trim(),
        customerPhone: mobile,
        addressLine: address.trim(),
        city: city.trim() || undefined,
        pincode,
        warehouseCode: warehouse,
        paymentMode: payment,
        orderValue: value,
        codAdvance: advance,
        weightGrams: Math.round(Number(weight) * 1000),
        lengthCm: box.l,
        breadthCm: box.b,
        heightCm: box.h,
        courierCode: chosenQuote.courierCode,
        slot: { day: chosenSlot.day, startHour: chosenSlot.start },
        idempotencyKey,
      });
      setBooked(result);
      announceShipmentsChanged();
    } catch (e) {
      setBookError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  function bookAnother() {
    setBooked(null);
    setOrderNumber("");
    setProductName("");
    setCustomer("");
    setMobile("");
    setAddress("");
    setCity("");
    setPincode("");
    setWeight("");
    setDims({ l: "", b: "", h: "" });
    setOrderValue("");
    setQuotes(null);
    setChosen(null);
    setTouched({});
    setIdempotencyKey(crypto.randomUUID());
  }

  if (booked) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="grid size-14 place-items-center rounded-full bg-brand-green-soft text-brand-green"
        >
          <CheckCircle2 size={30} />
        </motion.span>
        <h3 className="mt-4 font-display text-2xl font-bold text-navy">Booked with {booked.courierName}</h3>
        <p className="mt-1 text-sm text-muted">
          Order #{booked.orderNumber} for {customer} · pickup {chosenSlot.dayLabel === "Today" || chosenSlot.dayLabel === "Tomorrow" ? chosenSlot.dayLabel.toLowerCase() : chosenSlot.dayLabel}, {booked.pickupSlot?.label ?? chosenSlot.label}
        </p>
        <dl className="mt-6 grid w-full max-w-sm grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-left">
          {[
            ["AWB", booked.awb],
            ["Charged", formatINR(booked.chargedAmount)],
            [
              "Expected delivery",
              new Date(booked.expectedDelivery).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }),
            ],
            ["Weight charged", `${booked.chargedWeightGrams / 1000} kg`],
          ].map(([k, v]) => (
            <div key={k} className="bg-white px-4 py-3">
              <dt className="text-[11.5px] text-muted">{k}</dt>
              <dd className={clsx("text-sm font-semibold text-ink", k === "AWB" && "font-mono")}>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex gap-2">
          <a href={booked.labelUrl} target="_blank" rel="noreferrer">
            <Button>
              <FileText size={16} /> Download label
            </Button>
          </a>
          <Button variant="secondary" onClick={bookAnother}>
            Book another order
          </Button>
        </div>
        <p className="mt-4 max-w-sm text-xs text-muted">
          Saved and in Orders. {booked.mode === "DEMO" ? `Demo courier: nothing is sent to ${booked.courierName} yet.` : ""}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <Step n={1} title="Order">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Order ID" error={show("orderNumber")}>
              <input
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onBlur={() => touch("orderNumber")}
                placeholder="e.g. 18906"
                className={inputClass}
              />
            </Field>
            <Field label="Brand">
              <select value={productBrand} onChange={(e) => setProductBrand(e.target.value)} className={inputClass}>
                {OUR_BRANDS.map((b) => (
                  <option key={b.slug} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Product">
              <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Kada bangle set" className={inputClass} />
            </Field>
            <Field label="Ship from">
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className={inputClass}>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Customer name" error={show("customer")}>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                onBlur={() => touch("customer")}
                placeholder="Full name"
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <Field label="Mobile" error={show("mobile")}>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onBlur={() => touch("mobile")}
                placeholder="10-digit mobile"
                inputMode="numeric"
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Delivery address" error={show("address")}>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onBlur={() => touch("address")}
                  placeholder="House, street, area"
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. New Delhi" className={inputClass} />
            </Field>
            <Field label="Pin code" error={show("pincode")}>
              <input
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onBlur={() => touch("pincode")}
                placeholder="6 digits"
                inputMode="numeric"
                className={inputClass}
              />
            </Field>
            <Field label="Weight (kg)" error={show("weight")}>
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ""))}
                onBlur={() => touch("weight")}
                placeholder="e.g. 0.9"
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
            <Field label="Order value (₹)" error={show("value")}>
              <input
                value={orderValue}
                onChange={(e) => setOrderValue(e.target.value.replace(/[^\d.]/g, ""))}
                onBlur={() => touch("value")}
                placeholder="e.g. 1499"
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Box size (cm)" error={show("box")} hint="Courier charges the higher of actual weight and box size.">
                <div className="grid grid-cols-3 gap-2">
                  {(["l", "b", "h"] as const).map((k) => (
                    <input
                      key={k}
                      aria-label={{ l: "Length", b: "Breadth", h: "Height" }[k]}
                      placeholder={{ l: "Length", b: "Breadth", h: "Height" }[k]}
                      value={dims[k]}
                      onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                      onBlur={() => touch("box")}
                      inputMode="numeric"
                      className={inputClass}
                    />
                  ))}
                </div>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              {(["COD", "PREPAID"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPayment(p)}
                  className={clsx(
                    "h-9 rounded-full border px-4 text-[13px] font-medium transition-colors",
                    payment === p ? "border-brand-orange bg-brand-orange-soft text-brand-orange-dark" : "border-line text-ink-2 hover:bg-page",
                  )}
                >
                  {p === "COD" ? "Cash on delivery" : "Prepaid"}
                </button>
              ))}
              <span className="ml-auto text-[13px] text-muted">
                {payment === "COD" ? (value > 0 ? `Courier collects ${formatINR(collect)}` : "Courier collects the balance") : "Nothing to collect"}
              </span>
            </div>
            {payment === "COD" ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand-amber/30 bg-brand-amber-soft/60 px-4 py-3 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={advancePaid}
                  onChange={(e) => setAdvancePaid(e.target.checked)}
                  className="mt-0.5 size-4 accent-brand-orange"
                />
                <span className="text-[13px] leading-snug text-ink-2">
                  <span className="font-semibold text-ink">Advance paid online</span>
                  {value > 0 && advance > 0 ? ` · ${formatINR(advance)} paid at checkout, courier collects ${formatINR(collect)}` : " · ₹49 below ₹1,000, ₹99 from ₹1,000"}
                  <span className="mt-0.5 block text-xs text-muted">
                    Same rule as D2C Mall. Kept if the customer refuses at the door; it covers two-way shipping.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        </Step>

        <Step n={2} title="Courier" hint={<DemoBadge />}>
          {!parcelReady ? (
            <p className="text-sm text-muted">Add the pin code, weight, box size and order value to compare all 8 couriers.</p>
          ) : error ? (
            <p className="flex items-center gap-2 text-sm text-flag-red">
              <XCircle size={16} /> {error}
            </p>
          ) : !quotes ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Comparing 8 couriers…
            </p>
          ) : serviceable.length === 0 ? (
            <p className="text-sm text-flag-red">No courier delivers to {pincode}. Check the pin code.</p>
          ) : (
            <>
              <ul className={clsx("space-y-2 transition-opacity", loading && "opacity-60")}>
                {visible.map((q) => (
                  <li key={q.courierCode}>
                    <button
                      type="button"
                      disabled={!q.serviceable}
                      onClick={() => setChosen(q.courierCode)}
                      className={clsx(
                        "flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors",
                        chosen === q.courierCode ? "border-brand-orange bg-brand-orange-soft/50" : "border-line hover:border-faint",
                        !q.serviceable && "cursor-not-allowed opacity-45",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          {q.courierName}
                          {q.recommended ? (
                            <Badge tone="green">
                              <Sparkles size={11} /> Recommended
                            </Badge>
                          ) : null}
                          {q === cheapest && !q.recommended ? <Badge tone="grey">Cheapest</Badge> : null}
                          {q.serviceable && q.etaDays === fastest && !q.recommended ? <Badge tone="blue">Fastest</Badge> : null}
                        </span>
                        <span className="text-xs text-muted">
                          {q.serviceable ? (
                            <>
                              Delivers in {q.etaDays} day{q.etaDays > 1 ? "s" : ""} · pickup on time{" "}
                              <span className={clsx("font-semibold", q.pickupOnTimePct < 85 ? "text-flag-red" : "text-[#0e6e05]")}>
                                {q.pickupOnTimePct}%
                              </span>
                            </>
                          ) : (
                            "Doesn't deliver here"
                          )}
                        </span>
                      </span>
                      <span className="text-right font-semibold tabular-nums text-ink">{formatINR(q.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-[13px] font-medium text-brand-blue hover:underline">
                {showAll ? "Show top 3" : `Compare all ${quotes.length} couriers`}
              </button>
            </>
          )}
        </Step>

        <Step n={3} title="Pickup slot" hint={<span className="text-xs text-muted">Courier confirms 2 h before</span>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSlot(s.key)}
                className={clsx(
                  "rounded-xl border-2 px-2 py-2.5 text-center text-[13px] font-medium transition-colors",
                  slot === s.key ? "border-brand-blue bg-brand-blue-soft text-brand-blue" : "border-line text-ink-2 hover:border-faint",
                )}
              >
                <span className="block text-[11px] font-normal text-muted">{s.dayLabel}</span>
                {s.label}
              </button>
            ))}
          </div>
          {slots[0].day === "next" ? (
            <p className="mt-2 text-xs text-muted">
              {slots[0].dayLabel === "Tomorrow"
                ? "Today’s slots are too close for the courier to confirm, so these are tomorrow."
                : `No pickups on Sundays or holidays, so these are ${slots[0].dayLabel}.`}
            </p>
          ) : null}
        </Step>
      </div>

      <div className="border-t border-line bg-white px-6 py-4">
        {bookError ? (
          <p className="mb-3 flex items-center gap-2 text-[13px] text-flag-red">
            <XCircle size={15} /> {bookError}
          </p>
        ) : null}
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-muted">
              {chosenQuote ? `${chosenQuote.courierName} · ${chosenSlot.dayLabel}, ${chosenSlot.label}` : "Fill the order to see the price"}
            </div>
            <div className="font-display text-2xl font-bold text-navy">{chosenQuote ? formatINR(chosenQuote.total) : "—"}</div>
          </div>
          <Button size="lg" disabled={!chosenQuote || booking} onClick={book}>
            {booking ? <Loader2 size={17} className="animate-spin" /> : null}
            {booking ? "Booking…" : "Book shipment"}
          </Button>
        </div>
      </div>
    </>
  );
}

function BulkUpload({ warehouses }: { warehouses: Warehouse[] }) {
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [batchKey, setBatchKey] = useState(() => crypto.randomUUID());
  const codes = warehouses.map((w) => w.code);

  const summary = useMemo(() => {
    if (!rows) return null;
    const bad = rows.filter((r) => r.errors.length > 0).length;
    return { total: rows.length, bad, good: rows.length - bad };
  }, [rows]);

  function load(text: string) {
    try {
      setRows(parseBulkCsv(text, codes));
      setFileError(null);
      setResult(null);
      setBookError(null);
      setBatchKey(crypto.randomUUID());
    } catch (e) {
      setRows(null);
      setFileError((e as Error).message);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([[...BULK_COLUMNS, "brand", "product", "advance_paid"].join(",") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "d2c-bulk-orders-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function bookAll() {
    if (!rows || !summary || summary.bad > 0) return;
    setBooking(true);
    setBookError(null);
    try {
      const res = await bulkBook(
        batchKey,
        rows.map((r) => {
          const cod = r.payment_method.toLowerCase() === "cod";
          const value = Number(r.order_value);
          return {
            orderNumber: r.order_id,
            productBrand: r.brand || undefined,
            productName: r.product || undefined,
            customerName: r.customer_name,
            customerPhone: r.customer_phone,
            addressLine: r.address,
            city: r.city,
            state: r.state,
            pincode: r.pincode,
            warehouseCode: r.pickup_warehouse_id,
            rtoWarehouseCode: r.rto_warehouse_id || undefined,
            paymentMode: cod ? "COD" : "PREPAID",
            orderValue: value,
            codAdvance: cod && r.advance_paid ? Number(r.advance_paid) : 0,
            weightGrams: Math.round(Number(r.weight_kg) * 1000),
            lengthCm: Math.round(Number(r.length_cm)),
            breadthCm: Math.round(Number(r.breadth_cm)),
            heightCm: Math.round(Number(r.height_cm)),
          };
        }),
      );
      setResult(res);
      announceShipmentsChanged();
    } catch (e) {
      setBookError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <label
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-9 text-center transition-colors hover:border-brand-blue/50 hover:bg-brand-blue-soft/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) load(await f.text());
          }}
        >
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-blue-soft text-brand-blue">
            <UploadCloud size={21} />
          </span>
          <span className="text-[15px] font-semibold text-ink">Drop a CSV or tap to choose</span>
          <span className="max-w-sm text-[13px] text-muted">Same columns as our Velocity sheet. Every row is checked before anything books.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) load(await f.text());
            }}
          />
        </label>
        <div className="mt-3 flex justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            <FileSpreadsheet size={14} /> Template
          </Button>
          <Button variant="ghost" size="sm" onClick={() => load(SAMPLE_BULK_CSV)}>
            Sample with mistakes
          </Button>
          <Button variant="ghost" size="sm" onClick={() => load(SAMPLE_BULK_CSV_CLEAN)}>
            Clean sample
          </Button>
        </div>

        {fileError ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-flag-red">
            <XCircle size={16} /> {fileError}
          </p>
        ) : null}

        {rows && summary ? (
          <div className="mt-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex-1 text-sm font-semibold text-ink">{result ? "Booking result" : `${summary.total} orders checked`}</span>
              {result ? (
                <>
                  <Badge tone="green" dot>
                    {result.booked} booked
                  </Badge>
                  {result.failed ? (
                    <Badge tone="red" dot>
                      {result.failed} not booked
                    </Badge>
                  ) : null}
                </>
              ) : (
                <>
                  <Badge tone="green" dot>
                    {summary.good} ready
                  </Badge>
                  {summary.bad ? (
                    <Badge tone="red" dot>
                      {summary.bad} to fix
                    </Badge>
                  ) : null}
                </>
              )}
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {rows.map((r) => {
                const outcome = result?.results.find((x) => x.orderNumber === r.order_id);
                const bad = r.errors.length > 0 || (outcome && !outcome.ok);
                return (
                  <li key={r.line} className={clsx("flex items-start gap-3 px-4 py-3", bad && "bg-flag-red-soft/60")}>
                    {bad ? (
                      <XCircle size={17} className="mt-0.5 shrink-0 text-flag-red" />
                    ) : (
                      <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand-green" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">
                        #{r.order_id} · {r.customer_name}
                        <span className="font-normal text-muted">
                          {" "}
                          · {r.pincode} · {r.payment_method} · {r.weight_kg} kg
                        </span>
                      </span>
                      {r.errors.length ? (
                        <span className="mt-0.5 block text-xs font-medium text-flag-red">
                          Row {r.line}: {r.errors.join(" · ")}
                        </span>
                      ) : outcome ? (
                        <span className={clsx("mt-0.5 block text-xs", outcome.ok ? "text-[#0e6e05]" : "font-medium text-flag-red")}>
                          {outcome.ok ? `Booked with ${outcome.courier} · AWB ${outcome.awb}` : outcome.error}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-xs text-muted">Ships from {r.pickup_warehouse_id}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="border-t border-line px-6 py-4">
        {bookError ? (
          <p className="mb-3 flex items-center gap-2 text-[13px] text-flag-red">
            <XCircle size={15} /> {bookError}
          </p>
        ) : null}
        <div className="flex items-center gap-4">
          <p className="flex-1 text-xs text-muted">Each order gets the cheapest courier with reliable pickups and the earliest slot it can confirm.</p>
          <Button size="lg" disabled={!summary || summary.bad > 0 || booking || !!result} onClick={bookAll}>
            {booking ? <Loader2 size={17} className="animate-spin" /> : null}
            {!summary
              ? "Book shipments"
              : result
                ? "Done"
                : summary.bad > 0
                  ? `Fix ${summary.bad} row${summary.bad > 1 ? "s" : ""} first`
                  : booking
                    ? "Booking…"
                    : `Book ${summary.good} shipments`}
          </Button>
        </div>
      </div>
    </>
  );
}
