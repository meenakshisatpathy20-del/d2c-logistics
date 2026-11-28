"use client";

import clsx from "clsx";
import { ChevronRight, FileUp, Sparkles } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, inputClass, type Tone } from "@/components/ui/primitives";
import { type CourierInfo, getCouriers, getTriageLedger, triageChat, type TriageResult } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const KIND: Record<string, { label: string; tone: Tone }> = {
  ASK: { label: "Ask", tone: "blue" },
  PROMISE: { label: "Promise", tone: "green" },
  DONE: { label: "Says done", tone: "green" },
  CLAIM: { label: "Excuse", tone: "red" },
  MONEY: { label: "Money", tone: "amber" },
  BLOCKED: { label: "Blocked", tone: "red" },
  REPLY: { label: "Reply", tone: "grey" },
  INFO: { label: "Chat", tone: "grey" },
};
const PARTY: Record<string, string> = { OURS: "Us", COURIER: "Courier", VENDOR: "Vendor", UNKNOWN: "?" };
const dot: Record<string, string> = { red: "bg-flag-red", amber: "bg-brand-amber", green: "bg-brand-green", blue: "bg-brand-blue", grey: "bg-faint" };
const when = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const SAMPLE = `27/11/26, 11:41 am - Sakshi Shaw D2c: 375723939877
RSM
27/11/26, 7:04 pm - Sakshi Shaw D2c: 375731260024 (RSM)
375731164629
375731175458
27/11/26, 7:05 pm - Haritha: Aligned for tomorrow 12 pm
28/11/26, 2:34 pm - Sakshi Shaw D2c: @~Isha ~ kindly update on status of pickup
Shipment is ready(AWB-375683391562)
28/11/26, 5:46 pm - ~ Isha ~: 80200394713 - is it not yet marked rto getting it update soon`;

export function TriageView() {
  const [couriers, setCouriers] = useState<CourierInfo[]>([]);
  const [courier, setCourier] = useState("");
  const [names, setNames] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TriageResult | null>(null);
  const { data: ledger, refresh } = useLive(getTriageLedger, 30_000);

  useEffect(() => {
    getCouriers().then(setCouriers, () => {});
  }, []);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setText(await f.text());
    e.target.value = "";
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await triageChat({ text, courierCode: courier || undefined, ourNames: names || undefined }));
      setText("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="Read a chat" subtitle="WhatsApp: open the group → ⋮ → More → Export chat → Without media. Or copy messages from WhatsApp Web and paste." />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Whose group is this?" hint="Needed to open cases for AWBs not booked on EcomNext yet">
                <select className={inputClass} value={courier} onChange={(e) => setCourier(e.target.value)}>
                  <option value="">Not one courier</option>
                  {couriers.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Our people in this chat" hint='Names as WhatsApp shows them, e.g. "Sakshi, Meenakshi". "D2C" in a name is always us.'>
                <input className={inputClass} value={names} onChange={(e) => setNames(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder="Paste the chat here…"
              className={clsx(inputClass, "h-auto py-2.5 font-mono text-[12.5px] leading-relaxed")}
            />
            {error ? <p className="text-[13px] font-medium text-flag-red">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={run} disabled={busy || text.trim().length < 2}>
                <Sparkles size={16} /> {busy ? "Reading…" : "Read and file"}
              </Button>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink-2 hover:bg-page">
                <FileUp size={16} /> Upload export (.txt)
                <input type="file" accept=".txt,text/plain" className="hidden" onChange={onFile} />
              </label>
              <button type="button" onClick={() => setText(SAMPLE)} className="text-[13px] text-brand-blue hover:underline">
                Try a sample
              </button>
            </div>
          </div>
        </Card>

        {result ? (
          <Card>
            <CardHeader title="What the agent did" subtitle={result.summary} />
            {result.unmatched.length ? (
              <div className="border-b border-line bg-brand-amber-soft/40 px-5 py-3 text-[13px] text-ink-2">
                <b className="text-ink">Not on EcomNext yet:</b> {result.unmatched.join(", ")}. Still booked elsewhere (Velocity or the courier&apos;s panel); they are chased on the courier&apos;s case.
              </div>
            ) : null}
            <ul className="divide-y divide-line">
              {result.items.map((i, k) => (
                <li key={k} className="flex gap-3 px-5 py-3">
                  <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", dot[i.tone])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <span className="font-semibold text-ink">{i.sender}</span>
                      <Badge tone={i.party === "OURS" ? "orange" : "grey"}>{PARTY[i.party]}</Badge>
                      <Badge tone={KIND[i.kind]?.tone ?? "grey"}>{KIND[i.kind]?.label ?? i.kind}</Badge>
                      <span>{when(i.at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line break-words text-[13.5px] text-ink-2">{i.text}</p>
                    <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink">
                      {i.did.map((d) => (
                        <li key={d}>→ {d}</li>
                      ))}
                    </ul>
                  </div>
                  {i.href ? (
                    <Link href={i.href} className="self-center text-faint hover:text-brand-blue" aria-label="Open case">
                      <ChevronRight size={18} />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <aside className="space-y-4">
        <Card className="p-5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">Resolve Hub ledger</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                [ledger?.stats.total ?? 0, "Messages read"],
                [ledger?.stats.filed ?? 0, "Filed on a case"],
                [ledger?.stats.promised ?? 0, "Promises"],
              ] as const
            ).map(([n, l]) => (
              <div key={l} className="rounded-xl bg-page px-3 py-2.5">
                <p className="font-display text-[20px] font-bold tabular-nums text-navy">{n}</p>
                <p className="text-[11.5px] leading-tight text-muted">{l}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 max-h-[520px] space-y-3 overflow-y-auto">
            {(ledger?.rows ?? []).slice(0, 40).map((m) => (
              <li key={m.id} className="text-[12.5px]">
                <div className="flex items-center gap-1.5 text-muted">
                  <span className="font-semibold text-ink-2">{m.sender}</span>
                  <span>· {when(m.at)}</span>
                  {m.readBy === "AI" ? <Badge tone="blue">AI read</Badge> : null}
                </div>
                <p className="line-clamp-2 break-words text-ink-2">{m.body}</p>
                {m.flagIds[0] ? (
                  <Link href={`/issues/${m.flagIds[0]}`} className="text-brand-blue hover:underline">
                    {KIND[m.kind]?.label ?? m.kind} → case
                  </Link>
                ) : null}
              </li>
            ))}
            {ledger && !ledger.rows.length ? <li className="text-[13px] text-muted">Nothing read yet.</li> : null}
          </ul>
        </Card>
        <Card className="p-5 text-[13px] text-ink-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">How it reads</p>
          <ul className="mt-2 space-y-1.5">
            <li><b className="text-ink">AWB list + “kindly update”</b> opens a case per pickup, waiting on the courier</li>
            <li><b className="text-ink">“Aligned for tomorrow”, “by 4 pm”</b> becomes a promise on the case they answered</li>
            <li><b className="text-ink">“Warehouse closed”</b> is checked against the vendor&apos;s hours</li>
            <li><b className="text-ink">“Picked up”</b> is noted; only the scan closes it</li>
            <li><b className="text-ink">₹ owed, “on hold”</b> opens a money or blocked-booking case</li>
            <li>The same chat pasted twice is never filed twice</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
