/**
 * The payment guard's rules, in one place and free of the database, so they can
 * be tested line by line.
 *
 * The rule: an order ships only when our own payment records show the money is
 * in OUR account and still with us. "Payment done" in a chat, a screenshot or an
 * order marked PREPAID in a CSV proves nothing; it is how a customer who paid a
 * wrong QR (and was refunded the same day) got her parcel shipped.
 */

export type PaymentVerdict = 'VERIFIED' | 'PENDING' | 'MISMATCH' | 'REFUNDED' | 'NOT_NEEDED';

export type LedgerPayment = {
  reference: string;
  amount: number;
  refundedAmount: number;
  status: string; // CAPTURED, FAILED, REFUNDED, PARTIALLY_REFUNDED
  payee: string | null;
};

export type GuardOrder = { paymentMode: 'PREPAID' | 'COD'; orderValue: number; codAdvance: number };

export type GuardResult = {
  status: PaymentVerdict;
  need: number; // what must be in our account before it ships
  received: number; // ours, after refunds
  refunded: number;
  wrongAccount: number; // paid to someone else
  reference: string | null; // the payment that proves it
  reason: string;
};

/** A rupee of rounding either way is fine; anything more is short. */
const TOLERANCE = 1;

/** "D2C Ecommerce@ICICI " and "d2cecommerce@icici" are the same account. */
export const normalisePayee = (p: string) => p.toLowerCase().replace(/\s+/g, '');

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** What must be paid online before dispatch: the full value if prepaid, the advance if COD. */
export function amountDue(o: GuardOrder): number {
  return o.paymentMode === 'PREPAID' ? o.orderValue : o.codAdvance;
}

/**
 * Is this payment into one of our accounts? A payment from our own gateway has
 * no payee (the gateway only ever pays us). A UPI or bank line names the payee;
 * it must be one of the accounts listed in Settings.
 */
export function isOurs(payee: string | null, ourPayees: string[]): boolean {
  if (!payee || !payee.trim()) return true;
  const p = normalisePayee(payee);
  return ourPayees.some((o) => normalisePayee(o) === p);
}

export function verdict(o: GuardOrder, payments: LedgerPayment[], ourPayees: string[]): GuardResult {
  const need = Math.round(amountDue(o) * 100) / 100;
  const base = { need, received: 0, refunded: 0, wrongAccount: 0, reference: null as string | null };
  if (need <= 0) return { ...base, status: 'NOT_NEEDED', reason: 'Cash on delivery with no advance: nothing to collect online.' };

  const taken = payments.filter((p) => p.status !== 'FAILED');
  const ours = taken.filter((p) => isOurs(p.payee, ourPayees));
  const theirs = taken.filter((p) => !isOurs(p.payee, ourPayees));
  const gross = ours.reduce((n, p) => n + p.amount, 0);
  const refunded = ours.reduce((n, p) => n + Math.min(p.refundedAmount, p.amount), 0);
  const received = Math.round((gross - refunded) * 100) / 100;
  const wrongAccount = theirs.reduce((n, p) => n + p.amount, 0);
  const best = [...ours].sort((a, b) => b.amount - b.refundedAmount - (a.amount - a.refundedAmount))[0];
  const r = { ...base, received, refunded, wrongAccount, reference: best?.reference ?? null };

  if (received + TOLERANCE >= need) {
    return { ...r, status: 'VERIFIED', reason: `${inr(received)} received in our account (${best!.reference}).` };
  }
  if (refunded > 0) {
    return { ...r, status: 'REFUNDED', reason: `${inr(gross)} was paid but ${inr(refunded)} was refunded to the customer${received > 0 ? `; only ${inr(received)} is with us` : ''}. ${inr(need)} is needed.` };
  }
  if (wrongAccount > 0) {
    const where = theirs.map((p) => p.payee).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    return { ...r, status: 'MISMATCH', reason: `${inr(wrongAccount)} was paid to ${where}, which is not our account (wrong QR). Nothing reached us.` };
  }
  if (received > 0) {
    return { ...r, status: 'PENDING', reason: `Only ${inr(received)} of ${inr(need)} received.` };
  }
  return { ...r, status: 'PENDING', reason: `No payment of ${inr(need)} found in our account yet.` };
}

