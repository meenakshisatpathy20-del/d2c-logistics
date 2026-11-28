import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { BrandService } from '../common/brand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../shipments/orders.service.js';
import { ShipmentsService } from '../shipments/shipments.service.js';
import { guardOn, type GuardResult, inr, isOurs, normalisePayee, parseStatement, type StatementRow } from './payment-guard.js';
import { PaymentLedgerService } from './payment-ledger.service.js';
import { readProof } from './proof-reader.js';

const PRE_PICKUP = ['BOOKED', 'PICKUP_SCHEDULED'];

/** One payment event in our own shape; a gateway's webhook is mapped to this. */
export const PaymentEventSchema = z.object({
  event: z.enum(['payment.captured', 'payment.failed', 'refund.processed']),
  orderNumber: z.string().trim().min(1).max(40).transform((v) => v.replace(/^#/, '')),
  reference: z.string().trim().min(4).max(80),
  amount: z.number().positive(),
  payee: z.string().trim().max(120).optional(),
  method: z.string().trim().max(30).optional(),
  at: z.coerce.date().optional(),
});
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;

export const ImportSchema = z.object({ csv: z.string().min(10).max(2_000_000) });
export const PayeesSchema = z.object({ payees: z.array(z.string().trim().min(3).max(120)).max(20) });
export const ProofSchema = z.object({
  orderNumber: z.string().trim().min(1).max(40).transform((v) => v.replace(/^#/, '')),
  dataUrl: z.string().max(8_000_000).optional(),
  utr: z.string().trim().max(80).optional(),
  payee: z.string().trim().max(120).optional(),
});

type Actor = { id: string; name: string };
type Outcome = { orderNumber: string; status: GuardResult['status'] | 'NO_ORDER'; did: string; reason: string };

/**
 * The payment guard at work: every payment, failure and refund from the gateway
 * or the bank statement lands in one ledger, and each order is re-checked the
 * moment its money changes. Paid in our account: it books by itself. Refunded
 * before pickup: the booking is cancelled. Refunded after pickup: an urgent
 * issue to get the parcel back or the money in. Nobody has to notice it.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly ledger: PaymentLedgerService,
    private readonly shipments: ShipmentsService,
    private readonly orders: OrdersService,
  ) {}

  // ---------- Money in and out ----------

  /** A webhook event from the gateway (or a bank/UPI feed). */
  async event(e: PaymentEvent, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const at = e.at ?? now;
    const existing = await this.prisma.payment.findUnique({ where: { brandId_reference: { brandId, reference: e.reference } } });
    if (e.event === 'refund.processed') {
      if (!existing) throw new BadRequestException(`No payment ${e.reference} to refund`);
      const refunded = Math.min(Number(existing.amount), Number(existing.refundedAmount) + e.amount);
      await this.prisma.payment.update({
        where: { id: existing.id },
        data: { refundedAmount: refunded, status: refunded + 1 >= Number(existing.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedAt: at },
      });
    } else {
      const data = {
        orderNumber: e.orderNumber,
        source: 'WEBHOOK',
        method: e.method?.toUpperCase() ?? null,
        payee: e.payee || null,
        amount: e.amount,
        status: e.event === 'payment.failed' ? 'FAILED' : 'CAPTURED',
        paidAt: at,
      };
      // A refund already recorded is never undone by a late "captured" retry.
      if (existing) await this.prisma.payment.update({ where: { id: existing.id }, data: existing.status.includes('REFUNDED') ? { orderNumber: e.orderNumber } : data });
      else await this.prisma.payment.create({ data: { ...data, brandId, reference: e.reference, createdAt: now } });
    }
    return this.recheck(brandId, existing?.orderNumber ?? e.orderNumber, now, `${e.event} ${e.reference}`);
  }

  /** The day's gateway export or bank/UPI statement, as CSV. Re-importing the same file changes nothing. */
  async importStatement(csv: string, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const { rows, errors } = parseStatement(csv);
    if (!rows.length) throw new BadRequestException(errors[0] ?? 'Nothing to import');
    let added = 0;
    let updated = 0;
    const touched = new Set<string>();
    for (const r of rows) {
      const before = await this.prisma.payment.findUnique({ where: { brandId_reference: { brandId, reference: r.reference } } });
      const data = this.rowData(r, now);
      if (!before) {
        await this.prisma.payment.create({ data: { ...data, brandId, reference: r.reference, createdAt: now } });
        added++;
        touched.add(r.orderNumber);
      } else if (Number(before.amount) !== r.amount || Number(before.refundedAmount) !== r.refundedAmount || before.status !== r.status || before.orderNumber !== r.orderNumber) {
        await this.prisma.payment.update({ where: { id: before.id }, data });
        updated++;
        touched.add(r.orderNumber);
        touched.add(before.orderNumber);
      }
    }
    const outcomes: Outcome[] = [];
    for (const n of touched) outcomes.push(await this.recheck(brandId, n, now, 'statement'));
    return { rows: rows.length, added, updated, unchanged: rows.length - added - updated, errors, outcomes };
  }

  private rowData(r: StatementRow, now: Date) {
    return {
      orderNumber: r.orderNumber,
      source: 'CSV',
      method: r.method,
      payee: r.payee,
      amount: r.amount,
      refundedAmount: r.refundedAmount,
      status: r.status,
      paidAt: r.paidAt ?? now,
      refundedAt: r.refundedAmount > 0 ? now : null,
    };
  }

  // ---------- The check ----------

  /**
   * Re-reads one order's money and acts on it. Safe to run any number of times:
   * each step only happens if the order is not already in that state.
   */
  async recheck(brandId: string, orderNumber: string, now: Date, why: string): Promise<Outcome> {
    this.log.debug(`Payment check #${orderNumber} (${why})`);
    const o = await this.prisma.order.findUnique({
      where: { brandId_orderNumber: { brandId, orderNumber } },
      include: { pickupWarehouse: true, shipments: { where: { status: { not: 'CANCELLED' } }, include: { courier: true } } },
    });
    if (!o) return { orderNumber, status: 'NO_ORDER', did: 'Kept in the ledger; it is checked when the order arrives', reason: '' };
    if (o.status === 'CANCELLED') return { orderNumber, status: 'NO_ORDER', did: 'Order is cancelled; nothing to do', reason: '' };
    const r = await this.ledger.check(brandId, orderNumber, { paymentMode: o.paymentMode, orderValue: Number(o.orderValue), codAdvance: Number(o.codAdvance) });
    const was = o.paymentStatus;
    await this.ledger.stamp(o.id, r, now);
    const s = o.shipments[0];
    const href = `/orders/${o.id}`;

    if (r.status === 'VERIFIED' || r.status === 'NOT_NEEDED') {
      const closed = await this.ledger.settle(brandId, o.id, r, now);
      if (!s && o.status === 'NEW' && guardOn() && (was === 'PENDING' || was === 'MISMATCH' || was === 'REFUNDED')) {
        // It was held only for the money: book it now, nobody has to remember.
        try {
          const b = await this.shipments.book(this.bookingFor(o), now);
          await this.ledger.tellTeam(brandId, `Payment for #${o.orderNumber} arrived (${r.reference}). I booked it with ${b.courierName}.`, [{ label: `#${o.orderNumber} · ${b.courierName}`, sub: b.awb, tone: 'green', href }], now);
          return { orderNumber, status: r.status, did: `Booked with ${b.courierName} (${b.awb})`, reason: r.reason };
        } catch (e) {
          await this.ledger.tellTeam(brandId, `Payment for #${o.orderNumber} arrived, but booking failed: ${(e as Error).message}`, [{ label: `#${o.orderNumber}`, tone: 'red', href }], now);
          return { orderNumber, status: r.status, did: `Paid; booking failed: ${(e as Error).message}`, reason: r.reason };
        }
      }
      return { orderNumber, status: r.status, did: closed ? 'Payment issue closed' : 'Verified', reason: r.reason };
    }

    // Not paid (any more). Before booking: hold it. Booked but not picked up: stop it.
    // With the courier already: an urgent issue, the parcel must come back or the money in.
    if (!s) {
      const id = await this.ledger.hold(brandId, o, r, now);
      return { orderNumber, status: r.status, did: `On hold, issue ${id}`, reason: r.reason };
    }
    if (PRE_PICKUP.includes(s.status)) {
      await this.orders.cancel(o.id, 'shipment', `Payment guard: ${r.reason}`.slice(0, 200), undefined, now);
      await this.ledger.stamp(o.id, r, now);
      const id = await this.ledger.hold(brandId, o, r, now, { stopped: true });
      await this.ledger.tellTeam(brandId, `Stopped #${o.orderNumber} before pickup: ${r.reason} The ${s.courier.name} booking (${s.awb}) is cancelled.`, [{ label: `#${o.orderNumber}`, sub: 'Payment issue', tone: 'red', href: `/issues/${id}` }], now);
      return { orderNumber, status: r.status, did: `Booking ${s.awb} cancelled before pickup`, reason: r.reason };
    }
    if (['DELIVERED', 'RTO_INITIATED', 'RTO_DELIVERED'].includes(s.status) && r.status !== 'REFUNDED') {
      return { orderNumber, status: r.status, did: 'Already delivered or returning; flagged for finance', reason: r.reason };
    }
    const id = await this.ledger.hold(brandId, o, r, now, { shipped: true });
    await this.ledger.tellTeam(brandId, `Urgent: #${o.orderNumber} is with ${s.courier.name} (${s.awb}) but ${r.reason} Ask for a return or collect the money.`, [{ label: `#${o.orderNumber} · ${s.courier.name}`, sub: s.awb, tone: 'red', href: `/issues/${id}` }], now);
    return { orderNumber, status: r.status, did: 'Shipped already: urgent issue raised', reason: r.reason };
  }

  /** The order as it was saved when it was held, in the booking form's shape. */
  private bookingFor(o: { orderNumber: string; productBrand: string | null; items: unknown; customerName: string; customerPhone: string; addressLine: string; city: string; state: string; pincode: string; pickupWarehouse: { code: string }; paymentMode: 'PREPAID' | 'COD'; orderValue: unknown; codAdvance: unknown; weightGrams: number; lengthCm: number; breadthCm: number; heightCm: number }) {
    const items = (Array.isArray(o.items) ? o.items : []) as Array<{ name?: string }>;
    return {
      orderNumber: o.orderNumber,
      productBrand: o.productBrand ?? undefined,
      productName: items[0]?.name?.slice(0, 120),
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      addressLine: o.addressLine,
      city: o.city || undefined,
      state: o.state || undefined,
      pincode: o.pincode,
      warehouseCode: o.pickupWarehouse.code,
      paymentMode: o.paymentMode,
      orderValue: Number(o.orderValue),
      codAdvance: Number(o.codAdvance) || undefined,
      weightGrams: o.weightGrams,
      lengthCm: o.lengthCm,
      breadthCm: o.breadthCm,
      heightCm: o.heightCm,
      idempotencyKey: `paid:${o.orderNumber}:${Date.now().toString(36)}`,
    };
  }

  // ---------- "I paid, here is the screenshot" ----------

  /**
   * Checks a customer's payment screenshot (or a UTR typed by our team) against
   * the ledger. It can only ever say "found in our account" or explain why not;
   * a screenshot alone never marks an order paid.
   */
  async checkProof(input: z.infer<typeof ProofSchema>, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const o = await this.prisma.order.findUnique({ where: { brandId_orderNumber: { brandId, orderNumber: input.orderNumber } } });
    if (!o) throw new NotFoundException(`No order #${input.orderNumber}`);
    const read = input.dataUrl ? await readProof(input.dataUrl).catch((e) => (this.log.warn(`Proof read failed: ${(e as Error).message}`), null)) : null;
    if (input.dataUrl && !read && !input.utr) throw new BadRequestException('The screenshot could not be read here. Type the UTR from it.');
    const utr = (input.utr || read?.utr || '').replace(/\s/g, '');
    const payee = input.payee || read?.payee || null;
    const payees = await this.ledger.payees(brandId);
    const findings: string[] = [];
    let verdict: 'PAID_TO_US' | 'WRONG_ACCOUNT' | 'REFUNDED' | 'NOT_FOUND' | 'FAILED' = 'NOT_FOUND';

    if (read?.status === 'FAILED') {
      verdict = 'FAILED';
      findings.push('The screenshot itself shows the payment failed.');
    } else if (payee && !isOurs(payee, payees)) {
      verdict = 'WRONG_ACCOUNT';
      findings.push(`Paid to ${payee}, which is not one of our accounts (${payees.join(', ') || 'none set'}). This is a wrong-QR payment: the money did not reach us.`);
    }
    const p = utr ? await this.prisma.payment.findFirst({ where: { brandId, OR: [{ reference: utr }, { reference: { endsWith: utr.slice(-8) } }] } }) : null;
    if (verdict === 'NOT_FOUND' && p) {
      if (p.orderNumber !== o.orderNumber) findings.push(`UTR ${utr} is in our account, but for order #${p.orderNumber}, not #${o.orderNumber}.`);
      else if (p.status === 'FAILED') {
        verdict = 'FAILED';
        findings.push(`UTR ${utr} failed at the bank.`);
      } else if (Number(p.refundedAmount) > 0) {
        verdict = 'REFUNDED';
        findings.push(`UTR ${utr} reached us but ${inr(Number(p.refundedAmount))} was refunded to the customer${p.refundedAt ? ` on ${p.refundedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}` : ''}.`);
      } else if (!isOurs(p.payee, payees)) {
        verdict = 'WRONG_ACCOUNT';
        findings.push(`UTR ${utr} was paid to ${p.payee}, not to us.`);
      } else {
        verdict = 'PAID_TO_US';
        findings.push(`UTR ${utr}: ${inr(Number(p.amount))} is in our account.`);
      }
    } else if (verdict === 'NOT_FOUND') {
      findings.push(utr ? `UTR ${utr} is not in our gateway or bank records yet. A screenshot shows money leaving the customer, not reaching us. It stays on hold until it shows up.` : 'No UTR on it. Ask the customer for the UTR (12 digits) from their payment app.');
    }
    if (read?.amount && read.amount + 1 < Number(o.paymentMode === 'PREPAID' ? o.orderValue : o.codAdvance)) findings.push(`The screenshot shows ${inr(read.amount)}, less than the ${inr(Number(o.paymentMode === 'PREPAID' ? o.orderValue : o.codAdvance))} due.`);

    // The ledger, not the picture, decides; the check is written on the order's payment issue.
    const outcome = await this.recheck(brandId, o.orderNumber, now, 'proof');
    const flag = await this.prisma.redFlag.findFirst({ where: { brandId, orderId: o.id, type: { startsWith: 'PAYMENT_' } }, orderBy: { createdAt: 'desc' } });
    if (flag) {
      await this.prisma.issueEvent.create({
        data: { flagId: flag.id, kind: 'MESSAGE', actorId: actor.id, actorName: actor.name, actorParty: 'OURS', body: `Payment proof checked${read ? ` (screenshot read: ${[read.app, read.utr, read.payee, read.amount ? inr(read.amount) : null].filter(Boolean).join(' · ')})` : ''}: ${findings.join(' ')}`, createdAt: now },
      });
    }
    return { orderNumber: o.orderNumber, verdict, read, utr: utr || null, payee, findings, payment: outcome };
  }

  // ---------- Screens ----------

  async holds() {
    const brandId = await this.brands.currentBrandId();
    const [held, flags, recent, payees] = await Promise.all([
      this.prisma.order.findMany({
        where: { brandId, paymentStatus: { in: ['PENDING', 'MISMATCH', 'REFUNDED'] }, status: { not: 'CANCELLED' } },
        include: { shipments: { where: { status: { not: 'CANCELLED' } }, include: { courier: true } } },
        orderBy: { paymentCheckedAt: 'desc' },
        take: 100,
      }),
      this.prisma.redFlag.findMany({ where: { brandId, type: { startsWith: 'PAYMENT_' }, resolvedAt: null }, select: { id: true, orderId: true } }),
      this.prisma.payment.findMany({ where: { brandId }, orderBy: { updatedAt: 'desc' }, take: 30 }),
      this.ledger.payees(brandId),
    ]);
    const issueOf = new Map(flags.map((f) => [f.orderId, f.id]));
    const ours = new Set(payees.map(normalisePayee));
    return {
      guard: guardOn() ? 'on' : 'off',
      payees,
      held: held.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        amount: Number(o.paymentMode === 'PREPAID' ? o.orderValue : o.codAdvance),
        paymentMode: o.paymentMode,
        status: o.paymentStatus,
        reason: o.paymentNote,
        shipped: o.shipments[0] ? { courier: o.shipments[0].courier.name, awb: o.shipments[0].awb, status: o.shipments[0].status } : null,
        issueId: issueOf.get(o.id) ?? null,
        checkedAt: o.paymentCheckedAt,
      })),
      recent: recent.map((p) => ({
        reference: p.reference,
        orderNumber: p.orderNumber,
        amount: Number(p.amount),
        refunded: Number(p.refundedAmount),
        status: p.status,
        payee: p.payee,
        ours: !p.payee || ours.has(normalisePayee(p.payee)),
        source: p.source,
        at: p.paidAt,
      })),
    };
  }

  async setPayees(payees: string[], actor: Actor) {
    const brandId = await this.brands.currentBrandId();
    const clean = [...new Set(payees.map((p) => p.trim()).filter(Boolean))];
    const before = await this.ledger.payees(brandId);
    await this.prisma.brand.update({ where: { id: brandId }, data: { payees: clean } });
    await this.prisma.auditLog.create({ data: { brandId, actorId: actor.id, action: 'PAYEES_CHANGED', entityType: 'Brand', entityId: brandId, before, after: clean } });
    return { payees: clean };
  }
}
