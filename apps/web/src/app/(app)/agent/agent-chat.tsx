"use client";

import clsx from "clsx";
import { ArrowUp, Check, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type AgentItem, type AgentMsg, askAgent, decideAgent, getAgentFeed } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const QUICK = ["What's pending today?", "Show ageing shipments", "Chase all stuck pickups", "Today's summary"];

const toneDot: Record<string, string> = {
  red: "bg-flag-red",
  amber: "bg-brand-amber",
  green: "bg-brand-green",
  blue: "bg-brand-blue",
  grey: "bg-faint",
};

const time = (at: string) => new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

function Row({ i }: { i: AgentItem }) {
  const inner = (
    <>
      <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", toneDot[i.tone ?? "grey"])} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">{i.label}</span>
        {i.sub ? <span className="block truncate text-[12.5px] text-muted">{i.sub}</span> : null}
      </span>
      {i.days !== undefined ? (
        <span className={clsx("shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums", i.days >= 3 ? "bg-flag-red-soft text-flag-red" : "bg-brand-amber-soft text-brand-amber")}>
          {i.days}d
        </span>
      ) : null}
      {i.href ? <ChevronRight size={15} className="mt-0.5 shrink-0 text-faint" /> : null}
    </>
  );
  return i.href ? (
    <Link href={i.href} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-page">
      {inner}
    </Link>
  ) : (
    <div className="flex items-start gap-2.5 px-2 py-1.5">{inner}</div>
  );
}

