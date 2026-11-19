/**
 * Pickup slots offered when booking. A courier must confirm 2 hours before a
 * slot starts, so any slot starting less than 2 hours from now moves to tomorrow.
 * Times are India time, wherever the browser is.
 */
export const SLOTS = [
  { start: 10, label: "10 am–12 pm" },
  { start: 12, label: "12–2 pm" },
  { start: 14, label: "2–4 pm" },
  { start: 16, label: "4–6 pm" },
] as const;

export const CONFIRM_LEAD_HOURS = 2;

export type SlotOption = {
  key: string;
  /** "auto": no fixed slot; the platform books the first slot inside the warehouse's hours. */
  day: "today" | "next" | "auto";
  dayLabel: string;
  start: number;
  label: string;
};

/** Couriers do not pick up on Sundays or these holidays (same list as the API). */
const HOLIDAYS = ["2026-01-26", "2026-03-04", "2026-08-15", "2026-10-02", "2026-11-08", "2027-01-26"];

/** Current hour in India (13:30 -> 13.5). */
export function istHourNow(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return Number(parts.hour) + Number(parts.minute) / 60;
}

/** The IST calendar day `offset` days from now, as a Date at noon UTC of that day. */
function istDay(now: Date, offset: number): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + offset, 12));
}

export function isWorkingDay(day: Date): boolean {
  return day.getUTCDay() !== 0 && !HOLIDAYS.includes(day.toISOString().slice(0, 10));
}

export type Hours = { opensAt: number; closesAt: number; saturdayClosesAt: number | null };

/** True when the 2-hour slot sits inside the warehouse's open hours that day (Saturday has its own). */
function fits(start: number, day: Date, h?: Hours): boolean {
  if (!h) return true;
  const close = day.getUTCDay() === 6 ? h.saturdayClosesAt : h.closesAt;
  return close !== null && start >= h.opensAt && start + 2 <= close;
}

export function slotOptions(now: Date, hours?: Hours): SlotOption[] {
  const hour = istHourNow(now);
  const todayDay = istDay(now, 0);
  const today = isWorkingDay(todayDay)
    ? SLOTS.filter((s) => s.start - hour >= CONFIRM_LEAD_HOURS && fits(s.start, todayDay, hours)).map((s) => ({
        key: `today-${s.start}`,
        day: "today" as const,
        dayLabel: "Today",
        start: s.start,
        label: s.label,
      }))
    : [];
  let offset = 1;
  while (!isWorkingDay(istDay(now, offset)) && offset < 15) offset++;
  const next = istDay(now, offset);
  const nextLabel =
    offset === 1 ? "Tomorrow" : next.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const later = SLOTS.filter((s) => fits(s.start, next, hours)).map((s) => ({ key: `next-${s.start}`, day: "next" as const, dayLabel: nextLabel, start: s.start, label: s.label }));
  const options: SlotOption[] = [...today, ...later].slice(0, 4);
  // The next working day may be a Saturday the warehouse is closed: let the platform find the slot.
  if (options.length < 2) options.push({ key: "auto", day: "auto", dayLabel: "First open", start: 0, label: "Next open slot" });
  return options;
}
