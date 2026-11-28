import { refsIn, amountIn } from './agent.service.js';
import { parseWhen } from './when.js';

/**
 * The triage agent's reading rules, free of the database so each can be tested.
 * It reads courier chat the way our team writes it: AWB lists with one line of
 * text, "kindly update on status of pickup", "aligned for tomorrow", "is it not
 * yet marked rto, getting it update soon", "warehouse closed".
 */

export type ChatLine = { sender: string; sentAt: Date; body: string };
export type Party = 'OURS' | 'COURIER' | 'VENDOR' | 'UNKNOWN';
export type Kind = 'ASK' | 'PROMISE' | 'DONE' | 'CLAIM' | 'MONEY' | 'BLOCKED' | 'REPLY' | 'INFO';
export type Reading = { kind: Kind; type: string | null; promiseAt: Date | null; amount: number | null; refs: string[] };

const SYSTEM_LINE = /(messages and calls are end-to-end encrypted|<media omitted>|this message was deleted|created group|added you|changed the subject|changed this group|joined using this group|left$|removed .+$|security code changed|pinned a message)/i;

/** "28/11/26" or "28/11/2026" (India: day first). */
function day(d: string, m: string, y: string): [number, number, number] {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  return [year, Number(m) - 1, Number(d)];
}

/** Hour and minute from "5:46", "5:46 pm", "17:46", "5:46 PM" (with the odd spaces WhatsApp puts in). */
function clock(h: string, min: string, ampm?: string): [number, number] {
  let hour = Number(h);
  const a = ampm?.toLowerCase().replace(/[.\s]/g, '');
  if (a === 'pm' && hour < 12) hour += 12;
  if (a === 'am' && hour === 12) hour = 0;
  return [hour, Number(min)];
}

/** A wall-clock time in India as a moment. */
function ist(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo, d, h, mi) - 330 * 60_000);
}

const AMPM = '([ap]\\.?\\s?m\\.?)';
// Android export: "28/11/26, 5:46 pm - ~ Isha ~: text"   iOS: "[28/11/26, 5:46:12 PM] Isha: text"
const EXPORT = new RegExp(`^\\[?(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4}),?\\s+(\\d{1,2}):(\\d{2})(?::\\d{2})?\\s*${AMPM}?\\]?\\s*(?:-\\s*)?([^:]{1,80}?):\\s?(.*)$`, 'i');
// Copied from WhatsApp Web: "[5:46 pm, 28/11/2026] ~ Isha ~: text"
const WEB = new RegExp(`^\\[(\\d{1,2}):(\\d{2})\\s*${AMPM}?,\\s*(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})\\]\\s*([^:]{1,80}?):\\s?(.*)$`, 'i');

