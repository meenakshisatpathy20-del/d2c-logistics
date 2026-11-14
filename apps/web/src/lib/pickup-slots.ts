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
  day: "today" | "tomorrow";
  dayLabel: "Today" | "Tomorrow";
  start: number;
  label: string;
};

/** Current hour in India (13:30 -> 13.5). */
export function istHourNow(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return Number(parts.hour) + Number(parts.minute) / 60;
}

export function slotOptions(now: Date): SlotOption[] {
  const hour = istHourNow(now);
  const today = SLOTS.filter((s) => s.start - hour >= CONFIRM_LEAD_HOURS).map((s) => ({
    key: `today-${s.start}`,
    day: "today" as const,
    dayLabel: "Today" as const,
    start: s.start,
    label: s.label,
  }));
  const tomorrow = SLOTS.map((s) => ({
    key: `tomorrow-${s.start}`,
    day: "tomorrow" as const,
    dayLabel: "Tomorrow" as const,
    start: s.start,
    label: s.label,
  }));
  // Always four choices: what is left today, then tomorrow.
  return [...today, ...tomorrow].slice(0, 4);
}
