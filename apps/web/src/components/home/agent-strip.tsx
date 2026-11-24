"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getAgentFeed } from "@/lib/api";
import { useLive } from "@/lib/use-live";

/** What the agent did today, on Home, so the team sees the chasing is handled. */
export function AgentStrip() {
  const { data } = useLive(getAgentFeed, 60_000);
  const s = data?.stats;
  const last = data?.messages.filter((m) => m.role === "AGENT").at(-1);
  return (
    <Link href="/agent" className="mb-6 flex items-center gap-4 rounded-2xl border border-line bg-white px-5 py-3.5 hover:border-brand-blue">
      <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-navy text-[12px] font-bold text-white">
        EN
        <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-brand-green" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ink">
          EcomNext Agent · {s ? `${s.actions} chases today · ${s.promisesWatched} promises on the clock` : "loading…"}
          {s?.approvalsWaiting ? <span className="text-brand-orange"> · {s.approvalsWaiting} waiting for your OK</span> : null}
        </span>
        <span className="block truncate text-[12.5px] text-muted">{last ? last.body : "Tell it what to chase in plain words. It messages couriers and vendors for you."}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-brand-blue sm:flex">
        Open chat <ArrowRight size={15} />
      </span>
    </Link>
  );
}
