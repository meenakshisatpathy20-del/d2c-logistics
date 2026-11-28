import { Injectable } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { BrandService } from '../common/brand.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PAYMENT } from '../issues/issue-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type GuardOrder, type GuardResult, inr, verdict } from './payment-guard.js';

const HOUR = 3600_000;
export const PAYMENT_TYPES = Object.keys(PAYMENT);
const TYPE_FOR: Record<string, string> = { PENDING: 'PAYMENT_PENDING', MISMATCH: 'PAYMENT_WRONG_ACCOUNT', REFUNDED: 'PAYMENT_REFUNDED' };

type OrderRef = { id: string; orderNumber: string; customerName: string; customerPhone: string };

/**
 * Reads the payment ledger for one order and keeps the order's payment issue in
 * step with it. Used by booking (the gate) and by every payment that comes in.
 */
@Injectable()
export class PaymentLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly alerts: AlertsService,
  ) {}

  async payees(brandId: string): Promise<string[]> {
    return (await this.prisma.brand.findUnique({ where: { id: brandId }, select: { payees: true } }))?.payees ?? [];
  }

  async check(brandId: string, orderNumber: string, o: GuardOrder): Promise<GuardResult> {
    const [payments, payees] = await Promise.all([this.prisma.payment.findMany({ where: { brandId, orderNumber } }), this.payees(brandId)]);
    return verdict(
      o,
      payments.map((p) => ({ reference: p.reference, amount: Number(p.amount), refundedAmount: Number(p.refundedAmount), status: p.status, payee: p.payee })),
      payees,
    );
  }

  /** Writes the verdict on the order, so the Orders screen and the 9 pm summary can show it. */
  async stamp(orderId: string, r: GuardResult, now: Date) {
    await this.prisma.order.update({ where: { id: orderId }, data: { paymentStatus: r.status, paymentNote: r.reason, paymentCheckedAt: now } });
  }

  /**
   * One payment issue per order, of the kind that fits what the ledger shows.
   * The customer is told once per problem (SMS, demo until approved) and our
   * finance person owns it. Returns the issue id.
   */
  async hold(brandId: string, o: OrderRef, r: GuardResult, now: Date, extra: { shipped?: boolean; stopped?: boolean } = {}): Promise<string> {
    const type = TYPE_FOR[r.status] ?? 'PAYMENT_PENDING';
    const title =
      type === 'PAYMENT_REFUNDED'
        ? `#${o.orderNumber}: payment refunded${extra.shipped ? ' but the parcel already shipped' : extra.stopped ? ', shipment stopped' : ''}`
        : type === 'PAYMENT_WRONG_ACCOUNT'
          ? `#${o.orderNumber}: paid to the wrong account`
          : `#${o.orderNumber}: prepaid, money not received`;
    const action = extra.shipped
      ? 'Ask the courier to return it (RTO), or collect the money from the customer'
      : type === 'PAYMENT_WRONG_ACCOUNT'
        ? 'Customer must pay into our account; the wrong-QR payment is not ours to keep'
        : 'Ships by itself once the money is in our account';
    const message = `${r.reason}${extra.stopped ? ' The booking was cancelled before pickup, so nothing left our hands.' : ''}${extra.shipped ? ' The courier already has the parcel.' : ''}`;
    const owner = await this.brands.ownerFor('FINANCE');
    const open = await this.prisma.redFlag.findFirst({ where: { brandId, orderId: o.id, type: { in: PAYMENT_TYPES }, resolvedAt: null } });
    let id: string;
    if (open && open.type === type) {
      id = open.id;
      if (open.message !== message) {
        await this.prisma.redFlag.update({ where: { id }, data: { title, message, action, ...(extra.shipped ? { severity: 'CRITICAL' } : {}) } });
        await this.event(id, `Payment check again: ${r.reason}`, now);
      }
    } else {
      if (open) await this.close(open.id, 'Replaced', `the payment problem changed to "${PAYMENT[type].label}".`, now);
      const turn = PAYMENT[type].turn;
      const f = await this.prisma.redFlag.create({
        data: {
          brandId,
          orderId: o.id,
          type,
          severity: extra.shipped || type === 'PAYMENT_WRONG_ACCOUNT' ? 'CRITICAL' : 'WARNING',
          title,
          message,
          action,
          ownerId: owner?.id ?? null,
          waitingOn: turn,
          waitingSince: now,
          dueAt: new Date(now.getTime() + (extra.shipped ? 2 : 24) * HOUR),
          createdAt: now,
        },
      });
      id = f.id;
      await this.event(id, `Payment guard: ${message}`, now);
    }
    if (type !== 'PAYMENT_REFUNDED' || !extra.shipped) await this.tellCustomer(brandId, o, type, r, now);
    return id;
  }

  /** The money is in: every open payment issue on the order closes with the reference as proof. */
  async settle(brandId: string, orderId: string, r: GuardResult, now: Date) {
    const open = await this.prisma.redFlag.findMany({ where: { brandId, orderId, type: { in: PAYMENT_TYPES }, resolvedAt: null } });
    for (const f of open) await this.close(f.id, 'Payment verified', `${inr(r.received)} received, reference ${r.reference}.`, now);
    return open.length;
  }

  private async close(id: string, outcome: string, body: string, now: Date, note?: string) {
    await this.prisma.redFlag.update({ where: { id }, data: { resolvedAt: now, outcome, faultParty: 'NONE', waitingOn: null, note: note ?? `${outcome}: ${body}` } });
    await this.event(id, `Closed by itself: ${body}`, now, 'RESOLVED');
  }

  private event(flagId: string, body: string, now: Date, kind = 'SYSTEM') {
    return this.prisma.issueEvent.create({ data: { flagId, kind, actorName: 'Payment guard', actorParty: 'SYSTEM', body, createdAt: now } });
  }

  private async tellCustomer(brandId: string, o: OrderRef, type: string, r: GuardResult, now: Date) {
    const text: Record<string, string> = {
      PAYMENT_PENDING: `We have not received ${inr(r.need)} for order #${o.orderNumber} yet. Your order ships as soon as it reaches us.`,
      PAYMENT_WRONG_ACCOUNT: `Your payment for order #${o.orderNumber} went to an account that is not ours, so we have not received it. Please pay ${inr(r.need)} using our payment link only.`,
      PAYMENT_REFUNDED: `Your payment for order #${o.orderNumber} was refunded to you, so the order is on hold. Pay ${inr(r.need)} again or choose cash on delivery.`,
    };
    await this.alerts.notify({
      brandId,
      phone: o.customerPhone,
      name: `${o.customerName} (customer)`,
      kind: 'PAYMENT_CUSTOMER',
      title: text[type],
      body: text[type],
      dedupeKey: `pay-cust:${o.id}:${type}:${r.received}`,
      now,
    });
  }

  /** A line in the ops agent's chat, so the team sees what the guard did without opening anything. */
  async tellTeam(brandId: string, body: string, items: Array<{ label: string; sub?: string; tone?: string; href?: string }>, now: Date, actions = 1) {
    await this.prisma.agentMessage.create({
      data: { brandId, role: 'AGENT', body, data: { intent: 'payment', items, actions } as Prisma.InputJsonValue, createdAt: now },
    });
  }
}
