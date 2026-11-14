"use client";

import clsx from "clsx";
import { CheckCircle2, FileSpreadsheet, Info, Loader2, Sparkles, UploadCloud, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, DemoBadge, Field, inputClass } from "@/components/ui/primitives";
import { fetchRates, type RateQuote } from "@/lib/api";
import { BULK_COLUMNS, type BulkRow, parseBulkCsv, SAMPLE_BULK_CSV } from "@/lib/bulk-csv";
import { formatINR, PICKUP_SLOTS, WAREHOUSES } from "@/lib/sample-data";

type Mode = "single" | "bulk";

export function BookShipment() {
  const [mode, setMode] = useState<Mode>("single");
  return (
    <>
      <div role="tablist" className="mb-5 inline-flex rounded-xl border border-line bg-white p-1">
        {(
          [
            ["single", "Single order"],
            ["bulk", "Bulk CSV upload"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={clsx(
              "relative rounded-lg px-4 py-2 text-[13.5px] font-medium transition-colors",
              mode === key ? "text-white" : "text-ink-2 hover:text-ink",
            )}
          >
            {mode === key ? (
              <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-lg bg-navy" transition={{ duration: 0.18 }} />
            ) : null}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      {mode === "single" ? <SingleOrder /> : <BulkUpload />}
    </>
  );
}

function SingleOrder() {
  const [warehouse, setWarehouse] = useState(WAREHOUSES[1].code);
  const [pincode, setPincode] = useState("110017");
  const [weight, setWeight] = useState("0.9");
  const [dims, setDims] = useState({ l: "20", b: "15", h: "8" });
  const [payment, setPayment] = useState<"PREPAID" | "COD">("COD");
  const [codAmount, setCodAmount] = useState("1499");
  const [quotes, setQuotes] = useState<RateQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [slot, setSlot] = useState(PICKUP_SLOTS[2]);

  const origin = WAREHOUSES.find((w) => w.code === warehouse)!.pincode;
  const ready = /^[1-9]\d{5}$/.test(pincode) && Number(weight) > 0;

  useEffect(() => {
    if (!ready) return;
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
            codAmount: payment === "COD" ? Number(codAmount) || 0 : 0,
          },
          ctrl.signal,
        );
        setQuotes(q);
        setChosen(q.find((x) => x.serviceable)?.courierCode ?? null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Couldn't get courier rates. Check the connection and try again.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [origin, pincode, weight, dims, payment, codAmount, ready]);

  const chosenQuote = quotes?.find((q) => q.courierCode === chosen);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
      <Card>
        <CardHeader title="Order details" subtitle="Pre-filled when the order comes from OMS Guru." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Pickup warehouse">
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className={inputClass}>
              {WAREHOUSES.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.name} · {w.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="RTO warehouse" hint="Where returns go. Defaults to the pickup warehouse.">
            <select defaultValue="" className={inputClass}>
              <option value="">Same as pickup</option>
              {WAREHOUSES.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Customer name">
            <input defaultValue="Neha S." className={inputClass} />
          </Field>
          <Field label="Mobile number" hint="Used for tracking, OTP and delivery updates.">
            <input defaultValue="9812345670" inputMode="numeric" className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Delivery address">
              <input defaultValue="H-12, Saket" className={inputClass} />
            </Field>
          </div>
          <Field label="Pin code">
            <input
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
          <Field label="City">
            <input defaultValue="New Delhi" className={inputClass} />
          </Field>
          <Field label="Weight (kg)">
            <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className={inputClass} />
          </Field>
          <Field label="Box size (cm)" hint="Length × breadth × height. Courier charges the higher of actual and box weight.">
            <div className="grid grid-cols-3 gap-2">
              {(["l", "b", "h"] as const).map((k) => (
                <input
                  key={k}
                  value={dims[k]}
                  aria-label={k}
                  onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, "") }))}
                  inputMode="numeric"
                  className={inputClass}
                />
              ))}
            </div>
          </Field>
          <Field label="Payment">
            <div className="grid grid-cols-2 gap-2">
              {(["COD", "PREPAID"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPayment(p)}
                  className={clsx(
                    "h-10 rounded-lg border text-sm font-medium transition-colors",
                    payment === p ? "border-brand-orange bg-brand-orange-soft text-brand-orange-dark" : "border-line text-ink-2 hover:bg-page",
                  )}
                >
                  {p === "COD" ? "Cash on delivery" : "Prepaid"}
                </button>
              ))}
            </div>
          </Field>
          {payment === "COD" ? (
            <Field label="COD amount (₹)" hint="Customer confirms COD orders by message before booking.">
              <input value={codAmount} onChange={(e) => setCodAmount(e.target.value)} inputMode="decimal" className={inputClass} />
            </Field>
          ) : null}
        </div>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Choose courier"
            subtitle="Live comparison, cheapest first. You can change the pick."
            action={<DemoBadge />}
          />
          <div className="p-3">
            {!ready ? (
              <p className="px-2 py-6 text-center text-sm text-muted">Enter a 6-digit pin code and weight to see rates.</p>
            ) : error ? (
              <p className="flex items-center gap-2 px-2 py-6 text-sm text-flag-red">
                <XCircle size={16} /> {error}
              </p>
            ) : !quotes ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                <Loader2 size={16} className="animate-spin" /> Comparing couriers…
              </p>
            ) : (
              <ul className={clsx("space-y-1.5 transition-opacity", loading && "opacity-60")}>
                {quotes.map((q, i) => (
                  <li key={q.courierCode}>
                    <button
                      type="button"
                      disabled={!q.serviceable}
                      onClick={() => setChosen(q.courierCode)}
                      className={clsx(
                        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                        chosen === q.courierCode
                          ? "border-brand-orange bg-brand-orange-soft/60"
                          : "border-transparent hover:border-line hover:bg-page",
                        !q.serviceable && "cursor-not-allowed opacity-45",
                      )}
                    >
                      <span
                        className={clsx(
                          "grid size-4 shrink-0 place-items-center rounded-full border-2",
                          chosen === q.courierCode ? "border-brand-orange" : "border-faint",
                        )}
                      >
                        {chosen === q.courierCode ? <span className="size-2 rounded-full bg-brand-orange" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                          {q.courierName}
                          {i === 0 && q.serviceable ? (
                            <Badge tone="green">
                              <Sparkles size={11} /> Best price
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted">
                          {q.serviceable
                            ? `${q.etaDays} day${q.etaDays > 1 ? "s" : ""} · ${q.zone.toLowerCase()} · ${q.chargedWeightGrams / 1000} kg charged`
                            : "Does not deliver to this pin code"}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-semibold tabular-nums text-ink">{formatINR(q.total)}</span>
                        {q.codCharge > 0 ? (
                          <span className="text-[11px] text-muted">incl. COD {formatINR(q.codCharge)}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Pickup slot" subtitle="The courier must confirm 2 hours before the slot." />
          <div className="grid grid-cols-2 gap-2 p-5">
            {PICKUP_SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                className={clsx(
                  "rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                  slot === s ? "border-brand-blue bg-brand-blue-soft text-brand-blue" : "border-line text-ink-2 hover:bg-page",
                )}
              >
                Today, {s}
              </button>
            ))}
          </div>
          <div className="border-t border-line p-5">
            <div className="mb-4 flex items-center justify-between text-sm">
              <span className="text-muted">Total shipping</span>
              <span className="font-display text-xl font-bold text-navy">
                {chosenQuote ? formatINR(chosenQuote.total) : "—"}
              </span>
            </div>
            <Button size="lg" className="w-full" disabled={!chosenQuote}>
              Book with {chosenQuote?.courierName ?? "courier"} · {slot}
            </Button>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <Info size={13} className="mt-px shrink-0" />
              Label and manifest download right after booking. The customer gets the tracking link automatically.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function BulkUpload() {
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const codes = WAREHOUSES.map((w) => w.code);

  const summary = useMemo(() => {
    if (!rows) return null;
    const bad = rows.filter((r) => r.errors.length > 0).length;
    return { total: rows.length, bad, good: rows.length - bad };
  }, [rows]);

  function load(text: string) {
    try {
      setRows(parseBulkCsv(text, codes));
      setFileError(null);
    } catch (e) {
      setRows(null);
      setFileError((e as Error).message);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([BULK_COLUMNS.join(",") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "d2c-bulk-orders-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-6">
      <Card>
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-line px-6 py-12 text-center transition-colors hover:border-brand-blue/50 hover:bg-brand-blue-soft/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) load(await f.text());
          }}
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-blue-soft text-brand-blue">
            <UploadCloud size={22} />
          </span>
          <span className="text-[15px] font-semibold text-ink">Drop your CSV here, or click to choose a file</span>
          <span className="max-w-md text-[13px] text-muted">
            Same columns as our Velocity bulk sheet, including pickup and RTO warehouse IDs. Every row is checked before
            anything is booked.
          </span>
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
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            <FileSpreadsheet size={14} /> Download template
          </Button>
          <Button variant="ghost" size="sm" onClick={() => load(SAMPLE_BULK_CSV)}>
            Try with a sample file
          </Button>
        </div>
      </Card>

      {fileError ? (
        <p className="flex items-center gap-2 text-sm text-flag-red">
          <XCircle size={16} /> {fileError}
        </p>
      ) : null}

      {rows && summary ? (
        <Card>
          <CardHeader
            title={`Preview · ${summary.total} orders`}
            subtitle="Fix the highlighted rows and upload again. Nothing books until every row is correct."
            action={
              <div className="flex gap-2">
                <Badge tone="green" dot>
                  {summary.good} ready
                </Badge>
                {summary.bad > 0 ? (
                  <Badge tone="red" dot>
                    {summary.bad} need a fix
                  </Badge>
                ) : null}
              </div>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line bg-page/60 text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Row</th>
                  <th className="px-3 py-3">Order</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Pin code</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">Weight</th>
                  <th className="px-3 py-3">Pickup</th>
                  <th className="px-3 py-3">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? "bg-flag-red-soft/50" : undefined}>
                    <td className="px-5 py-3 text-muted">{r.line}</td>
                    <td className="px-3 py-3 font-medium text-ink">#{r.order_id}</td>
                    <td className="px-3 py-3 text-ink-2">
                      {r.customer_name}
                      <div className="text-xs text-muted">{r.customer_phone}</div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink-2">{r.pincode}</td>
                    <td className="px-3 py-3 text-ink-2">{r.payment_method}</td>
                    <td className="px-3 py-3 tabular-nums text-ink-2">{r.weight_kg} kg</td>
                    <td className="px-3 py-3 font-mono text-xs text-ink-2">{r.pickup_warehouse_id}</td>
                    <td className="px-3 py-3">
                      {r.errors.length ? (
                        <span className="flex items-start gap-1.5 text-xs font-medium text-flag-red">
                          <XCircle size={14} className="mt-px shrink-0" />
                          {r.errors.join(" · ")}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-[#0e6e05]">
                          <CheckCircle2 size={14} /> Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <span className="text-[13px] text-muted">
              Couriers are picked automatically by rules: pin code, weight, COD and courier performance.
            </span>
            <Button disabled={summary.bad > 0}>
              {summary.bad > 0
                ? `Fix ${summary.bad} row${summary.bad > 1 ? "s" : ""} to book`
                : `Book ${summary.good} shipments`}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