/** Guard modes: enforce (default) blocks booking; off skips the check (local tests, emergencies). */
export const guardOn = () => (process.env.PAYMENT_GUARD ?? 'enforce') !== 'off';

// ---------- Reading a statement or gateway export ----------

export type StatementRow = {
  orderNumber: string;
  reference: string;
  amount: number;
  refundedAmount: number;
  status: 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  payee: string | null;
  method: string | null;
  paidAt: Date | null;
};

const HEADERS: Record<keyof StatementRow, string[]> = {
  orderNumber: ['order', 'order id', 'order number', 'order no', 'order_id', 'receipt', 'notes.order_id', 'merchant order id'],
  reference: ['utr', 'reference', 'payment id', 'payment_id', 'id', 'rrn', 'transaction id', 'txn id', 'bank reference'],
  amount: ['amount', 'paid', 'credit', 'amount paid', 'captured amount'],
  refundedAmount: ['refund', 'refunded', 'amount refunded', 'amount_refunded', 'refund amount'],
  status: ['status', 'state'],
  payee: ['payee', 'paid to', 'vpa', 'upi id', 'account', 'merchant', 'beneficiary'],
  method: ['method', 'mode', 'payment method'],
  paidAt: ['date', 'paid at', 'created at', 'created_at', 'time', 'transaction date'],
};

/** Splits one CSV line, keeping commas inside quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === ',' && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Amounts written "₹1,299.00", "1299", "Rs 1299". Razorpay exports paise in "amount" only via its API, not CSV. */
const money = (v: string | undefined) => {
  const n = Number((v ?? '').replace(/[₹,\s]|rs\.?|inr/gi, ''));
  return Number.isFinite(n) ? n : NaN;
};

function readStatus(v: string, amount: number, refunded: number): StatementRow['status'] {
  const s = v.toLowerCase();
  if (/fail|declin|reject|cancel/.test(s)) return 'FAILED';
  if (refunded > 0) return refunded + TOLERANCE >= amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (/partial/.test(s) && /refund/.test(s)) return 'PARTIALLY_REFUNDED';
  if (/refund|reversed|chargeback/.test(s)) return 'REFUNDED';
  return 'CAPTURED';
}

/**
 * Reads a gateway export or bank/UPI statement with any of the usual column
 * names. Rows without an order number or reference are reported, not guessed.
 */
export function parseStatement(csv: string): { rows: StatementRow[]; errors: string[] } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ['The file has no rows under the header'] };
  const head = cells(lines[0]).map((h) => h.toLowerCase().replace(/^"|"$/g, '').trim());
  const col = (k: keyof StatementRow) => head.findIndex((h) => HEADERS[k].includes(h));
  const idx = Object.fromEntries((Object.keys(HEADERS) as Array<keyof StatementRow>).map((k) => [k, col(k)])) as Record<keyof StatementRow, number>;
  const missing = (['orderNumber', 'reference', 'amount'] as const).filter((k) => idx[k] < 0);
  if (missing.length) return { rows: [], errors: [`Columns not found: ${missing.map((k) => HEADERS[k][0]).join(', ')}. The first line must be the header.`] };
  const rows: StatementRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const c = cells(line);
    const get = (k: keyof StatementRow) => (idx[k] >= 0 ? c[idx[k]] : undefined);
    const orderNumber = (get('orderNumber') ?? '').replace(/^#/, '').trim();
    const reference = (get('reference') ?? '').trim();
    const amount = money(get('amount'));
    const refundedAmount = idx.refundedAmount >= 0 ? money(get('refundedAmount')) || 0 : 0;
    if (!orderNumber || !reference || !(amount > 0)) {
      errors.push(`Row ${i + 2}: needs an order number, a reference and an amount`);
      return;
    }
    const when = get('paidAt') ? new Date(get('paidAt')!) : null;
    rows.push({
      orderNumber,
      reference,
      amount,
      refundedAmount,
      status: readStatus(get('status') ?? '', amount, refundedAmount),
      payee: get('payee')?.trim() || null,
      method: get('method')?.trim().toUpperCase() || null,
      paidAt: when && !Number.isNaN(when.getTime()) ? when : null,
    });
  });
  return { rows, errors };
}
