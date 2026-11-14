/**
 * Pickup slots offered when booking. A courier must confirm 2 hours before a
 * slot starts, so any slot starting less than 2 hours from now moves to tomorrow.
 */
export const SLOTS = [
  { start: 10, end: 12, label: "10–12 am" },
  { start: 12, end: 14, label: "12–2 pm" },
  { start: 14, end: 16, label: "2–4 pm" },
  { start: 16, end: 18, label: "4–6 pm" },
] as const;

export const CONFIRM_LEAD_HOURS = 2;

export type SlotOption = { key: string; day: "Today" | "Tomorrow"; label: string };

export function slotOptions(now: Date): SlotOption[] {
  const hour = now.getHours() + now.getMinutes() / 60;
  const today = SLOTS.filter((s) => s.start - hour >= CONFIRM_LEAD_HOURS).map((s) => ({
    key: `today-${s.start}`,
    day: "Today" as const,
    label: s.label,
  }));
  const tomorrow = SLOTS.map((s) => ({ key: `tomorrow-${s.start}`, day: "Tomorrow" as const, label: s.label }));
  // Always offer four choices: what is left today, then tomorrow.
  return [...today, ...tomorrow].slice(0, 4);
}
