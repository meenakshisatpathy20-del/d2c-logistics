/**
 * Pickup slots offered when booking. A courier must confirm 2 hours before a
 * slot starts, so any slot starting less than 2 hours from now moves to tomorrow.
 * Times are India time, wherever the browser is.
 */
export const SLOTS = [
  { start: 10, label: "10–12 am" },
  { start: 12, label: "12–2 pm" },
  { start: 14, label: "2–4 pm" },
  { start: 16, label: "4–6 pm" },
] as const;

export const CONFIRM_LEAD_HOURS = 2;

export type SlotOption = {
  key: string;
  day: "today" | "next";
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

export function slotOptions(now: Date): SlotOption[] {
  const hour = istHourNow(now);
  const today = isWorkingDay(istDay(now, 0))
    ? SLOTS.filter((s) => s.start - hour >= CONFIRM_LEAD_HOURS).map((s) => ({
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
  const later = SLOTS.map((s) => ({ key: `next-${s.start}`, day: "next" as const, dayLabel: nextLabel, start: s.start, label: s.label }));
  // Always four choices: what is left today, then the next working day.
  return [...today, ...later].slice(0, 4);
}
