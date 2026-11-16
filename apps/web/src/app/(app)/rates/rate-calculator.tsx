"use client";

import clsx from "clsx";
import { Loader2, Star } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, DemoBadge, Field, inputClass } from "@/components/ui/primitives";
import { fetchRates, type RateQuote } from "@/lib/api";
import { formatINR } from "@/lib/format";

export function RateCalculator() {
  const [f, setF] = useState({ origin: "201309", dest: "400076", weight: "500", l: "20", b: "15", h: "8", mode: "PREPAID" as "PREPAID" | "COD", cod: "999" });
  const [quotes, setQuotes] = useState<RateQuote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function compare() {
    setBusy(true);
    setError(null);
    try {
      const q = await fetchRates({
        originPincode: f.origin,
        destinationPincode: f.dest,
        weightGrams: Number(f.weight),
        lengthCm: Number(f.l),
        breadthCm: Number(f.b),
        heightCm: Number(f.h),
        paymentMode: f.mode,
        codAmount: f.mode === "COD" ? Number(f.cod) : 0,
      });
      setQuotes(q.sort((a, b) => Number(b.serviceable) - Number(a.serviceable) || a.total - b.total));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr] [&>*]:min-w-0">
      <Card className="p-5">
        <form
          className="grid grid-cols-2 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void compare();
          }}
        >
          <Field label="Pickup pin code">
            <input className={inputClass} value={f.origin} onChange={set("origin")} inputMode="numeric" maxLength={6} />
          </Field>
          <Field label="Delivery pin code">
            <input className={inputClass} value={f.dest} onChange={set("dest")} inputMode="numeric" maxLength={6} />
          </Field>
          <Field label="Weight (g)">
            <input className={inputClass} value={f.weight} onChange={set("weight")} inputMode="numeric" />
          </Field>
          <Field label="Payment">
            <select className={inputClass} value={f.mode} onChange={set("mode")}>
              <option value="PREPAID">Prepaid</option>
              <option value="COD">COD</option>
            </select>
          </Field>
          <div className="col-span-2 grid grid-cols-3 gap-3">
            <Field label="L (cm)">
              <input className={inputClass} value={f.l} onChange={set("l")} inputMode="numeric" />
            </Field>
            <Field label="B (cm)">
              <input className={inputClass} value={f.b} onChange={set("b")} inputMode="numeric" />
            </Field>
            <Field label="H (cm)">
              <input className={inputClass} value={f.h} onChange={set("h")} inputMode="numeric" />
            </Field>
          </div>
          {f.mode === "COD" ? (
            <div className="col-span-2">
              <Field label="COD amount (₹)">
                <input className={inputClass} value={f.cod} onChange={set("cod")} inputMode="numeric" />
              </Field>
            </div>
          ) : null}
          <Button type="submit" className="col-span-2" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} Compare couriers
          </Button>
          {error ? <p className="col-span-2 text-[13px] font-medium text-flag-red">{error}</p> : null}
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[14.5px] font-semibold text-ink">Couriers</h2>
          <DemoBadge />
        </div>
        {!quotes ? (
          <p className="px-5 py-16 text-center text-sm text-muted">Enter a parcel and press Compare.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead className="border-b border-line bg-page/60 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5">Courier</th>
                  <th className="py-2.5 pr-3">Zone</th>
                  <th className="py-2.5 pr-3">Delivery</th>
                  <th className="py-2.5 pr-3">Pickup on time</th>
                  <th className="py-2.5 pr-3">Charged weight</th>
                  <th className="py-2.5 pr-5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.courierCode} className={clsx("border-b border-line/70", !q.serviceable && "opacity-45", q.recommended && "bg-brand-green-soft/50")}>
                    <td className="px-5 py-3 font-medium text-ink">
                      {q.courierName}
                      {q.recommended ? (
                        <Badge tone="green" className="ml-2">
                          <Star size={11} /> Recommended
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-ink-2">{q.switchedOff ? "Switched off by our team" : q.serviceable ? q.zone.toLowerCase() : "Not serviceable"}</td>
                    <td className="py-3 pr-3 text-ink-2">{q.etaDays} days</td>
                    <td className={clsx("py-3 pr-3", q.pickupOnTimePct < 85 ? "font-medium text-flag-red" : "text-ink-2")}>{q.pickupOnTimePct}%</td>
                    <td className="py-3 pr-3 text-ink-2">{q.chargedWeightGrams / 1000} kg</td>
                    <td className="py-3 pr-5 text-right font-semibold text-ink">
                      {formatINR(q.total)}
                      {q.codCharge ? <div className="text-[11px] font-normal text-muted">incl. COD {formatINR(q.codCharge)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
