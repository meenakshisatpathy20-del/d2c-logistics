import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Intent } from './agent.service.js';
import { parseWhen } from './when.js';

/**
 * The AI model reads a message the plain rules could not, and only names the intent
 * and its details. The code then does the work with the same checks as a
 * button, so a wrong guess can at worst give a wrong answer, never move a parcel
 * on its own (switching a courier still waits for a person's OK).
 * Off unless ANTHROPIC_API_KEY and AGENT_MODEL are set.
 */
const IntentSchema = z.object({
  kind: z.enum(['help', 'pending', 'ageing', 'chase', 'status', 'book', 'switch', 'credit', 'lists', 'unknown']),
  courier: z.string().nullable().describe('Courier name if one is mentioned, e.g. Delhivery, Ekart, Shadowfax, Blue Dart, Xpressbees'),
  vendor: z.string().nullable().describe('Vendor / warehouse name if one is mentioned'),
  refs: z.array(z.string()).describe('Order numbers or AWB numbers mentioned'),
  allNew: z.boolean().describe('For book: true when they mean every new order'),
  amount: z.number().nullable().describe('For credit: rupee amount'),
  by: z.string().nullable().describe('For credit: the deadline as the user wrote it, e.g. "friday 5 pm"'),
});

const SYSTEM = `You route messages from an Indian D2C brand's shipping team to their ops agent.
Intents: pending (what is open today), ageing (old/stuck shipments), chase (nudge couriers/vendors),
status (where is an order/AWB), book (book orders), switch (move a pickup to another courier),
credit (a courier owes money: credit note, refund, adjustment), lists (send the 9 am / 6 pm pending lists),
help, unknown. Messages may mix Hindi and English.`;

let client: Anthropic | null = null;

export async function llmIntent(text: string, now: Date): Promise<Intent | null> {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.AGENT_MODEL) return null;
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: text }],
    output_config: { format: zodOutputFormat(IntentSchema) },
  });
  const o = res.parsed_output;
  if (!o) return null;
  const refs = o.refs.map((r) => r.replace(/^#/, '').toUpperCase());
  switch (o.kind) {
    case 'pending':
      return { kind: 'pending', vendor: o.vendor ?? undefined };
    case 'chase':
      return { kind: 'chase', courier: o.courier?.toLowerCase() ?? undefined, refs };
    case 'status':
      return refs.length ? { kind: 'status', refs } : { kind: 'unknown' };
    case 'book':
      return { kind: 'book', refs, allNew: o.allNew && !refs.length };
    case 'switch':
      return { kind: 'switch', courier: o.courier?.toLowerCase() ?? undefined, vendor: o.vendor ?? undefined };
    case 'credit':
      return o.amount ? { kind: 'credit', amount: o.amount, courier: o.courier?.toLowerCase() ?? undefined, note: text, by: o.by ? parseWhen(o.by, now) : null } : { kind: 'unknown' };
    default:
      return { kind: o.kind };
  }
}

const TriageSchema = z.object({
  kind: z.enum(['ASK', 'PROMISE', 'DONE', 'CLAIM', 'MONEY', 'BLOCKED', 'REPLY', 'INFO']),
  type: z
    .enum(['PICKUP_PENDING', 'PICKUP_CLAIM', 'RTO_STATUS', 'DELAYED', 'LOST', 'DAMAGED', 'NOT_RECEIVED', 'FAKE_ATTEMPT', 'ADDRESS_CHANGE', 'WEIGHT_CHARGE', 'CREDIT_NOTE_PENDING', 'COD_REMITTANCE_LATE', 'BOOKING_BLOCKED', 'OTHER'])
    .nullable(),
  when: z.string().nullable().describe('The time promised, as written (e.g. "tomorrow 11 am", "by 4 pm"), or null'),
});

const TRIAGE_SYSTEM = `You read one message from a WhatsApp group between an Indian D2C brand and a courier or aggregator (Hindi, English or both).
Say what the message does: ASK (asks for an update or action), PROMISE (commits to do something, with or without a time),
DONE (says it is done: picked up, delivered, marked RTO), CLAIM (an excuse: warehouse closed, not ready, nobody there),
MONEY (money owed, credit, refund, COD remittance), BLOCKED (bookings or business on hold), REPLY (any other answer), INFO (chit-chat, greetings).
Pick the shipment problem it is about, or null.`;

/** The AI model reads a courier-chat message the plain rules could not place. Off unless ANTHROPIC_API_KEY and AGENT_MODEL are set. */
export async function llmTriage(text: string, now: Date): Promise<{ kind: 'ASK' | 'PROMISE' | 'DONE' | 'CLAIM' | 'MONEY' | 'BLOCKED' | 'REPLY' | 'INFO'; type: string | null; promiseAt: Date | null } | null> {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.AGENT_MODEL) return null;
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL,
    max_tokens: 512,
    system: TRIAGE_SYSTEM,
    messages: [{ role: 'user', content: text.slice(0, 2000) }],
    output_config: { format: zodOutputFormat(TriageSchema) },
  });
  const o = res.parsed_output;
  if (!o) return null;
  return { kind: o.kind, type: o.type === 'OTHER' ? null : o.type, promiseAt: o.when ? parseWhen(o.when, now) : null };
}
