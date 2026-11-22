"use client";

import clsx from "clsx";
import { ArrowLeft, Camera, CheckCircle2, Clock, Handshake, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, inputClass } from "@/components/ui/primitives";
import { addPartnerPhoto, answerPartnerIssue, getPartnerIssue, type PartnerIssueView, partnerPhotoUrl, waited } from "@/lib/api";
import { herePosition, shrinkPhoto } from "@/lib/photo";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const TONE: Record<string, string> = {
  OURS: "bg-brand-orange-soft text-brand-orange-dark",
  COURIER: "bg-brand-blue-soft text-brand-blue",
  VENDOR: "bg-brand-amber-soft text-[#b54708]",
  CUSTOMER: "bg-brand-green-soft text-[#0e6e05]",
  SYSTEM: "bg-page text-ink-2",
};

type Kind = "PROMISE" | "DONE" | "MESSAGE";
const KINDS: { key: Kind; label: string; icon: React.ReactNode; hint: string; placeholder: string }[] = [
  { key: "PROMISE", label: "Give a time", icon: <Handshake size={15} />, hint: "Who will do it and by when. Reminders stop until then; a missed time is counted.", placeholder: "e.g. Executive Ramesh will reach by 4 pm" },
  { key: "DONE", label: "It's done", icon: <CheckCircle2 size={15} />, hint: "Say what was done. It closes when the scan or the vendor confirms it.", placeholder: "e.g. Picked up all 6 parcels" },
  { key: "MESSAGE", label: "Message", icon: <MessageSquare size={15} />, hint: "Anything else D2C should know. The turn goes back to them.", placeholder: "e.g. Hub is closed for Diwali till Monday" },
];

/** One issue in the partner app: the story so far, and the courier's answer. */
export function PartnerIssue({ id }: { id: string }) {
  const [issue, setIssue] = useState<PartnerIssueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("PROMISE");
  const [body, setBody] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setIssue(await getPartnerIssue(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      setIssue(await answerPartnerIssue(id, { kind, body: body.trim(), promiseAt: kind === "PROMISE" && at ? new Date(at).toISOString() : undefined }));
      setBody("");
      setAt("");
      setMsg({ ok: true, text: kind === "PROMISE" ? "Time saved. No reminders until then." : "Sent. D2C sees it now." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const current = KINDS.find((k) => k.key === kind)!;

  return (
    <div className="px-5 pb-12 pt-6">
      <Link href="/p" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Back
      </Link>
      {error ? <p className="mt-6 rounded-lg bg-flag-red-soft px-3 py-2 text-[14px] text-flag-red">{error}</p> : null}
      {!issue ? (
        !error ? (
          <p className="mt-16 flex items-center justify-center gap-2 text-muted">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </p>
        ) : null
      ) : (
        <>
          <h1 className="mt-4 font-display text-[22px] font-bold leading-tight text-navy">{issue.title}</h1>
          <p className="mt-1 text-[14px] text-muted">
            {issue.shipment ? `#${issue.shipment.orderNumber} · AWB ${issue.shipment.awb} · ${issue.shipment.city}` : issue.pickup ? `${issue.pickup.warehouse} pickup · ${when(issue.pickup.slotStart)} · open ${issue.pickup.hours}` : issue.message}
          </p>
          <div className="mt-3">
            {!issue.open ? (
              <Badge tone="green">Solved: {issue.outcome}</Badge>
            ) : (
              <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium", issue.promiseAt ? "bg-brand-blue-soft text-brand-blue" : issue.yourTurn ? "bg-flag-red-soft text-flag-red" : "bg-page text-ink-2")}>
                <Clock size={13} />{" "}
                {issue.promiseAt
                  ? `You promised ${when(issue.promiseAt)}`
                  : issue.yourTurn
                    ? `Waiting on you for ${waited(issue.waitedMinutes)}`
                    : `Waiting on ${issue.waitingOnLabel.toLowerCase()}`}
              </span>
            )}
          </div>

          {issue.open ? (
            <div className="mt-6 rounded-xl border border-line bg-white">
              <div className="flex border-b border-line">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => setKind(k.key)}
                    className={clsx("flex flex-1 items-center justify-center gap-1.5 py-3 text-[14px] font-medium", kind === k.key ? "border-b-2 border-brand-orange text-brand-orange" : "text-muted")}
                  >
                    {k.icon} {k.label}
                  </button>
                ))}
              </div>
              <div className="space-y-3 p-4">
                <p className="text-[13px] text-muted">{current.hint}</p>
                <textarea className={`${inputClass} h-20 py-2`} value={body} onChange={(e) => setBody(e.target.value)} placeholder={current.placeholder} />
                {kind === "PROMISE" ? (
                  <label className="block text-[13px] font-medium text-ink-2">
                    By when
                    <input type="datetime-local" className={`${inputClass} mt-1`} value={at} onChange={(e) => setAt(e.target.value)} />
                  </label>
                ) : null}
                <div className="flex items-center gap-2">
                  <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2">
                    <Camera size={15} /> Add proof photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setBusy(true);
                        try {
                          await addPartnerPhoto(id, await shrinkPhoto(f), await herePosition());
                          await load();
                          setMsg({ ok: true, text: "Photo added with the time and place." });
                        } catch (err) {
                          setMsg({ ok: false, text: (err as Error).message });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </label>
                  <Button className="ml-auto" disabled={busy || body.trim().length < 2 || (kind === "PROMISE" && !at)} onClick={() => void send()}>
                    {busy ? <Loader2 size={15} className="animate-spin" /> : null} Send
                  </Button>
                </div>
                {msg ? <p className={clsx("text-[13px] font-medium", msg.ok ? "text-[#0e6e05]" : "text-flag-red")}>{msg.text}</p> : null}
              </div>
            </div>
          ) : null}

          <h2 className="mt-8 text-[15px] font-semibold text-ink">What happened</h2>
          <ol className="mt-3 space-y-3">
            {[...issue.events].reverse().map((e) => (
              <li key={e.id} className="flex gap-3 rounded-xl border border-line bg-white px-3.5 py-3">
                <span className={clsx("h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[e.party] ?? TONE.SYSTEM)}>{e.party === "SYSTEM" ? "D2C" : e.party === "OURS" ? "D2C team" : e.party.charAt(0) + e.party.slice(1).toLowerCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-muted">
                    {e.by} · {when(e.at)}
                  </p>
                  <p className="text-[14px] text-ink">{e.body}</p>
                  {e.photoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={partnerPhotoUrl(e.photoId)} alt="Proof photo" className="mt-2 max-h-56 rounded-lg border border-line" />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
