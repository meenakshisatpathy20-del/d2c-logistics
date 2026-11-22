import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { istAt, slotLabel } from '../common/ist.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CouriersService } from './couriers.service.js';
import { DEMO_COURIERS } from './demo/profiles.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Fewer than this many pickups or deliveries: not enough history, the contract figure is used. */
export const MIN_SAMPLE = 5;
/** An answer within this many hours counts as on time. */
export const ANSWER_HOURS = 2;

const pct = (part: number, whole: number) => (whole >= MIN_SAMPLE ? Math.round((part / whole) * 100) : null);
const fmt = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export type Scorecard = {
  code: string;
  name: string;
  active: boolean;
  pickups: { due: number; onTime: number; pct: number | null; missed: number; notConfirmed: number };
  deliveries: { done: number; onTime: number; pct: number | null };
  failedDeliveryPct: number | null;
  rtoPct: number | null;
  issues: { raised: number; askedOfThem: number; answeredInTime: number; answerPct: number | null; remindersIgnored: number; promisesMade: number; promisesBroken: number; waitingOnThem: number };
  /** 0-100 from what we can measure: pickups 40, deliveries 30, answering 30. Null with too little history. */
  score: number | null;
  /** The pickup on-time % booking uses: earned when there is enough history, else the contract figure. */
  usedPickupPct: number;
  usedSource: 'earned' | 'contract';
};

/**
 * Courier scorecards earned from our own history, not typed in: pickups on
 * time, deliveries on time, failed deliveries and returns, and how they answer
 * issues (in time, reminders ignored, promises broken). Refreshed with the job
 * loop, and the pickup figure decides "Recommended" at booking.
 */
