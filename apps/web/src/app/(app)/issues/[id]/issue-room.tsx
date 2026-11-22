"use client";

import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Send,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";
import { costText, IssueChips, PARTY_NAME, PARTY_TONE, WaitingOn } from "@/components/issues/issue-bits";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui/primitives";
import { issuePhotoUrl, actOnIssue, getIssue, type IssueAction, type IssueDetail, type Party } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const VIA: Record<string, { label: string; icon: typeof Phone }> = {
  WHATSAPP: { label: "WhatsApp (old)", icon: MessageCircle },
  CALL: { label: "Call", icon: PhoneCall },
  EMAIL: { label: "Email", icon: Mail },
  IN_PERSON: { label: "In person", icon: PhoneCall },
  PLATFORM: { label: "In the app", icon: Smartphone },
  APP: { label: "In the app", icon: Smartphone },
};

const KIND_LABEL: Record<string, string> = {
  ASK: "Asked",
  PARTNER_REPLY: "Replied",
  PHOTO: "Photo",
  CALL_NOTE: "Call note",
  REMINDER: "Reminder",
  PROMISE_BROKEN: "Promise missed",
  ESCALATED: "Escalated",
  RESOLVED: "Solved",
  SYSTEM: "Raised",
  ACTION: "Action",
};

type Tab = "note" | "ask" | "reply" | "call" | "solve";

