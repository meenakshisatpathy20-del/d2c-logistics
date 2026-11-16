"use client";

import clsx from "clsx";
import { Camera, CalendarClock, Check, CheckCircle2, FileText, Loader2, LogOut, Printer, Truck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Badge, DemoBadge, type Tone } from "@/components/ui/primitives";
import {
  API_URL,
  getMe,
  getVendorToday,
  logout,
  markPacked,
  photoUrl,
  postponePickup,
  type UpcomingPickup,
  uploadPackingPhoto,
  type VendorToday,
} from "@/lib/api";
import { formatINR } from "@/lib/format";

const STATE: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: "Courier not confirmed yet", tone: "amber" },
  CONFIRMED: { label: "Courier confirmed", tone: "blue" },
  PICKED_UP: { label: "Picked up", tone: "green" },
  MISSED: { label: "Missed · moved to next slot", tone: "red" },
  REASSIGNED: { label: "Moved to another courier", tone: "red" },
  POSTPONED: { label: "Postponed", tone: "amber" },
};

/** Phones take large photos: shrink to 1280 px JPEG before sending. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => reject(new Error("Could not read this photo"));
    img.src = URL.createObjectURL(file);
  });
}

export default function VendorHome() {
  const [data, setData] = useState<VendorToday | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getVendorToday());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    getMe().then(
      (m) => {
        // Our own team uses the full app, not this phone view.
        if (m.role !== "VENDOR") window.location.replace("/");
      },
      () => {},
    );
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const all = data?.days.flatMap((d) => d.pickups) ?? [];
  const today = data?.days.find((d) => d.day === "Today")?.pickups ?? [];
  const parcels = today.flatMap((p) => p.parcels);

  return (
    <div className="pb-10">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <Logo compact />
        <span className="flex-1" />
        <button
          onClick={async () => {
            await logout().catch(() => {});
            window.location.replace("/v/login");
          }}
          className="grid size-10 place-items-center rounded-xl text-ink-2 hover:bg-page"
          aria-label="Sign out"
        >
          <LogOut size={18} />
        </button>
      </header>

      <div className="px-4 pt-5">
        {error && !data ? (
          <p className="rounded-xl bg-flag-red-soft p-4 text-sm font-medium text-flag-red">{error}</p>
        ) : !data ? (
          <div className="flex items-center justify-center gap-2 py-24 text-muted">
            <Loader2 size={18} className="animate-spin" /> Loading your pickups…
          </div>
        ) : (
          <>
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-brand-orange">{data.warehouse.name}</p>
            <h1 className="mt-1 font-display text-[26px] font-bold leading-tight text-navy">
              {today.length ? `${today.length} pickup${today.length === 1 ? "" : "s"} today` : "No pickups today"}
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              {parcels.length
                ? `${parcels.filter((p) => p.packed).length} of ${parcels.length} parcels packed and ready`
                : "New pickups show here as soon as orders are booked."}
            </p>

            <div className="mt-5 space-y-6">
              {data.days.map((d) => (
                <section key={d.day}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{d.day}</p>
                  <div className="space-y-4">
                    {d.pickups.map((p) => (
                      <PickupCard key={p.id} p={p} onChanged={load} />
                    ))}
                  </div>
                </section>
              ))}
              {all.length === 0 ? (
                <div className="rounded-2xl border border-line bg-white p-8 text-center">
                  <Truck size={26} className="mx-auto text-faint" />
                  <p className="mt-2 text-[15px] font-medium text-ink">Nothing to pack right now</p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PickupCard({ p, onChanged }: { p: UpcomingPickup; onChanged: () => void }) {
  const st = STATE[p.status] ?? { label: p.status, tone: "grey" as const };
  const open = ["SCHEDULED", "CONFIRMED"].includes(p.status);
  const [busy, setBusy] = useState(false);
  const [postponing, setPostponing] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const unpacked = p.parcels.filter((x) => !x.packed);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
      <div className="px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-[22px] font-bold leading-none text-navy">{p.slot}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-ink-2">
              {p.courier} <DemoBadge />
            </p>
          </div>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
        </div>
        {p.executive && p.status === "CONFIRMED" ? <p className="mt-2 text-[13.5px] text-ink-2">Executive: {p.executive}</p> : null}
        {p.postponeReason ? <p className="mt-2 text-[13px] text-muted">Reason: {p.postponeReason}</p> : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={`${API_URL}/api/vendor/pickups/${p.id}/labels.pdf`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[14px] font-medium text-ink-2"
          >
            <Printer size={16} /> Labels
          </a>
          <a
            href={`${API_URL}/api/vendor/pickups/${p.id}/manifest.pdf`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[14px] font-medium text-ink-2"
          >
            <FileText size={16} /> Manifest
          </a>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-line border-t border-line">
        {p.parcels.map((x) => (
          <ParcelRow key={x.id} x={x} editable={open} onChanged={onChanged} />
        ))}
      </ul>

      {open ? (
        <div className="space-y-2 border-t border-line p-4">
          {unpacked.length ? (
            <button
              disabled={busy}
              onClick={() => run(() => markPacked(unpacked.map((u) => u.id)), "Marked packed and ready. The courier will collect in this slot.")}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-orange text-[16px] font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} All {unpacked.length} packed and ready
            </button>
          ) : (
            <p className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-green-soft text-[15px] font-semibold text-[#0e6e05]">
              <Check size={18} /> All packed and ready
            </p>
          )}
          {p.canPostpone ? (
            postponing ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const r = await postponePickup(p.id, reason.trim());
                    setPostponing(false);
                    setMsg({ ok: true, text: `Moved to ${r.movedTo}. D2C operations has been told.` });
                  });
                }}
              >
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why? e.g. stock not ready"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line px-3 text-[15px] focus:border-brand-blue focus:outline-none"
                  autoFocus
                />
                <button disabled={busy || reason.trim().length < 3} className="h-11 rounded-xl bg-navy px-4 text-[14px] font-semibold text-white disabled:opacity-50">
                  Move
                </button>
              </form>
            ) : (
              <button
                onClick={() => setPostponing(true)}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-line text-[14px] font-medium text-ink-2"
              >
                <CalendarClock size={16} /> Not ready? Move to next slot
              </button>
            )
          ) : null}
          {msg ? <p className={clsx("text-center text-[13.5px] font-medium", msg.ok ? "text-[#0e6e05]" : "text-flag-red")}>{msg.text}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ParcelRow({ x, editable, onChanged }: { x: UpcomingPickup["parcels"][number]; editable: boolean; onChanged: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cod = x.payment.startsWith("COD");

  async function addPhoto(f: File) {
    setBusy(true);
    setError(null);
    try {
      await uploadPackingPhoto(x.id, await shrink(f));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          disabled={!editable || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await markPacked([x.id], !x.packed);
              onChanged();
            } finally {
              setBusy(false);
            }
          }}
          aria-label={x.packed ? `Order ${x.orderNumber} packed. Tap to undo` : `Mark order ${x.orderNumber} packed`}
          aria-pressed={x.packed}
          className={clsx(
            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border-2",
            x.packed ? "border-brand-green bg-brand-green text-white" : "border-line bg-white",
          )}
        >
          {x.packed ? <Check size={16} strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">
            #{x.orderNumber} <span className="font-normal text-muted">· {x.brand}</span>
          </p>
          <p className="truncate text-[13.5px] text-ink-2">{x.product}</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {x.city || x.pincode} {x.pincode} · {x.weightKg} kg ·{" "}
            <span className={cod ? "font-semibold text-brand-orange-dark" : ""}>{cod ? `COD ${formatINR(Number(x.payment.slice(4)))}` : "Prepaid"}</span>
          </p>
          <p className="mt-0.5 font-mono text-[11.5px] text-faint">AWB {x.awb}</p>
        </div>
        {editable ? (
          <>
            <input
              ref={file}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addPhoto(f);
              }}
            />
            <button
              onClick={() => file.current?.click()}
              disabled={busy}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-medium text-ink-2"
              aria-label={`Add packing photo for order ${x.orderNumber}`}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} {x.photos.length || ""}
            </button>
          </>
        ) : null}
      </div>
      {x.photos.length ? (
        <div className="mt-2 flex gap-2 pl-10">
          {x.photos.map((id) => (
            <a key={id} href={photoUrl(id)} target="_blank" rel="noreferrer" className="block size-14 overflow-hidden rounded-lg border border-line bg-page">
              {/* Private photos come from the API, so a plain img is used. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(id)} alt={`Packing photo for order ${x.orderNumber}`} className="size-full object-cover" />
            </a>
          ))}
        </div>
      ) : editable ? (
        <p className="mt-1.5 pl-10 text-[12px] text-muted">Add a photo of the packed parcel on the scale: it protects us in weight disputes.</p>
      ) : null}
      {error ? <p className="mt-1.5 pl-10 text-[12.5px] font-medium text-flag-red">{error}</p> : null}
    </li>
  );
}
