"use client";

import clsx from "clsx";
import { CalendarClock, Check, FileText, Loader2, PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Timeline } from "@/app/(app)/today-view";
import { useShell } from "@/components/shell/app-shell";
import { Badge, Card, DemoBadge, type Tone } from "@/components/ui/primitives";
import { announceShipmentsChanged, type CourierInfo, getCouriers, getToday, getUpcomingPickups, postponePickup, type UpcomingPickup } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const STATE: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: "Scheduled", tone: "grey" },
  CONFIRMED: { label: "Courier confirmed", tone: "blue" },
  PICKED_UP: { label: "Picked up", tone: "green" },
  MISSED: { label: "Missed · moved", tone: "red" },
  REASSIGNED: { label: "Not confirmed · moved", tone: "red" },
  POSTPONED: { label: "Postponed", tone: "amber" },
};

export function PickupsView() {
  const { data } = useLive(getToday, 30_000);
  const { data: days, refresh } = useLive(getUpcomingPickups, 30_000);
  const [couriers, setCouriers] = useState<CourierInfo[] | null>(null);
  useEffect(() => {
    getCouriers().then((c) => setCouriers([...c].sort((a, b) => (b.pickupOnTimePct ?? 0) - (a.pickupOnTimePct ?? 0))), () => {});
  }, []);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px] [&>*]:min-w-0">
      <div className="space-y-6">
        {data ? <Timeline data={data} /> : <Card className="h-64 animate-pulse" />}

        <section>
          <h2 className="mb-3 text-[15px] font-semibold text-ink">All upcoming pickups</h2>
          {!days ? (
            <Card className="h-40 animate-pulse" />
          ) : days.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted">No pickups booked for the next 7 days.</Card>
          ) : (
            <div className="space-y-5">
              {days.map((d) => (
                <div key={d.day}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{d.day}</p>
                  <Card className="divide-y divide-line">
                    {d.pickups.map((p) => (
                      <PickupRow key={p.id} p={p} onChanged={refresh} />
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Pickup reliability</h2>
          <DemoBadge />
        </div>
        <Card className="divide-y divide-line">
          {(couriers ?? []).map((c) => {
            const pct = c.pickupOnTimePct ?? 0;
            const weak = pct < 85;
            return (
              <div key={c.code} className="px-4 py-3">
                <div className="flex items-center justify-between text-[13.5px]">
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className={clsx("font-semibold tabular-nums", weak ? "text-flag-red" : "text-ink")}>{pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-page">
                  <div className={clsx("h-1.5 rounded-full", weak ? "bg-flag-red" : "bg-brand-green")} style={{ width: `${pct}%` }} />
                </div>
                {weak ? <p className="mt-1 text-[11.5px] text-flag-red">Below 85%: never recommended over a reliable courier</p> : null}
              </div>
            );
          })}
        </Card>
        <p className="mt-2 text-xs text-muted">Share of pickups done inside the agreed slot. Recommendations use the cheapest courier at 85% or above.</p>
      </section>
    </div>
  );
}

function PickupRow({ p, onChanged }: { p: UpcomingPickup; onChanged: () => void }) {
  const { canShip } = useShell();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const st = STATE[p.status] ?? { label: p.status, tone: "grey" as const };

  async function postpone() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postponePickup(p.id, reason.trim());
      setMsg({ ok: true, text: `Moved to ${r.movedTo}. The vendor has been told.` });
      setOpen(false);
      announceShipmentsChanged();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[160px] flex-1">
          <p className="text-[13.5px] font-semibold text-ink">
            {p.warehouse.name} <span className="font-normal text-muted">· {p.warehouse.area}</span>
          </p>
          <p className="text-[12.5px] text-muted">
            {p.slot} · {p.courier}
            {p.executive ? ` · ${p.executive}` : ""}
            {p.postponeReason ? ` · “${p.postponeReason}”` : ""}
          </p>
        </div>
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
        <span className={clsx("flex items-center gap-1 text-[12.5px]", p.packed === p.parcelCount && p.parcelCount ? "text-[#0e6e05]" : "text-muted")}>
          <PackageCheck size={14} /> {p.packed}/{p.parcelCount} packed
        </span>
        <span className="flex gap-1.5">
          <a href={p.manifestUrl} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-page">
            <FileText size={13} /> Manifest
          </a>
          {p.canPostpone && canShip ? (
            <button onClick={() => setOpen((v) => !v)} className="flex h-8 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-page">
              <CalendarClock size={13} /> Postpone
            </button>
          ) : null}
        </span>
      </div>
      {open ? (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void postpone();
          }}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason, e.g. vendor stock arriving late"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-[13px] focus:border-brand-blue focus:outline-none"
            autoFocus
          />
          <button disabled={busy || reason.trim().length < 3} className="flex h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-[13px] font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Move to next slot
          </button>
        </form>
      ) : null}
      {msg ? <p className={clsx("mt-2 text-[12.5px] font-medium", msg.ok ? "text-[#0e6e05]" : "text-flag-red")}>{msg.text}</p> : null}
    </div>
  );
}