/** One problem, worked to the end in one place, with every step on the record. */
export function IssueRoom({ id }: { id: string }) {
  const load = useCallback(() => getIssue(id), [id]);
  const { data: issue, error, refresh } = useLive(load, 20_000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(a: IssueAction, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await actOnIssue(id, a);
      await refresh();
      if (ok) setMsg({ ok: true, text: ok });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !issue) return <Card className="p-10 text-center text-sm text-flag-red">{error}</Card>;
  if (!issue)
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
        <Loader2 size={18} className="animate-spin" /> Loading issue…
      </div>
    );

  return (
    <>
      <Link href="/issues" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Issues
      </Link>

      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={clsx("size-2.5 rounded-full", !issue.open ? "bg-brand-green" : issue.severity === "critical" ? "bg-flag-red" : "bg-brand-amber")} />
          <h1 className="font-display text-[24px] font-bold tracking-tight text-navy">{issue.title}</h1>
          {issue.open ? <IssueChips r={issue} /> : <Badge tone="green">Solved: {issue.outcome}</Badge>}
        </div>
        <p className="mt-1 text-[14px] text-muted">
          {issue.about ? (
            <>
              {issue.about.kind === "order" ? (
                <Link href={`/orders/${issue.about.id}`} className="font-medium text-brand-blue hover:underline">
                  {issue.about.label}
                </Link>
              ) : (
                <span className="font-medium text-ink-2">{issue.about.label}</span>
              )}{" "}
              · {issue.about.sub} ·{" "}
            </>
          ) : null}
          opened {when(issue.openedAt)}
        </p>
        {issue.open ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <WaitingOn party={issue.waitingOn} person={issue.waitingPerson} minutes={issue.waitedMinutes} />
            {costText(issue.cost) ? <span className="text-[13px] font-medium text-ink-2">Costing us: {costText(issue.cost)}</span> : null}
          </div>
        ) : null}
      </div>

      {msg ? <p className={clsx("mb-4 rounded-lg px-3 py-2 text-[13px] font-medium", msg.ok ? "bg-brand-green-soft text-[#0e6e05]" : "bg-flag-red-soft text-flag-red")}>{msg.text}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="space-y-5">
          <Card>
            <h2 className="border-b border-line px-5 py-3.5 text-[14.5px] font-semibold text-ink">What happened, in order</h2>
            <ol className="space-y-4 px-5 py-4">
              {issue.events.map((e) => {
                const via = e.via ? VIA[e.via] : null;
                const ViaIcon = via?.icon;
                return (
                  <li key={e.id} className="flex gap-3">
                    <span className={clsx("grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold", PARTY_TONE[e.party] ?? PARTY_TONE.SYSTEM)}>
                      {e.party === "SYSTEM" ? "D2C" : e.by.replace(/\(.*\)/, "").trim().split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                        <span className="font-semibold text-ink">{e.by}</span>
                        <span className="text-muted">{PARTY_NAME[e.party]}</span>
                        <span className={clsx("font-medium", e.kind === "PROMISE_BROKEN" || e.kind === "ESCALATED" ? "text-flag-red" : e.kind === "RESOLVED" ? "text-[#0e6e05]" : "text-muted")}>
                          · {KIND_LABEL[e.kind] ?? "Message"}
                        </span>
                        {via && ViaIcon ? (
                          <span className="inline-flex items-center gap-1 text-muted">
                            · <ViaIcon size={11} /> {via.label}
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-faint">{when(e.at)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-[13.5px] text-ink-2">{e.body}</p>
                      {e.photoId ? (
                        <a href={issuePhotoUrl(e.photoId)} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={issuePhotoUrl(e.photoId)} alt="Proof photo" className="mt-2 max-h-48 rounded-lg border border-line" />
                        </a>
                      ) : null}
                      {e.promiseAt ? (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-blue-soft px-2 py-0.5 text-[11.5px] font-semibold text-brand-blue">
                          Promised by {when(e.promiseAt)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
          {issue.open ? <Composer issue={issue} busy={busy} run={run} /> : null}
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="border-b border-line px-5 py-3.5 text-[14.5px] font-semibold text-ink">Who is on it</h2>
            <ul className="divide-y divide-line">
              {issue.people.map((p, i) => (
                <li key={i} className={clsx("flex items-start gap-3 px-5 py-3", issue.open && p.party === issue.waitingOn && i === issue.people.findIndex((x) => x.party === issue.waitingOn) && "bg-brand-orange-soft/40")}>
                  <span className={clsx("mt-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide", PARTY_TONE[p.party])}>{PARTY_NAME[p.party]}</span>
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="block font-semibold text-ink">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {p.role} · {p.company}
                    </span>
                    <span className="block text-xs text-faint">{p.lastActive ? `Last active ${when(p.lastActive)}` : "Not active here yet"}</span>
                  </span>
                  {p.phone ? (
                    <a href={`tel:+91${p.phone}`} className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-ink-2 hover:bg-page" aria-label={`Call ${p.name}`} title="Call, then log a call note">
                      <Phone size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          {issue.open ? <QuickActions issue={issue} busy={busy} run={run} /> : null}
        </div>
      </div>
    </>
  );
}

function Composer({ issue, busy, run }: { issue: IssueDetail; busy: boolean; run: (a: IssueAction, ok?: string) => Promise<boolean> }) {
  const [tab, setTab] = useState<Tab>("reply");
  const [text, setText] = useState("");
  const [party, setParty] = useState<Exclude<Party, "OURS">>(issue.waitingOn === "OURS" ? (issue.pickup ? "COURIER" : "COURIER") : (issue.waitingOn as Exclude<Party, "OURS">));
  const [via, setVia] = useState<"CALL" | "EMAIL" | "IN_PERSON">("CALL");
  const [promise, setPromise] = useState("");
  const [nextBy, setNextBy] = useState<Party>("COURIER");
  const [outcome, setOutcome] = useState(issue.outcomes[0]);
  const [fault, setFault] = useState(issue.waitingOn === "OURS" ? "NONE" : issue.waitingOn);
  const parties = issue.people.map((p) => p.party).filter((p, i, a) => p !== "OURS" && a.indexOf(p) === i) as Exclude<Party, "OURS">[];
  const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);
  const clear = () => {
    setText("");
    setPromise("");
  };

  const tabs: { key: Tab; label: string; icon: typeof Send }[] = [
    { key: "reply", label: "Log their reply", icon: MessageCircle },
    { key: "call", label: "Call note", icon: PhoneCall },
    { key: "ask", label: "Ask", icon: Send },
    { key: "note", label: "Team note", icon: MessageSquare },
    { key: "solve", label: "Solve", icon: CheckCircle2 },
  ];

  async function submit() {
    let ok = false;
    if (tab === "note") ok = await run({ kind: "message", body: text });
    if (tab === "ask") ok = await run({ kind: "ask", party, body: text }, `Sent to ${PARTY_NAME[party].toLowerCase()} with a link to this issue. Reminders follow every 2 hours until they answer.`);
    if (tab === "reply") ok = await run({ kind: "partner_reply", party, via, body: text, promiseAt: iso(promise) }, promise ? "Logged. Their promised time is now tracked." : "Logged on the record.");
    if (tab === "call") ok = await run({ kind: "call_note", party, agreed: text, nextBy, deadline: iso(promise) }, "Call note saved.");
    if (tab === "solve") ok = await run({ kind: "resolve", outcome, faultParty: fault, note: text || undefined }, "Solved and closed.");
    if (ok) clear();
  }

  const disabled = busy || (tab !== "solve" && text.trim().length < 2);
  return (
    <Card>
      <div className="flex overflow-x-auto border-b border-line" role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={clsx("relative flex shrink-0 items-center gap-1.5 px-4 py-3 text-[13px] font-medium", tab === key ? (key === "solve" ? "text-[#0e6e05]" : "text-brand-orange-dark") : "text-muted hover:text-ink")}
          >
            <Icon size={14} /> {label}
            {tab === key ? <span className={clsx("absolute inset-x-3 bottom-0 h-0.5 rounded-full", key === "solve" ? "bg-brand-green" : "bg-brand-orange")} /> : null}
          </button>
        ))}
      </div>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-xs text-muted">
          {tab === "reply" && "Partners answer in their own app. A reply that came on a call, by email or in person: log it here so it counts on the record. A reply with a time becomes a promise we track."}
          {tab === "call" && "After any call: what was agreed, who does the next step, and by when."}
          {tab === "ask" && "Lands in their partner app (vendor or courier), with an SMS link to it. The turn passes to them and reminders go out by themselves."}
          {tab === "note" && "Seen by our team only."}
          {tab === "solve" && "Close it on what actually happened, and who was at fault. It counts on that side's scorecard."}
        </p>
        {tab !== "note" && tab !== "solve" ? (
          <div className="flex flex-wrap gap-2">
            {parties.map((p) => (
              <button key={p} type="button" onClick={() => setParty(p)} className={clsx("h-8 rounded-full border px-3 text-[12.5px] font-medium", party === p ? "border-navy bg-navy text-white" : "border-line text-ink-2")}>
                {tab === "ask" ? "Ask " : tab === "call" ? "Call with " : "From "}
                {PARTY_NAME[p].toLowerCase()}
              </button>
            ))}
            {tab === "reply" ? (
              <select value={via} onChange={(e) => setVia(e.target.value as typeof via)} className="h-8 rounded-full border border-line px-3 text-[12.5px]">
                <option value="CALL">on a call</option>
                <option value="EMAIL">by email</option>
                <option value="IN_PERSON">in person</option>
              </select>
            ) : null}
          </div>
        ) : null}
        {tab === "solve" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What actually solved it">
              <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {issue.outcomes.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Whose fault was the problem">
              <select className={inputClass} value={fault} onChange={(e) => setFault(e.target.value)}>
                {["COURIER", "VENDOR", "CUSTOMER", "OURS", "NONE"].map((p) => (
                  <option key={p} value={p}>
                    {p === "NONE" ? "Nobody" : PARTY_NAME[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={
            tab === "reply"
              ? 'e.g. "Executive Ramesh will reach by 4 pm"'
              : tab === "call"
                ? "What was agreed"
                : tab === "ask"
                  ? "e.g. Please assign an executive and tell us the time"
                  : tab === "solve"
                    ? "Anything to add (optional)"
                    : "Note for the team"
          }
          className={`${inputClass} h-auto py-2`}
        />
        {tab === "reply" || tab === "call" ? (
          <div className="flex flex-wrap items-end gap-3">
            {tab === "call" ? (
              <Field label="Next step by">
                <select className={`${inputClass} w-40`} value={nextBy} onChange={(e) => setNextBy(e.target.value as Party)}>
                  {(["OURS", ...parties] as Party[]).map((p) => (
                    <option key={p} value={p}>
                      {PARTY_NAME[p]}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={tab === "reply" ? "They promised a time? (optional)" : "By when"}>
              <input type="datetime-local" className={`${inputClass} w-56`} value={promise} onChange={(e) => setPromise(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={disabled} className={tab === "solve" ? "bg-brand-green hover:bg-[#0e6e05]" : undefined}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {tab === "solve" ? "Mark solved" : tab === "ask" ? "Send" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function QuickActions({ issue, busy, run }: { issue: IssueDetail; busy: boolean; run: (a: IssueAction, ok?: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState<null | "postpone" | "switch">(null);
  const p = issue.pickup;
  return (
    <Card>
      <h2 className="border-b border-line px-5 py-3.5 text-[14.5px] font-semibold text-ink">Fix it from here</h2>
      <div className="space-y-2 p-4">
        {p ? (
          <>
            <p className="text-xs text-muted">
              {p.warehouse} · {p.courier} · {when(p.slotStart)}
            </p>
            <p className={clsx("text-xs", p.slotInHours ? "text-ink-2" : "font-medium text-flag-red")}>
              Vendor open {p.hours}
              {p.slotInHours ? " · slot is inside these hours" : " · slot is outside these hours"}
            </p>
            {p.canSwitch ? (
              <Action icon={<ArrowRightLeft size={15} />} onClick={() => setOpen(open === "switch" ? null : "switch")}>
                Switch courier for these parcels
              </Action>
            ) : null}
            {p.canPostpone ? (
              <Action icon={<CalendarClock size={15} />} onClick={() => setOpen(open === "postpone" ? null : "postpone")}>
                Move to the next slot
              </Action>
            ) : null}
            <a href={p.manifestUrl} target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-page">
              <FileText size={15} /> Manifest
            </a>
            {open ? (
              <form
                className="flex gap-2 pt-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await run(open === "switch" ? { kind: "switch_courier", reason } : { kind: "postpone", reason }, open === "switch" ? "Parcels moved to the most reliable courier. The old booking is cancelled." : "Moved to the next slot. The vendor is told.");
                  if (ok) {
                    setOpen(null);
                    setReason("");
                  }
                }}
              >
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="h-9 min-w-0 flex-1 rounded-lg border border-line px-2.5 text-[13px] focus:border-brand-blue focus:outline-none" autoFocus />
                <Button size="sm" type="submit" disabled={busy || reason.trim().length < 3}>
                  Do it
                </Button>
              </form>
            ) : null}
          </>
        ) : null}
        {issue.order ? (
          <Link href={`/orders/${issue.order.id}`} className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-page">
            <FileText size={15} /> Open order #{issue.order.orderNumber} to book it
          </Link>
        ) : null}
        {issue.about?.kind === "courier" ? (
          <Link href="/settings" className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-page">
            <FileText size={15} /> {issue.about.label}: connection and on/off switch
          </Link>
        ) : null}
        {issue.shipment ? (
          <Link href={`/orders/${issue.shipment.orderId}`} className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-page">
            <FileText size={15} /> Open order #{issue.shipment.orderNumber}
          </Link>
        ) : null}
        <div className="pt-2">
          <p className="mb-1.5 text-xs text-muted">Owner</p>
          <select
            className={inputClass}
            value={issue.owner?.id ?? ""}
            onChange={(e) => e.target.value && void run({ kind: "reassign", ownerId: e.target.value }, "Owner changed.")}
            disabled={busy}
          >
            {!issue.owner ? <option value="">Pick an owner</option> : null}
            {issue.team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Card>
  );
}

function Action({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex h-10 w-full items-center gap-2 rounded-lg border border-line px-3 text-left text-[13px] font-medium text-ink-2 hover:bg-page">
      {icon} {children}
    </button>
  );
}
