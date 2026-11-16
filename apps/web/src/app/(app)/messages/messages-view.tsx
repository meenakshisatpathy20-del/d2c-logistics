"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, Mail, MessageCircle, Smartphone } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { getOutbox } from "@/lib/api";
import { useLive } from "@/lib/use-live";

const CHANNEL = {
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, cls: "text-[#0e6e05] bg-brand-green-soft" },
  SMS: { label: "SMS", icon: Smartphone, cls: "text-brand-blue bg-brand-blue-soft" },
  EMAIL: { label: "Email", icon: Mail, cls: "text-brand-orange-dark bg-brand-orange-soft" },
} as const;

const KIND: Record<string, string> = {
  FLAG: "Alert to owner",
  ESCALATION: "Escalation",
  DAILY_SUMMARY: "9 pm summary",
  VENDOR_PICKUPS: "9 am vendor pickups",
  PICKUP_POSTPONED: "Pickup postponed",
};

export function MessagesView() {
  const [page, setPage] = useState(1);
  const load = useCallback(() => getOutbox(page), [page]);
  const { data } = useLive(load, 30_000);
  return (
    <>
      <div className="mb-4 rounded-xl border border-dashed border-brand-amber bg-brand-amber-soft px-4 py-3 text-[13px] text-[#b54708]">
        <span className="font-semibold">Demo mode:</span> WhatsApp (Meta approval), SMS (DLT registration) and email are not connected yet, so messages are
        kept here exactly as they would be sent. Once the accounts are approved they go out for real, with no other change.
      </div>
      <Card className="overflow-hidden">
        {!data ? (
          <div className="h-48 animate-pulse" />
        ) : data.rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">No messages yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((m) => {
              const ch = CHANNEL[m.channel];
              const Icon = ch.icon;
              return (
                <li key={m.id} className="flex gap-3 px-5 py-3.5">
                  <span className={clsx("grid size-9 shrink-0 place-items-center rounded-xl", ch.cls)}>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-ink">{m.title}</span>
                      <Badge>{KIND[m.kind] ?? m.kind}</Badge>
                      {m.status === "DEMO" ? <Badge tone="amber">Demo · not sent</Badge> : <Badge tone="green">Sent</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {ch.label} to {m.to} · {new Date(m.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </p>
                    <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-[13px] text-ink-2">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data && data.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-muted">
            <span>{data.total} messages</span>
            <span className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40">
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 font-medium text-ink">
                Page {data.page} of {data.pages}
              </span>
              <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} aria-label="Next page" className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40">
                <ChevronRight size={16} />
              </button>
            </span>
          </div>
        ) : null}
      </Card>
    </>
  );
}
