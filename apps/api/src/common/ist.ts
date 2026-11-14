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

/** Slot start/end for a requested day and start hour. */
export function slotWindow(now: Date, day: 'today' | 'tomorrow', startHour: number) {
  const slotStart = istAt(now, startHour, day === 'today' ? 0 : 1);
  return { slotStart, slotEnd: new Date(slotStart.getTime() + SLOT_HOURS * HOUR) };
}

/** The earliest slot the courier can still confirm (2 hours ahead). */
export function nextBookableSlot(now: Date): { slotStart: Date; slotEnd: Date } {
  for (let day = 0; day < 3; day++) {
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
  const start = later !== undefined ? istAt(slotStart, later) : istAt(slotStart, SLOT_STARTS[0], 1);
  return { slotStart: start, slotEnd: new Date(start.getTime() + SLOT_HOURS * HOUR) };
}

export function slotLabel(slotStart: Date): string {
  const h = istHour(slotStart);
  const fmt = (x: number) => (x === 12 ? '12 pm' : x > 12 ? `${x - 12} pm` : `${x} am`);
  return `${fmt(h)}–${fmt(h + SLOT_HOURS)}`;
}