@Injectable()
export class ScorecardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly couriers: CouriersService,
  ) {}

  /** Recomputes every courier's card and hands the earned pickup figures to booking. */
  async refresh(now = new Date()) {
    const cards = await this.all(30, now);
    this.couriers.setEarnedPickupPct(Object.fromEntries(cards.filter((c) => c.pickups.pct !== null).map((c) => [c.code, c.pickups.pct!])));
    return cards.length;
  }

  async all(days = 30, now = new Date()): Promise<Scorecard[]> {
    const brandId = await this.brands.currentBrandId();
    const from = new Date(now.getTime() - days * DAY);

    const pickups = await this.prisma.pickup.findMany({
      where: { brandId, slotEnd: { gte: from, lte: now }, status: { in: ['PICKED_UP', 'MISSED', 'REASSIGNED'] }, parcelCount: { gt: 0 } },
      select: { courierCode: true, status: true, pickedUpAt: true, slotEnd: true },
    });
    const finished = await this.prisma.shipment.findMany({
      where: { brandId, status: { in: ['DELIVERED', 'RTO_INITIATED', 'RTO_DELIVERED', 'NDR', 'OUT_FOR_DELIVERY'] }, events: { some: { occurredAt: { gte: from } } } },
      select: {
        courierCode: true,
        status: true,
        expectedDelivery: true,
        events: { where: { status: { in: ['DELIVERED', 'NDR', 'RTO_INITIATED'] } }, select: { status: true, occurredAt: true } },
      },
    });
    const flags = await this.prisma.redFlag.findMany({
      where: { brandId, createdAt: { gte: from } },
      select: {
        courierCode: true,
        waitingOn: true,
        resolvedAt: true,
        createdAt: true,
        shipment: { select: { courierCode: true } },
        pickup: { select: { courierCode: true } },
        events: { select: { kind: true, actorParty: true, promiseAt: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    return this.couriers.list().map((c) => {
      const p = pickups.filter((x) => x.courierCode === c.code);
      const onTimePickups = p.filter((x) => x.status === 'PICKED_UP' && x.pickedUpAt && x.pickedUpAt <= x.slotEnd).length;
      const s = finished.filter((x) => x.courierCode === c.code);
      const delivered = s.filter((x) => x.events.some((e) => e.status === 'DELIVERED'));
      const deliveredOnTime = delivered.filter((x) => {
        const at = x.events.find((e) => e.status === 'DELIVERED')!.occurredAt;
        return !x.expectedDelivery || at <= istAt(x.expectedDelivery, 24);
      }).length;
      const ended = s.filter((x) => x.events.some((e) => e.status === 'DELIVERED' || e.status === 'RTO_INITIATED'));
      const withNdr = ended.filter((x) => x.events.some((e) => e.status === 'NDR')).length;
      const rto = ended.filter((x) => x.events.some((e) => e.status === 'RTO_INITIATED')).length;

      const theirs = flags.filter((f) => (f.shipment?.courierCode ?? f.pickup?.courierCode ?? f.courierCode) === c.code);
      // Asked of them: an issue where a message, reminder or the opening went to the courier.
      let asked = 0;
      let inTime = 0;
      for (const f of theirs) {
        const firstAsk = f.events.find((e) => (e.kind === 'ASK' || e.kind === 'REMINDER') && e.actorParty !== 'COURIER');
        if (!firstAsk) continue;
        asked++;
        const answer = f.events.find((e) => e.actorParty === 'COURIER' && e.createdAt >= firstAsk.createdAt);
        if (answer && answer.createdAt.getTime() - firstAsk.createdAt.getTime() <= ANSWER_HOURS * HOUR) inTime++;
      }
      const events = theirs.flatMap((f) => f.events);
      const issues = {
        raised: theirs.length,
        askedOfThem: asked,
        answeredInTime: inTime,
        answerPct: pct(inTime, asked),
        remindersIgnored: events.filter((e) => e.kind === 'REMINDER').length,
        promisesMade: events.filter((e) => e.actorParty === 'COURIER' && e.promiseAt).length,
        promisesBroken: events.filter((e) => e.kind === 'PROMISE_BROKEN').length,
        waitingOnThem: theirs.filter((f) => !f.resolvedAt && f.waitingOn === 'COURIER').length,
      };
      const pickupPct = pct(onTimePickups, p.length);
      const deliveryPct = pct(deliveredOnTime, delivered.length);
      const parts = [
        [pickupPct, 40],
        [deliveryPct, 30],
        [issues.answerPct, 30],
      ].filter(([v]) => v !== null) as [number, number][];
      const weight = parts.reduce((n, [, w]) => n + w, 0);
      const contract = DEMO_COURIERS.find((x) => x.code === c.code)?.pickupOnTimePct ?? 90;
      return {
        code: c.code,
        name: c.name,
        active: c.active,
        pickups: {
          due: p.length,
          onTime: onTimePickups,
          pct: pickupPct,
          missed: p.filter((x) => x.status === 'MISSED').length,
          notConfirmed: p.filter((x) => x.status === 'REASSIGNED').length,
        },
        deliveries: { done: delivered.length, onTime: deliveredOnTime, pct: deliveryPct },
        failedDeliveryPct: pct(withNdr, ended.length),
        rtoPct: pct(rto, ended.length),
        issues,
        score: weight >= 40 ? Math.round(parts.reduce((n, [v, w]) => n + v * w, 0) / weight) : null,
        usedPickupPct: pickupPct ?? contract,
        usedSource: pickupPct !== null ? 'earned' : 'contract',
      };
    });
  }

  /**
   * The weekly review pack for one courier: every breach with its time and
   * proof, ready to send to their account manager and to discuss in the call.
   */
  async review(code: string, days = 7, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const card = (await this.all(days, now)).find((c) => c.code === code.toUpperCase());
    if (!card) throw new NotFoundException('Unknown courier');
    const from = new Date(now.getTime() - days * DAY);

    const pickups = await this.prisma.pickup.findMany({
      where: { brandId, courierCode: card.code, slotEnd: { gte: from, lte: now }, OR: [{ status: { in: ['MISSED', 'REASSIGNED'] } }, { status: 'PICKED_UP', pickedUpAt: { gt: this.prisma.pickup.fields.slotEnd } }] },
      include: { warehouse: true },
      orderBy: { slotStart: 'asc' },
    });
    const late = await this.prisma.shipment.findMany({
      where: { brandId, courierCode: card.code, expectedDelivery: { gte: new Date(from.getTime() - 3 * DAY), lt: istAt(now, 0) }, status: { notIn: ['CANCELLED', 'BOOKED', 'PICKUP_SCHEDULED'] } },
      include: { order: true, events: { where: { status: 'DELIVERED' }, take: 1 } },
      orderBy: { expectedDelivery: 'asc' },
    });
    const lateRows = late
      .filter((s) => {
        const d = s.events[0]?.occurredAt;
        return s.expectedDelivery && (d ? d > istAt(s.expectedDelivery, 24) : !['RTO_INITIATED', 'RTO_DELIVERED'].includes(s.status));
      })
      .map((s) => ({
        awb: s.awb,
        order: s.order.orderNumber,
        city: s.order.city,
        promised: s.expectedDelivery,
        delivered: s.events[0]?.occurredAt ?? null,
        daysLate: Math.max(1, Math.floor(((s.events[0]?.occurredAt ?? now).getTime() - istAt(s.expectedDelivery!, 24).getTime()) / DAY) + 1),
      }));

    const flags = await this.prisma.redFlag.findMany({
      where: { brandId, createdAt: { gte: from }, OR: [{ shipment: { courierCode: card.code } }, { pickup: { courierCode: card.code } }, { courierCode: card.code }] },
      include: { events: { orderBy: { createdAt: 'asc' } }, shipment: { include: { order: true } }, pickup: { include: { warehouse: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const about = (f: (typeof flags)[number]) =>
      f.shipment ? `#${f.shipment.order.orderNumber} · AWB ${f.shipment.awb}` : f.pickup ? `${f.pickup.warehouse.name} · ${slotLabel(f.pickup.slotStart)}` : 'Account';

    return {
      courier: { code: card.code, name: card.name },
      period: { from, to: now, days },
      card,
      pickups: pickups.map((p) => ({
        when: p.slotStart,
        vendor: p.warehouse.name,
        slot: slotLabel(p.slotStart),
        parcels: p.parcelCount,
        what: p.status === 'MISSED' ? `Missed${p.missReason ? `: ${p.missReason}` : ''}` : p.status === 'REASSIGNED' ? 'Not confirmed 2 hours before; moved to another courier' : `Picked up late at ${fmt(p.pickedUpAt!)}`,
      })),
      lateDeliveries: lateRows,
      ignored: flags
        .filter((f) => f.events.some((e) => e.kind === 'REMINDER'))
        .map((f) => ({ id: f.id, title: f.title, about: about(f), reminders: f.events.filter((e) => e.kind === 'REMINDER').length, open: !f.resolvedAt })),
      brokenPromises: flags.flatMap((f) =>
        f.events.filter((e) => e.kind === 'PROMISE_BROKEN').map((e) => ({ id: f.id, title: f.title, about: about(f), what: e.body, at: e.createdAt })),
      ),
      claims: flags
        .filter((f) => f.type === 'PICKUP_CLAIM')
        .map((f) => ({
          id: f.id,
          title: f.title,
          about: about(f),
          withPhoto: f.events.some((e) => e.photoId),
          hoursCheck: f.events.find((e) => e.body.startsWith('Checked:'))?.body ?? null,
          outcome: f.outcome,
        })),
    };
  }
}