function Bubble({ m, approval, onDecide, onTip, busy }: { m: AgentMsg; approval?: { status: string; result: string | null }; onDecide: (id: string, ok: boolean) => void; onTip: (t: string) => void; busy: boolean }) {
  if (m.role === "USER")
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-md bg-brand-blue px-4 py-2.5 text-[14px] text-white">
          {m.body}
          <span className="mt-0.5 block text-right text-[11px] text-white/60">{m.by} · {time(m.at)}</span>
        </div>
      </div>
    );
  const d = m.data ?? {};
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy text-[11px] font-bold text-white">EN</span>
      <div className="min-w-0 max-w-[85%] flex-1">
        <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
          <span className="font-semibold text-ink-2">EcomNext Agent</span>
          <span>{time(m.at)}</span>
          {d.routine ? <span className="rounded bg-brand-blue-soft px-1.5 text-[11px] font-medium text-brand-blue">by itself</span> : null}
          {d.inbound ? <span className="rounded bg-brand-green-soft px-1.5 text-[11px] font-medium text-brand-green">partner replied</span> : null}
        </div>
        <div className="rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3">
          <p className="text-[14px] leading-relaxed text-ink">{m.body}</p>
          {d.items?.length ? <div className="-mx-2 mt-2">{d.items.map((i, k) => <Row key={k} i={i} />)}</div> : null}
          {d.groups?.map((g) => (
            <div key={g.title} className="mt-3">
              <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{g.title}</p>
              <div className="-mx-2">{g.items.map((i, k) => <Row key={k} i={i} />)}</div>
            </div>
          ))}
          {d.tips?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.tips.map((t) => (
                <button key={t} onClick={() => onTip(t)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:border-brand-blue hover:text-brand-blue">
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          {d.approvalId && approval ? (
            approval.status === "PENDING" ? (
              <div className="mt-3 flex gap-2 border-t border-line pt-3">
                <button disabled={busy} onClick={() => onDecide(d.approvalId!, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  <Check size={15} /> Confirm switch
                </button>
                <button disabled={busy} onClick={() => onDecide(d.approvalId!, false)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-page disabled:opacity-50">
                  <X size={15} /> Cancel
                </button>
              </div>
            ) : (
              <p className="mt-3 border-t border-line pt-2 text-[12.5px] text-muted">
                {approval.status === "DONE" ? "Approved and done" : approval.status === "CANCELLED" ? "Cancelled" : approval.status === "FAILED" ? `Failed: ${approval.result}` : "Working…"}
              </p>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AgentChat() {
  const { data, refresh } = useLive(getAgentFeed, 15_000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AgentMsg | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = [...(data?.messages ?? []), ...(pending ? [pending] : [])];
  const approvals = new Map((data?.approvals ?? []).map((a) => [a.id, a]));
  const stats = data?.stats;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    setText("");
    setPending({ id: "pending", role: "USER", by: "You", body: t, at: new Date().toISOString() });
    try {
      await askAgent(t);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      await refresh();
      setPending(null);
      setBusy(false);
    }
  };
  const decide = async (id: string, ok: boolean) => {
    setBusy(true);
    try {
      await decideAgent(id, ok);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      await refresh();
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
      <section className="flex h-[calc(100vh-7rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-page">
        <header className="flex items-center gap-3 border-b border-line bg-white px-5 py-3.5">
          <span className="relative grid size-10 place-items-center rounded-full bg-navy text-[13px] font-bold text-white">
            EN
            <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-brand-green" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[17px] font-bold text-navy">EcomNext Agent</h1>
            <p className="truncate text-[12.5px] text-muted">Chases couriers and vendors for us, holds them to their time, and asks before anything risky.</p>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            <div className="mx-auto mt-10 max-w-md text-center">
              <p className="font-display text-[20px] font-bold text-navy">Nobody types “gentle reminder” again</p>
              <p className="mt-2 text-[14px] text-muted">Tell me what you need in plain words. I message the courier, note the time they give, check back and escalate. Every step is logged in the issue room.</p>
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} m={m} approval={m.data?.approvalId ? approvals.get(m.data.approvalId) : undefined} onDecide={decide} onTip={send} busy={busy} />)
          )}
          {busy && pending ? <p className="pl-11 text-[13px] text-muted">Working on it…</p> : null}
          <div ref={end} />
        </div>

        <div className="border-t border-line bg-white px-4 pb-4 pt-3">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} disabled={busy} onClick={() => send(q)} className="rounded-full bg-page px-3 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-brand-blue-soft hover:text-brand-blue disabled:opacity-50">
                {q}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-line bg-white py-1.5 pl-4 pr-1.5 focus-within:border-brand-blue">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "Chase Delhivery" or "Where is 1042?"' className="h-9 flex-1 bg-transparent text-[14px] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 placeholder:text-faint" />
            <button disabled={busy || !text.trim()} className="grid size-9 place-items-center rounded-lg bg-brand-orange text-white disabled:bg-line" aria-label="Send">
              <ArrowUp size={18} />
            </button>
          </form>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">Agent today</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat n={stats?.actions ?? 0} label="Chases & actions" />
            <Stat n={`${Math.floor((stats?.minutesSaved ?? 0) / 60)}h ${(stats?.minutesSaved ?? 0) % 60}m`} label="Team time saved" />
            <Stat n={stats?.promisesWatched ?? 0} label="Promises on the clock" />
            <Stat n={stats?.approvalsWaiting ?? 0} label="Waiting for your OK" tone={stats?.approvalsWaiting ? "text-brand-orange" : undefined} />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">Runs by itself</p>
          <ul className="mt-3 space-y-2.5 text-[13px] text-ink-2">
            <li><b className="text-ink">9 am & 6 pm</b> pending list to every courier, with days waiting</li>
            <li><b className="text-ink">Every 2 hours</b> reminds whoever owes an answer</li>
            <li><b className="text-ink">Promise time passes</b> asks again, then their manager</li>
            <li><b className="text-ink">Ignored 3 times</b> moves waiting parcels to another courier and tells you here</li>
            <li><b className="text-ink">7 pm</b> summary: who answered, who stayed silent, ₹ held up</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">Also try</p>
          <div className="mt-2 flex flex-col items-start gap-1">
            {["Book all new orders", "Switch Ekart at Star India", "Credit ₹1,788 from Delhivery by Friday 5 pm"].map((t) => (
              <button key={t} onClick={() => send(t)} className="text-left text-[13px] text-brand-blue hover:underline">
                “{t}”
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number | string; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-page px-3 py-2.5">
      <p className={clsx("font-display text-[22px] font-bold tabular-nums text-navy", tone)}>{n}</p>
      <p className="text-[11.5px] leading-tight text-muted">{label}</p>
    </div>
  );
}
