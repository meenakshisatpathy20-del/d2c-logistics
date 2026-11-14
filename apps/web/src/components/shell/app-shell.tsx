"use client";

import clsx from "clsx";
import {
  Bell,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  PackagePlus,
  RotateCcw,
  Search,
  Settings,
  Store,
  Truck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

const NAV = [
  { href: "/", label: "Control Tower", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: Boxes },
  { href: "/orders/new", label: "Book shipment", icon: PackagePlus },
  { href: "/pickups", label: "Pickups", icon: Truck },
  { href: "/ownership", label: "Ownership Board", icon: ClipboardList },
  { href: "/chats", label: "Customer chats", icon: MessageSquareText },
  { href: "/returns", label: "Returns & RTO", icon: RotateCcw },
  { href: "/finance", label: "Finance", icon: CircleDollarSign },
  { href: "/vendors", label: "Vendors", icon: Store },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Screens approved and built so far; the rest show as "Soon". */
const READY = new Set(["/", "/orders", "/orders/new"]);

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/orders") return pathname === "/orders";
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-60 shrink-0 border-r border-line bg-white lg:block">
      <aside className="sticky top-0 flex h-screen flex-col">
        <div className="px-5 pb-6 pt-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            const ready = READY.has(href);
            return (
              <Link
                key={href}
                href={ready ? href : "#"}
                aria-current={active ? "page" : undefined}
                aria-disabled={!ready}
                className={clsx(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors duration-150",
                  active ? "bg-brand-orange-soft text-brand-orange-dark" : "text-ink-2 hover:bg-page hover:text-ink",
                  !ready && "pointer-events-none",
                )}
              >
                <Icon size={17} className={active ? "text-brand-orange" : "text-muted"} />
                <span className="flex-1">{label}</span>
                {!ready ? <span className="text-[10px] uppercase tracking-wide text-faint">Soon</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="m-3 rounded-xl border border-brand-amber/30 bg-brand-amber-soft p-3.5">
          <div className="text-[12px] font-semibold text-ink">Couriers in demo mode</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
            8 couriers connected. Each switches to live when its account is ready.
          </p>
        </div>
      </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              placeholder="Search AWB, order ID, customer or phone"
              className="h-10 w-full rounded-lg border border-line bg-page pl-9 pr-3 text-sm placeholder:text-faint focus:border-brand-blue focus:bg-white focus:outline-none"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              className="relative grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-page"
              aria-label="4 open red flags"
            >
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-flag-red text-[10px] font-bold text-white">
                4
              </span>
            </button>
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-full bg-brand-blue text-[13px] font-semibold text-white">
                OM
              </div>
              <div className="hidden leading-tight sm:block">
                <div className="text-[13px] font-semibold">Ops Manager</div>
                <div className="text-[11.5px] text-muted">D2C Ecommerce India</div>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-bold tracking-tight text-navy">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
