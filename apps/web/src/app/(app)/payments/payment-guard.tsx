"use client";

import clsx from "clsx";
import { FileUp, ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, inputClass, type Tone } from "@/components/ui/primitives";
import { checkPaymentProof, getPaymentGuard, importStatement, type ProofCheck, setPayees } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { shrinkPhoto } from "@/lib/photo";
import { useLive } from "@/lib/use-live";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Money not received", tone: "amber" },
  MISMATCH: { label: "Paid to wrong account", tone: "red" },
  REFUNDED: { label: "Refunded", tone: "red" },
};
const VERDICT: Record<ProofCheck["verdict"], { label: string; tone: Tone }> = {
  PAID_TO_US: { label: "In our account", tone: "green" },
  WRONG_ACCOUNT: { label: "Wrong account (QR)", tone: "red" },
  REFUNDED: { label: "Refunded", tone: "red" },
  NOT_FOUND: { label: "Not in our records", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
};

/**
 * Payment check: no prepaid order (or COD advance) ships until the money is in
 * our own account and not refunded. Orders it holds, the statement import that
 * releases them, and the screenshot check for "I paid".
 */
export function PaymentGuardPanel() {
  const { data, refresh } = useLive(getPaymentGuard, 30_000);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [proof, setProof] = useState({ orderNumber: "", utr: "", dataUrl: "" });
  const [check, setCheck] = useState<ProofCheck | null>(null);
  const [accounts, setAccounts] = useState<string | null>(null);

  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onStatement = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setCsv(await f.text());
    e.target.value = "";
  };
  const onShot = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      const dataUrl = await shrinkPhoto(f);
      setProof((p) => ({ ...p, dataUrl }));
    }
    e.target.value = "";
  };

  const held = data?.held ?? [];
  return (
    <div className="mb-6 space-y-6">
      <Card>
        <CardHeader
          title="Payment check"
          subtitle="A prepaid order (or a COD advance) ships only when the money is in our own account and has not been refunded. A screenshot or “payment done” is never enough."
          action={
            data ? (
              data.guard === "on" ? (
                <Badge tone="green" dot>
                  <ShieldCheck size={13} /> On
                </Badge>
              ) : (
                <Badge tone="red" dot>
                  <ShieldAlert size={13} /> Off
                </Badge>
              )
            ) : null
          }
        />
        {held.length === 0 ? (
          <p className="px-5 py-6 text-[13.5px] text-muted">No orders on hold. Every prepaid order booked so far has its money in our account.</p>
        ) : (
          <ul className="divide-y divide-line">
            {held.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/orders/${h.id}`} className="font-semibold text-ink hover:text-brand-blue">
                      #{h.orderNumber}
                    </Link>
                    <span className="text-[13px] text-muted">
                      {h.customerName} · {formatINR(h.amount)} {h.paymentMode === "COD" ? "advance" : "prepaid"}
                    </span>
                    <Badge tone={STATUS[h.status]?.tone ?? "grey"}>{STATUS[h.status]?.label ?? h.status}</Badge>
                    {h.shipped ? (
                      <Badge tone="red">
                        With {h.shipped.courier} · {h.shipped.awb}
                      </Badge>
                    ) : (
                      <Badge tone="grey">Not shipped</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-ink-2">{h.reason}</p>
                </div>
                {h.issueId ? (
                  <Link href={`/issues/${h.issueId}`} className="text-[13px] font-medium text-brand-blue hover:underline">
                    Open issue
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {msg ? <p className="text-[13px] font-medium text-flag-red">{msg}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Import today&apos;s payments</h2>
          <p className="mt-1 text-[13px] text-muted">
            The gateway export or the bank / UPI statement (CSV). Needs order, UTR or payment ID, and amount; refunds and &ldquo;paid to&rdquo; columns are read if present. Held
            orders that are now paid book by themselves; refunded ones are stopped.
          </p>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder={"Order ID,UTR,Amount,Status,Paid To,Refunded\n18906,pay_ABC123,1499,captured,,0"}
            className={clsx(inputClass, "mt-3 h-auto py-2 font-mono text-[12px]")}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy !== null || csv.trim().length < 10}
              onClick={() =>
                go("import", async () => {
                  const r = await importStatement(csv);
                  setCsv("");
                  setMsg(null);
                  setCheck(null);
                  alert(
                    `${r.rows} rows: ${r.added} new, ${r.updated} changed, ${r.unchanged} already known.` +
                      (r.outcomes.length ? `\n\n${r.outcomes.map((o) => `#${o.orderNumber}: ${o.did}`).join("\n")}` : "") +
                      (r.errors.length ? `\n\nSkipped:\n${r.errors.slice(0, 5).join("\n")}` : ""),
                  );
                })
              }
            >
              {busy === "import" ? "Importing…" : "Import"}
            </Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink-2 hover:bg-page">
              <FileUp size={16} /> Choose CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onStatement} />
            </label>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Customer says &ldquo;I paid&rdquo;</h2>
          <p className="mt-1 text-[13px] text-muted">Add their screenshot or the UTR. It is checked against our records: whose account it went to, whether it arrived, and whether it was refunded.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Order number">
              <input className={inputClass} value={proof.orderNumber} onChange={(e) => setProof({ ...proof, orderNumber: e.target.value })} placeholder="18910" />
            </Field>
            <Field label="UTR (if no screenshot)">
              <input className={inputClass} value={proof.utr} onChange={(e) => setProof({ ...proof, utr: e.target.value })} placeholder="12 digits" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              disabled={busy !== null || !proof.orderNumber.trim() || (!proof.utr.trim() && !proof.dataUrl)}
              onClick={() =>
                go("proof", async () => {
                  setCheck(await checkPaymentProof({ orderNumber: proof.orderNumber.trim(), utr: proof.utr.trim() || undefined, dataUrl: proof.dataUrl || undefined }));
                })
              }
            >
              {busy === "proof" ? "Checking…" : "Check payment"}
            </Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink-2 hover:bg-page">
              <FileUp size={16} /> {proof.dataUrl ? "Screenshot added" : "Add screenshot"}
              <input type="file" accept="image/*" className="hidden" onChange={onShot} />
            </label>
          </div>
          {check ? (
            <div className="mt-4 rounded-xl border border-line bg-page p-3.5">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">#{check.orderNumber}</span>
                <Badge tone={VERDICT[check.verdict].tone}>{VERDICT[check.verdict].label}</Badge>
              </div>
              {check.read ? (
                <p className="mt-1 text-[12.5px] text-muted">
                  Screenshot: {[check.read.app, check.read.utr, check.read.payee, check.read.amount ? formatINR(check.read.amount) : null].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
                {check.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
                <li className="font-medium text-ink">Order: {check.payment.did}</li>
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Our accounts</h2>
            <p className="mt-1 text-[13px] text-muted">UPI IDs and QR names money may be paid into. A payment to anything else is treated as a wrong-QR payment.</p>
          </div>
          {accounts === null ? (
            <Button variant="secondary" size="sm" onClick={() => setAccounts((data?.payees ?? []).join("\n"))}>
              Edit
            </Button>
          ) : null}
        </div>
        {accounts === null ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(data?.payees ?? []).map((p) => (
              <Badge key={p} tone="blue">
                {p}
              </Badge>
            ))}
            {data && !data.payees.length ? <span className="text-[13px] text-flag-red">None set: every UPI payment will look like a wrong-QR payment.</span> : null}
          </div>
        ) : (
          <div className="mt-3">
            <textarea value={accounts} onChange={(e) => setAccounts(e.target.value)} rows={3} className={clsx(inputClass, "h-auto py-2 text-[13px]")} placeholder="one per line, e.g. d2cecommerce@icici" />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  go("accounts", async () => {
                    await setPayees(accounts.split(/\n|,/).map((s) => s.trim()).filter(Boolean));
                    setAccounts(null);
                  })
                }
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAccounts(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {data?.recent.length ? (
          <div className="mt-5 overflow-x-auto">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Latest payments seen</p>
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-[12px] text-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Order</th>
                  <th className="py-1.5 pr-3 font-medium">Reference</th>
                  <th className="py-1.5 pr-3 font-medium">Amount</th>
                  <th className="py-1.5 pr-3 font-medium">Paid to</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.recent.slice(0, 12).map((p) => (
                  <tr key={p.reference}>
                    <td className="py-1.5 pr-3 font-medium text-ink">#{p.orderNumber}</td>
                    <td className="py-1.5 pr-3 font-mono text-[12px] text-ink-2">{p.reference}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {formatINR(p.amount)}
                      {p.refunded ? <span className="text-flag-red"> (−{formatINR(p.refunded)})</span> : null}
                    </td>
                    <td className={clsx("py-1.5 pr-3", p.ours ? "text-ink-2" : "font-medium text-flag-red")}>{p.payee ?? "Our gateway"}</td>
                    <td className="py-1.5">
                      <Badge tone={p.status === "CAPTURED" ? "green" : p.status === "FAILED" ? "grey" : "red"}>{p.status.replace("_", " ").toLowerCase()}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
