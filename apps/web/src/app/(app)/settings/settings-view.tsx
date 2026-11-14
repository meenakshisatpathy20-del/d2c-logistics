"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, DemoBadge, Field, inputClass } from "@/components/ui/primitives";
import {
  changePassword,
  type CourierInfo,
  getCouriers,
  getMe,
  getTeam,
  getWarehouses,
  type Me,
  resetPassword,
  type TeamMember,
  type Warehouse,
} from "@/lib/api";

const ROLE: Record<string, string> = { ADMIN: "Admin", OPS: "Operations", SUPPORT: "Support", FINANCE: "Finance", WAREHOUSE: "Warehouse", VENDOR: "Vendor", COURIER: "Courier" };

export function SettingsView() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [couriers, setCouriers] = useState<CourierInfo[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  useEffect(() => {
    getMe().then(setMe, () => {});
    getTeam().then(setTeam, () => {});
    getWarehouses().then(setWarehouses, () => {});
    getCouriers().then(setCouriers, () => {});
  }, []);

  return (
    <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <h2 className="border-b border-line px-5 py-3.5 text-[14.5px] font-semibold text-ink">Team</h2>
        <ul className="divide-y divide-line">
          {(team ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{m.name}</span>
                <span className="block truncate text-xs text-muted">{m.email}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge>{ROLE[m.role] ?? m.role}</Badge>
                <span className="text-xs text-muted">
                  {m.lastLoginAt ? `Last in ${new Date(m.lastLoginAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Never signed in"}
                </span>
                {me?.role === "ADMIN" && m.id !== me.id ? (
                  <button onClick={() => setResetting(resetting === m.id ? null : m.id)} className="text-xs font-medium text-brand-blue hover:underline">
                    Reset password
                  </button>
                ) : null}
              </span>
              {resetting === m.id ? <ResetBox member={m} onDone={() => setResetting(null)} /> : null}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">Sign-in is email + password, then a 6-digit code. Codes show on screen until email delivery is connected.</p>
      </Card>

      <ChangePassword />

      <Card>
        <h2 className="border-b border-line px-5 py-3.5 text-[14.5px] font-semibold text-ink">Pickup warehouses</h2>
        <ul className="divide-y divide-line">
          {(warehouses ?? []).map((w) => (
            <li key={w.code} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
              <span>
                <span className="block font-medium text-ink">{w.name}</span>
                <span className="block text-xs text-muted">
                  {w.city} {w.pincode}
                  {w.cluster ? ` · ${w.cluster}` : ""}
                </span>
              </span>
              <span className="font-mono text-xs text-muted">{w.code}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="xl:col-span-2">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[14.5px] font-semibold text-ink">Couriers</h2>
          <span className="text-xs text-muted">All demo until live accounts are connected</span>
        </div>
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {(couriers ?? []).map((c) => (
            <div key={c.code} className="flex items-center justify-between bg-white px-5 py-3 text-[13px]">
              <span className="font-medium text-ink">{c.name}</span>
              {c.mode === "DEMO" ? <DemoBadge /> : <Badge tone="green">Live</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const STRONG = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card className="p-5">
      <h2 className="text-[14.5px] font-semibold text-ink">Change my password</h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await changePassword(current, next);
            setMsg({ ok: true, text: "Password changed. Use it next time you sign in." });
            setCurrent("");
            setNext("");
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Current password">
          <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="8+ characters, with a letter and a number">
          <input type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <span className={`text-[13px] font-medium ${msg?.ok ? "text-[#0e6e05]" : "text-flag-red"}`}>{msg?.text}</span>
          <Button type="submit" disabled={busy || !current || !STRONG(next)}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ResetBox({ member, onDone }: { member: TeamMember; onDone: () => void }) {
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await resetPassword(member.id, next);
          onDone();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <input
        type="password"
        autoComplete="new-password"
        placeholder={`New password for ${member.name}`}
        className={`${inputClass} h-9 max-w-xs`}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoFocus
      />
      <Button size="sm" type="submit" disabled={busy || !STRONG(next)}>
        Set password
      </Button>
      <span className="text-xs text-muted">Share it with them in person; they can change it after signing in.</span>
      {error ? <span className="text-xs font-medium text-flag-red">{error}</span> : null}
    </form>
  );
}
