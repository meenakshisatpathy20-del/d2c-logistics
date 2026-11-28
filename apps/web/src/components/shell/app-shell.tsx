"use client";

import clsx from "clsx";
import {
  Bell,
  Bot,
  Calculator,
  ChartNoAxesColumn,
  House,
  IndianRupee,
  LogOut,
  Menu,
  MessagesSquare,
  Package,
  Plus,
  Search,
  Siren,
  Settings,
  Truck,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, Suspense, useCallback, useContext, useEffect, useState } from "react";
import { BookingPanel } from "@/components/booking/booking-panel";
import { Logo } from "@/components/ui/logo";
import { getBell, getIssues, getMe, getOrders, logout, markAllRead, markRead, type Me } from "@/lib/api";
import { useLive } from "@/lib/use-live";

type Counts = Partial<Record<string, number>>;

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/orders", label: "Orders", icon: Package, count: (c: Counts) => c.NEW, tone: "orange" },
  { href: "/pickups", label: "Pickups", icon: Truck },
  { href: "/agent", label: "Ops agent", icon: Bot },
  { href: "/triage", label: "Chat triage", icon: MessagesSquare },
  { href: "/issues", label: "Issues", icon: Siren, count: (c: Counts) => c.ISSUES_OURS, tone: "red" },
  { href: "/payments", label: "Payments & COD", icon: IndianRupee },
  { href: "/rates", label: "Rate calculator", icon: Calculator },
  { href: "/reports", label: "Reports", icon: ChartNoAxesColumn },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** Booking, cancelling and changing orders. Mirrors the API's roles. */
export const SHIPPER_ROLES = ["ADMIN", "OPS", "WAREHOUSE"];
const MONEY_ROLES = ["ADMIN", "FINANCE", "OPS"];
const hiddenFor = (href: string, role: string | undefined) =>
  !!role && href === "/payments" && !MONEY_ROLES.includes(role);

type ShellActions = { openBooking: (mode?: "single" | "bulk") => void; me: Me | null; canShip: boolean };
const ShellContext = createContext<ShellActions>({ openBooking: () => {}, me: null, canShip: false });
export const useShell = () => useContext(ShellContext);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Menu badges: new orders, and issues waiting on us. */
const loadCounts = async () => {
  const [orders, issues] = await Promise.all([getOrders({ size: 5 }), getIssues({ waiting: "OURS" })]);
  return { counts: { ...orders.counts, ISSUES_OURS: issues.total } as Counts };
};

