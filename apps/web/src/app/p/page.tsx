"use client";

import clsx from "clsx";
import { AlertTriangle, BellRing, Camera, Check, ChevronRight, Clock, Handshake, Loader2, LogOut, MapPin, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Badge, Button, DemoBadge, inputClass } from "@/components/ui/primitives";
import {
  confirmPartnerPickup,
  getMe,
  getPartnerHome,
  logout,
  type PartnerHome,
  type PartnerIssue,
  type PartnerPickup,
  type PickupProblem,
  reportPickupProblem,
  waited,
} from "@/lib/api";
import { herePosition, shrinkPhoto } from "@/lib/photo";

const PROBLEMS: { key: PickupProblem; label: string }[] = [
  { key: "CLOSED", label: "Warehouse closed" },
  { key: "NOT_READY", label: "Parcels not ready" },
  { key: "ADDRESS", label: "Can't find the address" },
  { key: "NO_EXECUTIVE", label: "No executive for this slot" },
  { key: "OTHER", label: "Other" },
];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The courier partner app: what is waiting on you, and today's pickups. Everything is done here, on the record. */
export default function PartnerHomePage() {
  const [data, setData] = useState<PartnerHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getPartnerHome());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    getMe().then(
      (m) => {
        if (m.role === "VENDOR") window.location.replace("/v");
        else if (m.role !== "COURIER") window.location.replace("/");
      },
      () => window.location.replace("/p/login"),
    );
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const mine = data?.issues.filter((i) => i.yourTurn) ?? [];
  const others = data?.issues.filter((i) => !i.yourTurn) ?? [];

  return (
    <div className="px-5 pb-12 pt-6">
      <header className="flex items-center justify-between">
        <Logo />
        <button
          onClick={async () => {
            await logout().catch(() => {});
            window.location.replace("/p/login");
          }}
          className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink"
        >
          <LogOut size={15} /> Sign out
        </button>
      </header>

      {error ? <p className="mt-6 rounded-lg bg-flag-red-soft px-3 py-2 text-[14px] text-flag-red">{error}</p> : null}
      {!data ? (
        <p className="mt-16 flex items-center justify-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <div className="mt-7">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-orange">{data.courier.name} · partner</p>
            <h1 className="mt-1 font-display text-[26px] font-bold text-navy">Hi {data.me.name.replace(/ \(demo\)$/, "")}</h1>
            <p className={clsx("mt-1 text-[15px]", data.counts.yourTurn ? "font-medium text-flag-red" : "text-muted")}>
              {data.counts.yourTurn ? `${data.counts.yourTurn} waiting on you` : "Nothing waiting on you"}
              {data.counts.toConfirm ? ` · ${data.counts.toConfirm} pickup${data.counts.toConfirm > 1 ? "s" : ""} to confirm` : ""}
            </p>
          </div>

          <Section title="Waiting on you" note="Answer with a name and a time, or the result. Reminders stop when you do.">
            {mine.length ? mine.map((i) => <IssueCard key={i.id} i={i} />) : <Empty text="All answered. Thank you." />}
          </Section>

          <Section title="Pickups" note="Confirm each one with the executive's name before the slot. Not confirmed 2 hours before, the parcels go to another courier." right={<DemoBadge />}>
            {data.pickups.length ? data.pickups.map((p) => <PickupCard key={p.id} p={p} onChanged={load} />) : <Empty text="No pickups today or tomorrow." />}
          </Section>

          {others.length ? (
            <Section title="Other open issues" note="Waiting on the vendor or on D2C. Shown so you know where each one stands.">
              {others.map((i) => (
                <IssueCard key={i.id} i={i} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({ title, note, right, children }: { title: string; note?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
        {right}
      </div>
      {note ? <p className="mt-0.5 text-[13px] text-muted">{note}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-line bg-white px-4 py-5 text-center text-[14px] text-muted">{text}</p>;
}

function IssueCard({ i }: { i: PartnerIssue }) {
  return (
    <Link href={`/p/issues/${i.id}`} className={clsx("block rounded-xl border bg-white px-4 py-3.5 hover:bg-page/60", i.yourTurn ? "border-flag-red/30" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">{i.title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{i.about}</p>
        </div>
        <ChevronRight size={18} className="mt-0.5 shrink-0 text-faint" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
        {!i.promiseAt ? (
          <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5", i.yourTurn ? "bg-flag-red-soft text-flag-red" : "bg-page text-ink-2")}>
            <Clock size={12} /> {i.yourTurn ? `Waiting on you ${waited(i.waitedMinutes)}` : `Waiting ${waited(i.waitedMinutes)}`}
          </span>
        ) : null}
        {i.reminders ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-amber-soft px-2 py-0.5 text-[#b54708]">
            <BellRing size={12} /> {i.reminders} reminder{i.reminders > 1 ? "s" : ""} unanswered
          </span>
        ) : null}
        {i.promiseAt ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-blue-soft px-2 py-0.5 text-brand-blue">
            <Handshake size={12} /> You promised {time(i.promiseAt)}
          </span>
        ) : null}
        {i.promisesBroken ? <span className="rounded-full bg-flag-red-soft px-2 py-0.5 text-flag-red">{i.promisesBroken} promise missed</span> : null}
        {i.assignedToYou ? <span className="rounded-full bg-page px-2 py-0.5 text-ink-2">Assigned to you</span> : null}
      </div>
    </Link>
  );
}

function PickupCard({ p, onChanged }: { p: PartnerPickup; onChanged: () => void }) {
  const [mode, setMode] = useState<null | "confirm" | "problem">(p.status === "SCHEDULED" && p.canConfirm ? "confirm" : null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState<PickupProblem | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setMode(null);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">
            {p.warehouse} <span className="font-normal text-muted">· {day(p.slotStart)}, {p.slot}</span>
          </p>
          <p className="mt-0.5 flex items-start gap-1 text-[13px] text-muted">
            <MapPin size={13} className="mt-0.5 shrink-0" /> {p.address}
          </p>
          <p className="text-[13px] text-muted">
            {p.contact} · open {p.hours}
          </p>
        </div>
        {p.status === "CONFIRMED" ? <Badge tone="blue">Confirmed</Badge> : <Badge tone="amber">Not confirmed</Badge>}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-2">
        <Truck size={14} /> {p.parcels} parcel{p.parcels > 1 ? "s" : ""} · {p.packed} packed by the vendor
        {p.executive ? <span className="text-muted">· Executive {p.executive}</span> : null}
      </p>

      {mode === "confirm" ? (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => confirmPartnerPickup(p.id, name.trim(), phone), "Confirmed. The vendor now knows who is coming.");
          }}
        >
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Executive's name" aria-label="Executive's name" />
          <input className={inputClass} inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="Executive's mobile" aria-label="Executive's mobile" />
          <Button type="submit" disabled={busy || name.trim().length < 2 || !/^[6-9]\d{9}$/.test(phone)}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Confirm pickup
          </Button>
        </form>
      ) : null}

      {mode === "problem" ? (
        <div className="mt-3 space-y-2.5 rounded-lg bg-page/70 p-3">
          <div className="flex flex-wrap gap-1.5">
            {PROBLEMS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setReason(r.key)}
                className={clsx("rounded-full border px-3 py-1 text-[13px]", reason === r.key ? "border-brand-blue bg-brand-blue-soft font-medium text-brand-blue" : "border-line bg-white text-ink-2")}
              >
                {r.label}
              </button>
            ))}
          </div>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, in a line (time you reached, who you spoke to)" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink-2">
              <Camera size={15} /> {photo ? "Photo added" : "Add photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setPhoto(await shrinkPhoto(f));
                }}
              />
            </label>
            {reason === "CLOSED" && !photo ? <span className="text-[12px] text-[#b54708]">A closed claim without a photo is marked as such.</span> : null}
            <Button
              className="ml-auto"
              disabled={busy || !reason}
              onClick={() =>
                void run(async () => reportPickupProblem(p.id, { reason: reason!, note: note.trim() || undefined, dataUrl: photo ?? undefined, ...(photo ? await herePosition() : {}) }), "Reported. D2C and the vendor see it now.")
              }
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />} Report
            </Button>
          </div>
        </div>
      ) : null}

      {msg ? <p className={clsx("mt-2 text-[13px] font-medium", msg.ok ? "text-[#0e6e05]" : "text-flag-red")}>{msg.text}</p> : null}

      <div className="mt-3 flex gap-4 text-[13px] font-medium">
        {p.canConfirm && mode !== "confirm" ? (
          <button onClick={() => setMode("confirm")} className="text-brand-blue hover:underline">
            {p.status === "CONFIRMED" ? "Change executive" : "Confirm pickup"}
          </button>
        ) : null}
        {mode !== "problem" ? (
          <button onClick={() => setMode("problem")} className="text-flag-red hover:underline">
            Report a problem
          </button>
        ) : (
          <button onClick={() => setMode(null)} className="text-muted hover:underline">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
