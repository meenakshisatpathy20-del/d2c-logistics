import { istAt, istHour } from '../common/ist.js';

const HOUR = 3600_000;

/**
 * Reads the time in a reply like "by 4 pm", "4:30pm", "16:00", "tomorrow 11 am",
 * "in 2 hours", "in 30 min" or "EOD" and returns that moment (India time).
 * Returns null when the message names no time. A time already past today
 * means tomorrow, as people say it.
 */
export function parseWhen(text: string, now: Date): Date | null {
  const t = text.toLowerCase();

  const rel = /\bin\s+(\d{1,2})\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    return new Date(now.getTime() + (rel[2].startsWith('m') ? n * 60_000 : n * HOUR));
  }

  const tomorrow = /\b(tomorrow|tmrw|tmr|kal)\b/.test(t);
  if (/\b(eod|end of (the )?day)\b/.test(t)) return istAt(now, 19, tomorrow ? 1 : 0);

  // 4 pm, 4:30 pm, 4.30pm, 11am
  const ampm = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/.exec(t);
  // 16:00 (24-hour, needs the colon so a bare "14" in an AWB list is not a time)
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  let hour: number | null = null;
  let minute = 0;
  if (ampm) {
    hour = Number(ampm[1]) % 12 + (ampm[3] === 'pm' ? 12 : 0);
    minute = ampm[2] ? Number(ampm[2]) : 0;
  } else if (h24) {
    hour = Number(h24[1]);
    minute = Number(h24[2]);
  } else if (tomorrow) {
    hour = 12; // "tomorrow" with no time: midday
  }
  if (hour === null || hour > 23 || minute > 59) return null;

  let at = new Date(istAt(now, hour, tomorrow ? 1 : 0).getTime() + minute * 60_000);
  if (!tomorrow && at.getTime() <= now.getTime()) at = new Date(at.getTime() + 24 * HOUR);
  return at;
}

/** "4:30 pm" style label in India time. */
export function timeLabel(at: Date, now: Date): string {
  const sameDay = at.toDateString() === now.toDateString() || Math.abs(at.getTime() - now.getTime()) < 12 * HOUR && istHour(at) > istHour(now);
  const s = at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
  return sameDay ? s : `${at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, ${s}`;
}
