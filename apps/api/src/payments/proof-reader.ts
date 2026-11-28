import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

/**
 * Reads a payment screenshot a customer sends ("I paid, see"). The AI model only
 * copies what is written on it; whether we were paid is decided by the payment
 * ledger, never by the picture. That is the point: a screenshot shows money
 * leaving the customer, not money reaching us, and not that it stayed.
 * Off unless ANTHROPIC_API_KEY and AGENT_MODEL are set.
 */
const ProofSchema = z.object({
  utr: z.string().nullable().describe('UTR / UPI reference / transaction ID, digits and letters only'),
  payee: z.string().nullable().describe('Who it was paid TO: the UPI ID (like name@bank) if shown, else the payee name'),
  amount: z.number().nullable().describe('Amount in rupees'),
  status: z.enum(['SUCCESS', 'PENDING', 'FAILED', 'UNKNOWN']),
  paidAt: z.string().nullable().describe('Date and time as written'),
  app: z.string().nullable().describe('Payment app, e.g. PhonePe, Google Pay, Paytm, bank app'),
});
export type ProofRead = z.infer<typeof ProofSchema>;

let client: Anthropic | null = null;

export async function readProof(dataUrl: string): Promise<ProofRead | null> {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.AGENT_MODEL) return null;
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL,
    max_tokens: 1024,
    system: 'You copy the details from an Indian UPI or bank payment screenshot exactly as shown. Do not guess; use null when a field is not visible.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: m[2] } },
          { type: 'text', text: 'Read this payment screenshot.' },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ProofSchema) },
  });
  return res.parsed_output ?? null;
}