/** "~ Isha ~", "Sakshi Shaw D2c", "+91 90710 42287" → a clean display name. */
export const cleanName = (s: string) => s.replace(/[~‪‬‎‏]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Splits a WhatsApp chat export, or text copied from WhatsApp Web, into
 * messages. A line that does not start a message belongs to the one above.
 * Text with no WhatsApp headers at all is one message from the person pasting.
 */
export function parseChat(text: string, now: Date, pastedBy: string): ChatLine[] {
  const out: ChatLine[] = [];
  for (const raw of text.replace(/\r/g, '').replace(/ | /g, ' ').split('\n')) {
    const line = raw.trimEnd();
    let m = EXPORT.exec(line);
    if (m) {
      const [y, mo, d] = day(m[1], m[2], m[3]);
      const [h, mi] = clock(m[4], m[5], m[6]);
      out.push({ sender: cleanName(m[7]), sentAt: ist(y, mo, d, h, mi), body: m[8] });
      continue;
    }
    m = WEB.exec(line);
    if (m) {
      const [h, mi] = clock(m[1], m[2], m[3]);
      const [y, mo, d] = day(m[4], m[5], m[6]);
      out.push({ sender: cleanName(m[7]), sentAt: ist(y, mo, d, h, mi), body: m[8] });
      continue;
    }
    if (out.length) out[out.length - 1].body += `\n${line}`;
  }
  if (!out.length) return text.trim() ? [{ sender: pastedBy, sentAt: now, body: text.trim() }] : [];
  return out.map((l) => ({ ...l, body: l.body.trim() })).filter((l) => l.body && !SYSTEM_LINE.test(l.body));
}

/**
 * AWBs and order numbers in a message. A phone number or pin code is not one:
 * a bare 10-digit number starting 6-9 is a mobile, and 6 digits is a pin code.
 */
export function chatRefs(body: string): string[] {
  const text = body.replace(/\+91[\s-]?\d{5}[\s-]?\d{5}/g, ' ');
  return refsIn(text).filter((r) => !/^[6-9]\d{9}$/.test(r) && !/^\d{6}$/.test(r) && !/^[A-Z]+$/.test(r));
}

/** Long enough to be an AWB we should know about (shorter numbers are order numbers, codes, amounts). */
export const looksLikeAwb = (r: string) => r.length >= 8;

/**
 * What a message says, by plain rules. Order matters: "picked up" beats "pickup",
 * a money amount with credit words beats everything, and a time anywhere makes
 * it a promise ("aligned for tomorrow", "by 4 pm", "kal tak").
 */
export function read(body: string, now: Date): Reading {
  const t = body.toLowerCase().replace(/\s+/g, ' ');
  const refs = chatRefs(body);
  const amount = amountIn(body);
  const promiseAt = parseWhen(t, now);

  if (amount !== null && /\b(credit|refund|adjust|owe|payment|deduct|invoice|remit|cod amount|settle)/.test(t)) {
    return { kind: 'MONEY', type: /remit|cod/.test(t) ? 'COD_REMITTANCE_LATE' : 'CREDIT_NOTE_PENDING', promiseAt, amount, refs };
  }
  if (/\b(on hold|business .*hold|blocked|not booking|stop(ped)? booking|no new (pickups|bookings))\b/.test(t)) {
    return { kind: 'BLOCKED', type: 'BOOKING_BLOCKED', promiseAt: null, amount, refs };
  }
  if (/\b(warehouse|shop|store|seller|vendor) (was |is )?(closed|shut)|\bclosed\b.*\b(warehouse|shop)|not ready|pickup attempted|attempted pickup|no one (was )?(there|available)|seller not available/.test(t)) {
    return { kind: 'CLAIM', type: 'PICKUP_CLAIM', promiseAt, amount, refs };
  }
  const type = typeFor(t);
  if (/^(done|ok done)\b|\b(picked up|pickup done|pickup (is )?completed|has been picked|delivered successfully|ho gaya|hogaya|has been delivered|marked rto|rto (is )?initiated)\b/.test(t) && !/\?|\bnot\b|\bnahi\b/.test(t)) {
    return { kind: 'DONE', type, promiseAt: null, amount, refs };
  }
  if (promiseAt || /\b(aligned|will be (picked|delivered|done|updated|marked)|will (do|update|check|pick)|by eod|getting it (done|update)|update (you )?soon|shall|kar denge|ho jayega)\b/.test(t)) {
    return { kind: 'PROMISE', type, promiseAt, amount, refs };
  }
  if (/\?|\b(kindly|please|pls|plz|update|status|what is|when will|why|share|confirm|revert|escalate|reminder|follow ?up|still not|not yet|pending)\b/.test(t)) {
    return { kind: 'ASK', type, promiseAt: null, amount, refs };
  }
  return { kind: refs.length ? 'ASK' : 'INFO', type: refs.length ? type : null, promiseAt: null, amount, refs };
}

/** The problem a message is about, from its words. null = decide from the parcel's own status. */
export function typeFor(t: string): string | null {
  if (/\b(rto|return to origin|returned to (seller|origin)|rto warehouse)\b/.test(t)) return 'RTO_STATUS';
  if (/\breverse pick ?up\b/.test(t)) return 'REVERSE_PICKUP_PENDING';
  if (/\bweight\b/.test(t)) return 'WEIGHT_CHARGE';
  if (/\b(damaged|tampered|broken|missing item|items? missing|empty box)\b/.test(t)) return 'DAMAGED';
  if (/\b(lost|untraceable|not traceable|misplaced)\b/.test(t)) return 'LOST';
  if (/\b(fake attempt|nobody came|no one came|did not come|didn'?t come)\b/.test(t)) return 'FAKE_ATTEMPT';
  if (/\b(not received|didn'?t receive|did not receive|fake delivery|wrongly delivered)\b/.test(t)) return 'NOT_RECEIVED';
  if (/\b(address|reschedul|new date)\b/.test(t)) return 'ADDRESS_CHANGE';
  if (/\b(misrouted|wrong hub|wrong city)\b/.test(t)) return 'MISROUTED';
  if (/\b(pick ?up|picked|rsm|manifest|not picked|unpicked)\b/.test(t)) return 'PICKUP_PENDING';
  if (/\b(delay|delayed|late|stuck|not moving|edd|no movement|no update)\b/.test(t)) return 'DELAYED';
  return null;
}

/** For a parcel with no clue in the words: what is most likely wrong, from where it is. */
export function typeForStatus(status: string): string {
  if (['BOOKED', 'PICKUP_SCHEDULED'].includes(status)) return 'PICKUP_PENDING';
  if (['RTO_INITIATED', 'RTO_DELIVERED'].includes(status)) return 'RTO_STATUS';
  if (status === 'NDR') return 'ADDRESS_CHANGE';
  if (status === 'DELIVERED') return 'NOT_RECEIVED';
  return 'DELAYED';
}
