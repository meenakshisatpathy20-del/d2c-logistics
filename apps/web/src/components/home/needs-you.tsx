"use client";

import clsx from "clsx";
import { Check, ExternalLink, Loader2, PartyPopper, Siren, UserRound, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/primitives";
import { actOnFlag, announceShipmentsChanged, getTeam, type TeamMember, type TodayData } from "@/lib/api";

type Item = TodayData["needsYou"][number];

let teamCache: Promise<TeamMember[]> | null = null;
const loadTeam = () => (teamCache ??= getTeam());

/**
 * One problem, one owner, one-tap fix. "Do it" records the suggested action
 * and tells the courier; "Close" ends it with a note; the owner can be changed.
 */
export function NeedsYouCard({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | "act" | "resolve" | "reassign">(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (picking && !team) loadTeam().then(setTeam, () => setTeam([]));
  }, [picking, team]);

  async function run(kind: "act" | "resolve" | "reassign", extra: { note?: string; ownerId?: string } = {}) {
    setBusy(kind);
    setError(null);
    try {
      await actOnFlag(item.id, { kind, ...extra });
      setClosing(false);
      setPicking(false);
      announceShipmentsChanged();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={clsx("p-4", item.acted && "bg-page/60")}>
      <div className="flex gap-3">
        <span
          className={clsx(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            item.acted ? "bg-brand-green-soft text-brand-green" : item.severity === "critical" ? "bg-flag-red-soft text-flag-red" : "bg-brand-amber-soft text-brand-amber",
          )}
        >
          {item.acted ? <Check size={17} /> : <Siren size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-semibold text-ink">{item.title}</div>
            {item.orderId ? (
              <Link href={`/orders/${item.orderId}`} className="shrink-0 text-muted hover:text-brand-blue" aria-label="Open order" title="Open order">
                <ExternalLink size={14} />
              </Link>
            ) : null}
          </div>
          <div className="mt-0.5 text-[13px] text-muted">{item.detail}</div>
          {item.acted && item.note ? <div className="mt-1.5 text-[12.5px] font-medium text-[#0e6e05]">✓ {item.note} · waiting for the parcel to move</div> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pl-12">
        <span className="min-w-0 text-xs">
          <span className={clsx("font-medium", item.overdue ? "text-flag-red" : "text-[#b54708]")}>{item.due}</span>
          <button
            onClick={() => setPicking((v) => !v)}
            className="ml-2 inline-flex items-center gap-1 rounded px-1 text-muted hover:bg-page hover:text-ink"
            title="Change owner"
          >
            <UserRound size={12} /> {item.owner} <UserRoundCog size={12} className="opacity-60" />
          </button>
        </span>
        <span className="flex shrink-0 gap-1.5">
          <button
            onClick={() => setClosing((v) => !v)}
            className="h-8 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-page"
          >
            Close
          </button>
          {!item.acted ? (
            <button
              onClick={() => run("act")}
              disabled={!!busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-navy px-3 text-[12.5px] font-medium text-white hover:bg-navy-2 disabled:opacity-60"
            >
              {busy === "act" ? <Loader2 size={13} className="animate-spin" /> : null}
              {item.action}
            </button>
          ) : null}
        </span>
      </div>

      {picking ? (
        <div className="mt-3 ml-12 flex flex-wrap gap-1.5">
          {!team ? (
            <Loader2 size={14} className="animate-spin text-muted" />
          ) : (
            team.map((m) => (
              <button
                key={m.id}
                disabled={!!busy || m.id === item.ownerId}
                onClick={() => run("reassign", { ownerId: m.id })}
                className={clsx(
                  "h-7 rounded-full border px-2.5 text-[12px] font-medium",
                  m.id === item.ownerId ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2 hover:border-faint",
                )}
              >
                {m.name}
              </button>
            ))
          )}
        </div>
      ) : null}

      {closing ? (
        <form
          className="mt-3 ml-12 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("resolve", { note: note.trim() || undefined });
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What fixed it? e.g. delivered on reattempt"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2.5 text-[12.5px] focus:border-brand-blue focus:outline-none"
            autoFocus
          />
          <button disabled={!!busy} className="h-8 rounded-lg bg-brand-green px-3 text-[12.5px] font-semibold text-white disabled:opacity-60">
            {busy === "resolve" ? <Loader2 size={13} className="animate-spin" /> : "Mark solved"}
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 ml-12 text-xs font-medium text-flag-red">{error}</p> : null}
    </Card>
  );
}

export function AllClear() {
  return (
    <Card className="flex flex-col items-center gap-2 p-8 text-center">
      <PartyPopper size={22} className="text-brand-green" />
      <p className="text-sm font-medium text-ink">All clear</p>
      <p className="text-xs text-muted">New problems appear here the moment the rules spot them.</p>
    </Card>
  );
}
