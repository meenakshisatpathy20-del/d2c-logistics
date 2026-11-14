"use client";

import clsx from "clsx";
import { Bell, ChartNoAxesColumn, Handshake, Inbox, Plus, Sun, Waypoints } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { BookingPanel } from "@/components/booking/booking-panel";
import { Logo } from "@/components/ui/logo";

const NAV = [
  { href: "/", label: "Today", icon: Sun, ready: true },
  { href: "/shipments", label: "Shipments", icon: Waypoints, ready: true },
  { href: "/inbox", label: "Inbox", icon: Inbox, ready: false, count: 4 },
  { href: "/partners", label: "Partners", icon: Handshake, ready: false },
  { href: "/insights", label: "Insights", icon: ChartNoAxesColumn, ready: false },
];

type ShellActions = { openBooking: () => void };
const ShellContext = createContext<ShellActions>({ openBooking: () => {} });
export const useShell = () => useContext(ShellContext);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [booking, setBooking] = useState(false);
  const openBooking = useCallback(() => setBooking(true), []);

  return (
    <ShellContext.Provider value={{ openBooking }}>
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
            <Link href="/" aria-label="Today" className="shrink-0">
              <Logo compact />
            </Link>

            <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
              {NAV.map(({ href, label, icon: Icon, ready, count }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={ready ? href : pathname}
                    aria-current={active ? "page" : undefined}
                    aria-disabled={!ready}
                    title={ready ? undefined : "Coming next"}
                    className={clsx(
                      "relative flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                      active ? "text-navy" : ready ? "text-muted hover:bg-page hover:text-ink" : "text-faint",
                    )}
                  >
                    <Icon size={16} className={active ? "text-brand-orange" : undefined} />
                    {label}
                    {count ? (
                      <span className="grid min-w-4 place-items-center rounded-full bg-flag-red px-1 text-[10px] font-bold text-white">
                        {count}
                      </span>
                    ) : null}
                    {active ? <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brand-orange" /> : null}
                  </Link>
                );
              })}
            </nav>

            <button
              onClick={openBooking}
              className="ml-auto hidden h-10 items-center gap-2 rounded-xl bg-brand-orange px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange-dark sm:flex"
            >
              <Plus size={17} /> New shipment
            </button>

            <button className="relative ml-auto grid size-10 place-items-center rounded-xl text-ink-2 hover:bg-page sm:ml-0" aria-label="4 alerts">
              <Bell size={18} />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-flag-red ring-2 ring-white" />
            </button>
            <div
              className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-blue text-[12.5px] font-semibold text-white"
              title="Ops Manager · D2C Ecommerce India"
            >
              OM
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>

        {/* Phone: bottom tabs with a centre "new" button */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {NAV.slice(0, 2).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                isActive(pathname, href) ? "text-brand-orange" : "text-muted",
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
          <button onClick={openBooking} className="flex flex-col items-center justify-center" aria-label="New shipment">
            <span className="-mt-6 grid size-12 place-items-center rounded-2xl bg-brand-orange text-white shadow-lg">
              <Plus size={22} />
            </span>
          </button>
          {NAV.slice(2, 4).map(({ href, label, icon: Icon }) => (
            <span key={href} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-faint">
              <Icon size={20} />
              {label}
            </span>
          ))}
        </nav>

        <BookingPanel open={booking} onClose={() => setBooking(false)} />
      </div>
    </ShellContext.Provider>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-bold tracking-tight text-navy">{title}</h1>
        {subtitle ? <p className="mt-1 text-[14.5px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
