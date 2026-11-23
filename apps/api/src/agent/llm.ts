import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Intent } from './agent.service.js';
import { parseWhen } from './when.js';

/**
 * Claude reads a message the plain rules could not, and only names the intent
 * and its details. The code then does the work with the same checks as a
 * button, so a wrong guess can at worst give a wrong answer, never move a parcel
 * on its own (switching a courier still waits for a person's OK).
 * Off unless ANTHROPIC_API_KEY is set.
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
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL ?? 'claude-opus-5-5',
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
