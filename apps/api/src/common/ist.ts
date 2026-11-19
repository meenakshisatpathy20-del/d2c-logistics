/**
 * India Standard Time helpers. Pickup slots are agreed in IST, whatever time
 * zone the server runs in, so all slot maths goes through these functions.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** IST calendar date (y, m, d) for an instant. */
export function istDate(at: Date): { y: number; m: number; d: number } {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

/** Hour of the day in IST, with minutes as a fraction (13:30 -> 13.5). */
export function istHour(at: Date): number {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return shifted.getUTCHours() + shifted.getUTCMinutes() / 60;
}

/** The instant at `hour`:00 IST on the IST day of `at`, plus `dayOffset` days. */
export function istAt(at: Date, hour: number, dayOffset = 0): Date {
  const { y, m, d } = istDate(at);
  return new Date(Date.UTC(y, m, d + dayOffset, hour) - IST_OFFSET_MS);
}

/** Start of the IST day containing `at`. */
export function istDayStart(at: Date): Date {
  return istAt(at, 0);
}

export const SLOT_STARTS = [10, 12, 14, 16] as const;
export const SLOT_HOURS = 2;
/** A courier must confirm a pickup this many hours before the slot starts. */
export const CONFIRM_LEAD_HOURS = 2;

/**
 * Couriers do not pick up on Sundays or national holidays. The list can be
 * replaced with PICKUP_HOLIDAYS=YYYY-MM-DD,YYYY-MM-DD (review it every year).
 */
export const DEFAULT_PICKUP_HOLIDAYS = ['2026-01-26', '2026-03-04', '2026-08-15', '2026-10-02', '2026-11-08', '2027-01-26'];

function holidays(): string[] {
  const env = process.env.PICKUP_HOLIDAYS;
  return env ? env.split(',').map((d) => d.trim()) : DEFAULT_PICKUP_HOLIDAYS;
}

/** YYYY-MM-DD of the IST day containing `at`. */
export function istDateKey(at: Date): string {
  const { y, m, d } = istDate(at);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Why couriers will not pick up on this IST day, or null on a working day. */
export function closedReason(at: Date): string | null {
  if (new Date(at.getTime() + IST_OFFSET_MS).getUTCDay() === 0) return 'Sunday';
  return holidays().includes(istDateKey(at)) ? 'Holiday' : null;
}

/** Days from today (IST) to the next working day after today. */
export function nextWorkingDayOffset(now: Date): number {
  for (let day = 1; day < 15; day++) if (!closedReason(istAt(now, 12, day))) return day;
  return 1;
}

/**
 * Slot start/end for a requested day and start hour.
 * 'next' is the next working day; 'tomorrow' is kept for older clients.
 */
export function slotWindow(now: Date, day: 'today' | 'tomorrow' | 'next', startHour: number) {
  const offset = day === 'today' ? 0 : day === 'tomorrow' ? 1 : nextWorkingDayOffset(now);
  const slotStart = istAt(now, startHour, offset);
  return { slotStart, slotEnd: new Date(slotStart.getTime() + SLOT_HOURS * HOUR) };
}

/** The earliest slot the courier can still confirm (2 hours ahead), on a working day. */
export function nextBookableSlot(now: Date): { slotStart: Date; slotEnd: Date } {
  for (let day = 0; day < 15; day++) {
    if (closedReason(istAt(now, 12, day))) continue;
    for (const h of SLOT_STARTS) {
      const slotStart = istAt(now, h, day);
      if (slotStart.getTime() - now.getTime() >= CONFIRM_LEAD_HOURS * HOUR) {
        return { slotStart, slotEnd: new Date(slotStart.getTime() + SLOT_HOURS * HOUR) };
      }
    }
  }
  throw new Error('No pickup slot available');
}

/** The next slot after a missed one (same day if possible, else the next morning). */
export function slotAfter(slotStart: Date): { slotStart: Date; slotEnd: Date } {
  const h = istHour(slotStart);
  const later = SLOT_STARTS.find((s) => s > h);
  let start = later !== undefined ? istAt(slotStart, later) : istAt(slotStart, SLOT_STARTS[0], 1);
  while (closedReason(start)) start = istAt(start, SLOT_STARTS[0], 1);
  return { slotStart: start, slotEnd: new Date(start.getTime() + SLOT_HOURS * HOUR) };
}

export function slotLabel(slotStart: Date): string {
  const h = istHour(slotStart);
  const fmt = (x: number) => (x === 12 ? '12 pm' : x > 12 ? `${x - 12} pm` : `${x} am`);
  return `${fmt(h)}–${fmt(h + SLOT_HOURS)}`;
}

/** A warehouse's declared working hours (IST, whole hours). Saturday null = closed on Saturday. */
export type WorkingHours = { opensAt: number; closesAt: number; saturdayClosesAt: number | null };

export function isSaturday(at: Date): boolean {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCDay() === 6;
}

/** The hour the warehouse closes on this IST day, or null if it is closed all day. */
export function closesOn(at: Date, h: WorkingHours): number | null {
  if (closedReason(at)) return null;
  return isSaturday(at) ? h.saturdayClosesAt : h.closesAt;
}

/** True when the whole pickup slot falls inside the warehouse's open hours that day. */
export function slotFits(slotStart: Date, h: WorkingHours | null | undefined): boolean {
  if (!h) return true;
  const close = closesOn(slotStart, h);
  if (close === null) return false;
  const start = istHour(slotStart);
  return start >= h.opensAt && start + SLOT_HOURS <= close;
}

/** True when the warehouse was open at this moment (for checking a "warehouse closed" claim). */
export function wasOpenAt(at: Date, h: WorkingHours): boolean {
  const close = closesOn(at, h);
  if (close === null) return false;
  const hour = istHour(at);
  return hour >= h.opensAt && hour < close;
}

export function hourLabel(x: number): string {
  return x === 12 ? '12 pm' : x === 0 || x === 24 ? '12 am' : x > 12 ? `${x - 12} pm` : `${x} am`;
}

/** "10 am–7 pm, Sat till 4 pm" */
export function hoursLabel(h: WorkingHours): string {
  const sat = h.saturdayClosesAt === null ? 'closed Saturday' : h.saturdayClosesAt === h.closesAt ? 'Saturday too' : `Sat till ${hourLabel(h.saturdayClosesAt)}`;
  return `${hourLabel(h.opensAt)}–${hourLabel(h.closesAt)}, ${sat}`;
}