export function AppShell({ children }: { children: ReactNode }) {
  const [booking, setBooking] = useState<null | "single" | "bulk">(null);
  const [drawer, setDrawer] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const { data } = useLive(loadCounts, 30_000);
  const counts: Counts = data?.counts ?? {};
  const openBooking = useCallback((mode: "single" | "bulk" = "single") => setBooking(mode), []);

  useEffect(() => {
    getMe().then((m) => {
      // Vendor partners have their own phone view.
      if (m.role === "VENDOR") window.location.replace("/v");
      if (m.role === "COURIER") window.location.replace("/p");
      else setMe(m);
    }, () => {});
  }, []);
  const canShip = !!me && SHIPPER_ROLES.includes(me.role);

  const nav = (onPick?: () => void) => (
    // The current page is only known at request time on order pages, so it streams in.
    <Suspense fallback={<NavLinks counts={counts} pathname={null} onPick={onPick} role={me?.role} />}>
      <ActiveNav counts={counts} onPick={onPick} role={me?.role} />
    </Suspense>
  );

  const userCard = (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-blue text-[12px] font-semibold text-white">
        {(me?.name ?? "··").split(" ").map((w) => w[0]).slice(0, 2).join("")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-white">{me?.name ?? "Signed in"}</span>
        <span className="block truncate text-[11.5px] text-white/50">{me?.email ?? ""}</span>
      </span>
      <button
        onClick={async () => {
          await logout().catch(() => {});
          window.location.replace("/login"); // full reload clears every screen's data
        }}
        className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={16} />
      </button>
    </div>
  );

  return (
    <ShellContext.Provider value={{ openBooking, me, canShip }}>
      <div className="min-h-screen lg:pl-[248px]">
        {/* Desktop menu */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col bg-navy px-3 py-4 lg:flex">
          <Link href="/" className="mb-6 block rounded-xl bg-white px-3 py-2.5" aria-label="Home">
            <Logo compact />
          </Link>
          <div className="flex-1 overflow-y-auto">{nav()}</div>
          {userCard}
        </aside>

        {/* Phone menu */}
        {drawer ? (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button className="absolute inset-0 bg-navy/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-[272px] flex-col bg-navy px-3 py-4">
              <div className="mb-5 flex items-center gap-2">
                <span className="flex-1 rounded-xl bg-white px-3 py-2">
                  <Logo compact />
                </span>
                <button className="grid size-9 place-items-center rounded-lg text-white/70" onClick={() => setDrawer(false)} aria-label="Close menu">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">{nav(() => setDrawer(false))}</div>
              {userCard}
            </aside>
          </div>
        ) : null}

        <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
            <button className="grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-page lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <GlobalSearch />
            <span className="ml-auto" />
            {canShip ? (
              <>
                <button
                  onClick={() => openBooking("bulk")}
                  className="hidden h-10 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-medium text-ink-2 hover:bg-page md:flex"
                >
                  <Upload size={16} /> Bulk upload
                </button>
                <button
                  onClick={() => openBooking("single")}
                  className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-brand-orange px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange-dark"
                >
                  <Plus size={17} /> <span className="hidden sm:inline">Create order</span>
                </button>
              </>
            ) : null}
            <BellMenu />
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>

        {booking ? <BookingPanel key={booking} open initialMode={booking} onClose={() => setBooking(null)} /> : null}
      </div>
    </ShellContext.Provider>
  );
}

function ActiveNav(props: { counts: Counts; onPick?: () => void; role?: string }) {
  return <NavLinks {...props} pathname={usePathname()} />;
}

function NavLinks({ counts, pathname, onPick, role }: { counts: Counts; pathname: string | null; onPick?: () => void; role?: string }) {
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {NAV.filter((item) => !hiddenFor(item.href, role)).map((item) => {
        const active = pathname !== null && isActive(pathname, item.href);
        const n = "count" in item ? item.count(counts) : undefined;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onPick}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon size={17} className={active ? "text-brand-orange" : "text-white/50 group-hover:text-white/80"} />
            <span className="flex-1">{item.label}</span>
            {n ? (
              <span
                className={clsx(
                  "min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 text-white",
                  "tone" in item && item.tone === "red" ? "bg-flag-red" : "bg-brand-orange",
                )}
              >
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

const loadBell = () => getBell();

/** Alerts for me: new problems I own, escalations, summaries. Each opens the exact screen. */
function BellMenu() {
  const router = useRouter();
  const { data, refresh } = useLive(loadBell, 30_000);
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-10 place-items-center rounded-xl text-ink-2 hover:bg-page"
        aria-label={unread ? `${unread} new alerts` : "Alerts"}
        aria-expanded={open}
      >
        <Bell size={19} />
        {unread ? (
          <span className="absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-flag-red px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close alerts" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold text-ink">Alerts</span>
              {unread ? (
                <button
                  onClick={async () => {
                    await markAllRead();
                    void refresh();
                  }}
                  className="text-xs font-medium text-brand-blue hover:underline"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {(data?.items ?? []).length === 0 ? (
                <li className="px-4 py-8 text-center text-[13px] text-muted">No alerts yet. Problems you own will show here.</li>
              ) : (
                data!.items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={async () => {
                        setOpen(false);
                        if (!n.read) await markRead(n.id).catch(() => {});
                        void refresh();
                        if (n.link) router.push(n.link);
                      }}
                      className={clsx("block w-full px-4 py-3 text-left hover:bg-page", !n.read && "bg-brand-orange-soft/40")}
                    >
                      <span className="flex items-start gap-2">
                        {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-orange" /> : <span className="mt-1.5 size-2 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-ink">{n.title}</span>
                          <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[12px] text-muted">{n.body}</span>
                          <span className="mt-1 block text-[11px] text-faint">
                            {new Date(n.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One box finds any order by order number, AWB, customer phone or name. */
function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 md:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/orders?tab=ALL&q=${encodeURIComponent(term)}` : "/orders");
      }}
    >
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search AWB, order no. or phone"
        aria-label="Search orders"
        className="h-10 w-full rounded-xl border border-line bg-page pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-brand-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
      />
    </form>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-navy">{title}</h1>
        {subtitle ? <p className="mt-1 text-[14px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
