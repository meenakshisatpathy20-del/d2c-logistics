"use client";

import clsx from "clsx";
import { AlertTriangle, Loader2, Pencil, Plus, Power, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useShell } from "@/components/shell/app-shell";
import { Badge, Button, Card, DemoBadge, Field, inputClass } from "@/components/ui/primitives";
import {
  type CourierContactRow,
  getCourierContacts,
  saveCourierContact,
  addTeamMember,
  addWarehouse,
  changePassword,
  type CourierInfo,
  getCouriers,
  getTeam,
  getWarehousesFull,
  resetPassword,
  setCourierActive,
  type TeamMember,
  updateTeamMember,
  updateWarehouse,
  type WarehouseFull,
} from "@/lib/api";

const ROLE: Record<string, string> = { ADMIN: "Admin", OPS: "Operations", SUPPORT: "Support", FINANCE: "Finance", WAREHOUSE: "Warehouse", VENDOR: "Vendor", COURIER: "Courier" };
const STRONG = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Team, pickup warehouses (with vendor sign-in) and couriers: kept by our own admins and ops. */
export function SettingsView() {
  const { me } = useShell();
  const isAdmin = me?.role === "ADMIN";
  const canManage = isAdmin || me?.role === "OPS";
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseFull[] | null>(null);
  const [couriers, setCouriers] = useState<CourierInfo[] | null>(null);

  const load = useCallback(() => {
    getTeam().then(setTeam, () => {});
    getWarehousesFull().then(setWarehouses, () => {});
    getCouriers().then(setCouriers, () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const placeholders = (warehouses ?? []).filter((w) => w.placeholder).length;

  return (
    <div className="space-y-6">
      {placeholders ? (
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-brand-amber bg-brand-amber-soft px-4 py-3 text-[13px] text-[#b54708]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{placeholders} warehouse{placeholders === 1 ? "" : "s"} still have placeholder contacts.</span> Add each vendor&apos;s real
            contact name and mobile before go-live: that mobile is how the vendor signs in and gets the 9 am pickup list.
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <TeamCard team={team} isAdmin={isAdmin} meId={me?.id} onChanged={load} />
        <ChangePassword />
      </div>

      <WarehousesCard warehouses={warehouses} canManage={canManage} onChanged={load} />
      <CouriersCard couriers={couriers} canManage={canManage} onChanged={load} />
      <CourierContactsCard couriers={couriers ?? []} canManage={canManage} />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <span>
          <span className="block text-[14.5px] font-semibold text-ink">Message log</span>
          <span className="block text-xs text-muted">Every WhatsApp, SMS and email the platform sent, or keeps as Demo until the accounts are approved.</span>
        </span>
        <a href="/messages" className="text-[13px] font-medium text-brand-blue hover:underline">
          Open the log →
        </a>
      </Card>
    </div>
  );
}

// ---------- Team ----------

function TeamCard({ team, isAdmin, meId, onChanged }: { team: TeamMember[] | null; isAdmin: boolean; meId?: string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(m: TeamMember) {
    setError(null);
    try {
      await updateTeamMember(m.id, { active: !m.active });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardTop title="Team" action={isAdmin ? <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}><Plus size={14} /> Add member</Button> : null} />
      {adding ? <AddMember team={team ?? []} onDone={() => (setAdding(false), onChanged())} /> : null}
      {error ? <p className="mx-5 mt-3 rounded-lg bg-flag-red-soft px-3 py-2 text-[13px] font-medium text-flag-red">{error}</p> : null}
      <ul className="divide-y divide-line">
        {(team ?? []).map((m) => (
          <li key={m.id} className={clsx("flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]", !m.active && "opacity-55")}>
            <span className="min-w-0">
              <span className="block font-medium text-ink">
                {m.name} {!m.active ? <span className="text-xs font-normal text-muted">· deactivated</span> : null}
              </span>
              <span className="block truncate text-xs text-muted">
                {m.email} · {m.phone}
                {m.managerId ? ` · reports to ${team?.find((x) => x.id === m.managerId)?.name ?? "—"}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge>{ROLE[m.role] ?? m.role}</Badge>
              <span className="text-xs text-muted">{m.lastLoginAt ? `Last in ${fmtDay(m.lastLoginAt)}` : "Never signed in"}</span>
              {isAdmin && m.id !== meId ? (
                <>
                  {m.active ? (
                    <button onClick={() => setResetting(resetting === m.id ? null : m.id)} className="text-xs font-medium text-brand-blue hover:underline">
                      Reset password
                    </button>
                  ) : null}
                  <button onClick={() => toggle(m)} className="text-xs font-medium text-muted hover:text-ink hover:underline">
                    {m.active ? "Deactivate" : "Reactivate"}
                  </button>
                </>
              ) : null}
            </span>
            {resetting === m.id ? <ResetBox member={m} onDone={() => setResetting(null)} /> : null}
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">
        Sign-in is email + password, then a 6-digit code. A password reset or deactivation signs that person out everywhere at once.
      </p>
    </Card>
  );
}

function AddMember({ team, onDone }: { team: TeamMember[]; onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", role: "OPS", managerId: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const ok = f.name.trim().length > 1 && /\S+@\S+\.\S+/.test(f.email) && /^[6-9]\d{9}$/.test(f.phone) && STRONG(f.password);
  return (
    <form
      className="grid gap-3 border-b border-line bg-page/50 px-5 py-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await addTeamMember({ ...f, managerId: f.managerId || undefined });
          onDone();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Field label="Name">
        <input className={inputClass} value={f.name} onChange={set("name")} autoFocus />
      </Field>
      <Field label="Work email">
        <input className={inputClass} type="email" value={f.email} onChange={set("email")} />
      </Field>
      <Field label="Mobile">
        <input className={inputClass} inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} />
      </Field>
      <Field label="Role">
        <select className={inputClass} value={f.role} onChange={set("role")}>
          {["OPS", "WAREHOUSE", "SUPPORT", "FINANCE", "ADMIN"].map((r) => (
            <option key={r} value={r}>
              {ROLE[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reports to" hint="Their overdue problems escalate to this person first">
        <select className={inputClass} value={f.managerId} onChange={set("managerId")}>
          <option value="">Nobody</option>
          {team.filter((m) => m.active).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="First password" hint="8+ characters with a letter and a number; share it in person">
        <input className={inputClass} type="password" autoComplete="new-password" value={f.password} onChange={set("password")} />
      </Field>
      {error ? <p className="text-[13px] font-medium text-flag-red sm:col-span-2">{error}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !ok}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null} Add member
        </Button>
      </div>
    </form>
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
      <span className="text-xs text-muted">Share it in person; they can change it after signing in.</span>
      {error ? <span className="text-xs font-medium text-flag-red">{error}</span> : null}
    </form>
  );
}

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
            setMsg({ ok: true, text: "Password changed. Other devices are signed out." });
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

// ---------- Warehouses and vendor contacts ----------

const EMPTY_WH = { code: "", name: "", address: "", city: "", state: "", pincode: "", cluster: "", contactName: "", contactPhone: "" };

function WarehousesCard({ warehouses, canManage, onChanged }: { warehouses: WarehouseFull[] | null; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card>
      <CardTop
        title="Pickup warehouses and vendor contacts"
        sub="The contact mobile is the vendor's sign-in for the vendor phone view and gets the 9 am pickup list."
        action={canManage ? <Button size="sm" variant="secondary" onClick={() => setEditing(editing === "new" ? null : "new")}><Plus size={14} /> Add warehouse</Button> : null}
      />
      {editing === "new" ? <WarehouseForm onDone={() => (setEditing(null), onChanged())} /> : null}
      <ul className="divide-y divide-line">
        {(warehouses ?? []).map((w) => (
          <li key={w.code} className="px-5 py-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-medium text-ink">
                  {w.name} <span className="font-mono text-xs font-normal text-muted">{w.code}</span>
                </span>
                <span className="block text-xs text-muted">
                  {w.address}, {w.city} {w.pincode}
                  {w.cluster ? ` · ${w.cluster}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                {w.placeholder ? (
                  <Badge tone="amber">Placeholder contact</Badge>
                ) : (
                  <span className="text-xs text-ink-2">
                    {w.contactName} · {w.contactPhone}
                  </span>
                )}
                {w.vendorLogin ? (
                  <span className="text-xs text-muted">{w.vendorLogin.lastLoginAt ? `Vendor last in ${fmtDay(w.vendorLogin.lastLoginAt)}` : "Vendor never signed in"}</span>
                ) : null}
                {canManage ? (
                  <button onClick={() => setEditing(editing === w.code ? null : w.code)} className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline">
                    <Pencil size={12} /> Edit
                  </button>
                ) : null}
              </span>
            </div>
            {editing === w.code ? <WarehouseForm existing={w} onDone={() => (setEditing(null), onChanged())} /> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WarehouseForm({ existing, onDone }: { existing?: WarehouseFull; onDone: () => void }) {
  const [f, setF] = useState(
    existing
      ? { ...EMPTY_WH, ...existing, cluster: existing.cluster ?? "", contactName: existing.placeholder ? "" : existing.contactName }
      : EMPTY_WH,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const ok = f.name && f.address && f.city && f.state && /^[1-9]\d{5}$/.test(f.pincode) && f.contactName.trim().length > 1 && /^[6-9]\d{9}$/.test(f.contactPhone) && (existing || /^[A-Za-z0-9]{3,12}$/.test(f.code));
  return (
    <form
      className="mt-3 grid gap-3 rounded-xl border border-line bg-page/50 p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const body = { name: f.name, address: f.address, city: f.city, state: f.state, pincode: f.pincode, cluster: f.cluster || undefined, contactName: f.contactName, contactPhone: f.contactPhone };
          if (existing) await updateWarehouse(existing.code, body);
          else await addWarehouse({ ...body, code: f.code.toUpperCase() });
          onDone();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      {!existing ? (
        <Field label="Code" hint="Same as the Velocity warehouse ID">
          <input className={inputClass} value={f.code} onChange={set("code")} maxLength={12} />
        </Field>
      ) : null}
      <Field label="Vendor / warehouse name">
        <input className={inputClass} value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Area cluster" hint="e.g. Mumbai West - Malad">
        <input className={inputClass} value={f.cluster} onChange={set("cluster")} />
      </Field>
      <div className="sm:col-span-3">
        <Field label="Address">
          <input className={inputClass} value={f.address} onChange={set("address")} />
        </Field>
      </div>
      <Field label="City">
        <input className={inputClass} value={f.city} onChange={set("city")} />
      </Field>
      <Field label="State">
        <input className={inputClass} value={f.state} onChange={set("state")} />
      </Field>
      <Field label="Pin code">
        <input className={inputClass} inputMode="numeric" maxLength={6} value={f.pincode} onChange={set("pincode")} />
      </Field>
      <Field label="Contact person">
        <input className={inputClass} value={f.contactName} onChange={set("contactName")} placeholder="Real name" />
      </Field>
      <Field label="Contact mobile" hint="Becomes the vendor's sign-in">
        <input className={inputClass} inputMode="numeric" maxLength={10} value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value.replace(/\D/g, "") })} />
      </Field>
      <div className="flex items-end justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          <X size={14} />
        </Button>
        <Button type="submit" disabled={busy || !ok}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null} Save
        </Button>
      </div>
      {error ? <p className="text-[13px] font-medium text-flag-red sm:col-span-3">{error}</p> : null}
    </form>
  );
}

// ---------- Couriers ----------

function CouriersCard({ couriers, canManage, onChanged }: { couriers: CourierInfo[] | null; canManage: boolean; onChanged: () => void }) {
  const [turningOff, setTurningOff] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function set(code: string, active: boolean) {
    setError(null);
    try {
      await setCourierActive(code, active, active ? undefined : reason.trim());
      setTurningOff(null);
      setReason("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardTop
        title="Couriers"
        sub="Switch a courier off when its account is on hold or it keeps failing: new bookings and pickup moves go to the others at once."
      />
      {error ? <p className="mx-5 mt-3 text-[13px] font-medium text-flag-red">{error}</p> : null}
      <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        {(couriers ?? []).map((c) => (
          <div key={c.code} className={clsx("bg-white px-5 py-3 text-[13px]", !c.active && "bg-flag-red-soft/40")}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{c.name}</span>
              {!c.active ? <Badge tone="red">Switched off</Badge> : c.mode === "DEMO" ? <DemoBadge /> : <Badge tone="green">Live</Badge>}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted">
              <span>Pickups on time {c.pickupOnTimePct}%</span>
              {canManage ? (
                c.active ? (
                  <button onClick={() => setTurningOff(turningOff === c.code ? null : c.code)} className="flex items-center gap-1 font-medium text-flag-red hover:underline">
                    <Power size={12} /> Switch off
                  </button>
                ) : (
                  <button onClick={() => set(c.code, true)} className="flex items-center gap-1 font-medium text-[#0e6e05] hover:underline">
                    <Power size={12} /> Switch on
                  </button>
                )
              ) : null}
            </div>
            {turningOff === c.code ? (
              <form
                className="mt-2 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void set(c.code, false);
                }}
              >
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why? e.g. account on hold"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-[12.5px] focus:border-brand-blue focus:outline-none"
                  autoFocus
                />
                <button disabled={reason.trim().length < 3} className="h-8 rounded-lg bg-flag-red px-2.5 text-[12px] font-semibold text-white disabled:opacity-50">
                  Off
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CardTop({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div>
        <h2 className="text-[14.5px] font-semibold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------- Courier contacts ----------

const CONTACT_ROLE: Record<string, string> = { ACCOUNT_MANAGER: "Account manager", PICKUP_LEAD: "Pickup lead", HUB: "Hub", REGIONAL_MANAGER: "Regional manager" };

/** Named people at each courier: every issue goes to a person, and ignored reminders go to their manager. */
function CourierContactsCard({ couriers, canManage }: { couriers: CourierInfo[]; canManage: boolean }) {
  const [rows, setRows] = useState<CourierContactRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ courierCode: "", name: "", role: "ACCOUNT_MANAGER", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getCourierContacts().then(setRows, () => {}), []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  const name = (code: string) => couriers.find((c) => c.code === code)?.name ?? code;
  const grouped = Object.entries((rows ?? []).reduce<Record<string, CourierContactRow[]>>((acc, r) => ((acc[r.courierCode] ??= []).push(r), acc), {}));
  return (
    <Card>
      <CardTop
        title="Courier contacts"
        sub="Each issue goes to a named person: the pickup lead for pickups, the account manager for everything else. Two ignored reminders and it goes to their regional manager."
        action={canManage ? <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}><Plus size={14} /> Add contact</Button> : null}
      />
      {adding ? (
        <form
          className="grid gap-3 border-b border-line bg-page/50 px-5 py-4 sm:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await saveCourierContact({ ...f, active: true });
              setAdding(false);
              setF({ courierCode: "", name: "", role: "ACCOUNT_MANAGER", phone: "" });
              void load();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <select className={inputClass} value={f.courierCode} onChange={(e) => setF({ ...f, courierCode: e.target.value })} aria-label="Courier">
            <option value="">Courier</option>
            {couriers.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <input className={inputClass} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select className={inputClass} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">
            {Object.entries(CONTACT_ROLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input className={inputClass} placeholder="Mobile" inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} />
          <Button type="submit" disabled={!f.courierCode || f.name.trim().length < 2 || !/^[6-9]\d{9}$/.test(f.phone)}>
            Save
          </Button>
          {error ? <p className="text-[13px] font-medium text-flag-red sm:col-span-5">{error}</p> : null}
        </form>
      ) : null}
      <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
        {grouped.map(([code, list]) => (
          <div key={code} className="bg-white px-5 py-3 text-[13px]">
            <p className="font-semibold text-ink">{name(code)}</p>
            <ul className="mt-1 space-y-1">
              {list.map((c) => (
                <li key={c.id} className={clsx("flex justify-between gap-2", !c.active && "opacity-50")}>
                  <span className="truncate text-ink-2">
                    {c.name} <span className="text-xs text-muted">· {CONTACT_ROLE[c.role]}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{c.phone}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
