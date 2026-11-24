import { Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { BrandService } from '../common/brand.service.js';
import { istAt, nextWorkingDayOffset, slotLabel } from '../common/ist.js';
import { WATCHDOG } from '../issues/issue-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

type Target = { shipmentId?: string; pickupId?: string; orderId?: string };
type Raise = Target & {
  type: string;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  action: string;
  dueAt: Date;
  role?: 'OPS' | 'SUPPORT';
};

const date = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
const fmtInr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * The deadline check. Runs every minute with the other jobs and looks at every
 * open order and parcel against a deadline, so none can sit quietly at any step.
 * Each problem it finds becomes an issue with an owner; each closes by itself
 * once the order moves on.
 */
@Injectable()
export class WatchdogService {
  private readonly log = new Logger(WatchdogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly alerts: AlertsService,
  ) {}

  async run(now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const counts = {
      notBooked: await this.notBooked(brandId, now),
      notPacked: await this.notPacked(brandId, now),
      waiting: await this.parcelsWaiting(brandId, now),
      outForDelivery: await this.outForDelivery(brandId, now),
      delayed: await this.delayed(brandId, now),
      returns: await this.returnStuck(brandId, now),
      attempts: await this.attempts(brandId, now),
    };
    if (Object.values(counts).some(Boolean)) this.log.log(counts);
    return counts;
  }

  /** An order that came in but was never booked within 24 hours. */
  private async notBooked(brandId: string, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: { brandId, status: 'NEW', createdAt: { lt: new Date(now.getTime() - DAY) }, shipments: { none: { status: { not: 'CANCELLED' } } } },
      include: { pickupWarehouse: true },
    });
    for (const o of orders) {
      const hours = Math.floor((now.getTime() - o.createdAt.getTime()) / HOUR);
      await this.raise(brandId, now, {
        orderId: o.id,
        type: 'NOT_BOOKED',
        severity: 'WARNING',
        title: `Order #${o.orderNumber} not booked for ${hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} hours`}`,
        message: `${o.customerName}, ${o.city || o.pincode} · ${fmtInr(Number(o.orderValue))} ${o.paymentMode} · ships from ${o.pickupWarehouse.name}`,
        action: 'Book it or cancel it',
        dueAt: new Date(now.getTime() + 4 * HOUR),
      });
    }
    await this.settle(brandId, 'NOT_BOOKED', orders.map((o) => o.id), now, async (f) => {
      const booked = await this.prisma.shipment.count({ where: { orderId: f.orderId!, status: { not: 'CANCELLED' } } });
      if (booked) return 'Booked';
      const o = await this.prisma.order.findUnique({ where: { id: f.orderId! } });
      return o?.status === 'CANCELLED' ? 'Order cancelled' : 'Booked';
    });
    return orders.length;
  }

  /** One hour before the slot, parcels the vendor has not marked packed. */
  private async notPacked(brandId: string, now: Date) {
    const pickups = await this.prisma.pickup.findMany({
      where: { brandId, status: { in: ['SCHEDULED', 'CONFIRMED'] }, slotStart: { lte: new Date(now.getTime() + HOUR) }, slotEnd: { gt: now } },
      include: { warehouse: true, courier: true, shipments: { where: { status: { in: ['BOOKED', 'PICKUP_SCHEDULED'] } } } },
    });
    const hit: string[] = [];
    for (const p of pickups) {
      const unpacked = p.shipments.filter((s) => !s.packedAt);
      if (!unpacked.length) continue;
      hit.push(p.id);
      await this.raise(brandId, now, {
        pickupId: p.id,
        type: 'NOT_PACKED',
        severity: 'WARNING',
        title: `${p.warehouse.name}: ${unpacked.length} of ${p.shipments.length} parcels not packed`,
        message: `${p.courier.name} pickup ${slotLabel(p.slotStart)} · the vendor has not marked them packed`,
        action: 'Ask the vendor to pack or postpone',
        dueAt: p.slotStart,
      });
    }
    await this.settle(brandId, 'NOT_PACKED', hit, now, async (f) => {
      const p = await this.prisma.pickup.findUnique({ where: { id: f.pickupId! } });
      if (p?.status === 'PICKED_UP') return 'Picked up';
      if (p?.status === 'POSTPONED') return 'Postponed by the vendor';
      if (p?.status === 'REASSIGNED' || p?.status === 'MISSED') return 'Moved to another courier';
      return 'Packed and ready';
    });
    return hit.length;
  }

  /**
   * The one-working-day cap: a parcel booked today must leave the vendor by the
   * end of the next working day. Past that, the founder hears about it.
   */
  private async parcelsWaiting(brandId: string, now: Date) {
    const parcels = await this.prisma.shipment.findMany({
      where: { brandId, status: { in: ['BOOKED', 'PICKUP_SCHEDULED'] }, pickupId: { not: null } },
      include: { order: { include: { pickupWarehouse: true } }, pickup: true, courier: true },
      orderBy: { createdAt: 'asc' },
    });
    const late = parcels.filter((s) => {
      const w = s.order.pickupWarehouse;
      return istAt(s.createdAt, w.closesAt, nextWorkingDayOffset(s.createdAt)).getTime() < now.getTime();
    });
    // One issue per vendor, on the pickup holding the oldest parcel.
    const byVendor = new Map<string, typeof late>();
    for (const s of late) byVendor.set(s.order.pickupWarehouseId, [...(byVendor.get(s.order.pickupWarehouseId) ?? []), s]);
    const hit: string[] = [];
    const founders = await this.prisma.user.findMany({ where: { brandId, role: 'ADMIN', active: true } });
    for (const [warehouseId, list] of byVendor) {
      const oldest = list[0];
      const value = list.reduce((n, s) => n + Number(s.order.orderValue), 0);
      const couriers = [...new Set(list.map((s) => s.courier.name))].join(', ');
      // Already open for this vendor on an older pickup: move it to the current one.
      const open = await this.prisma.redFlag.findFirst({ where: { brandId, type: 'PARCELS_WAITING', resolvedAt: null, pickup: { warehouseId } } });
      if (open && open.pickupId !== oldest.pickupId) await this.prisma.redFlag.update({ where: { id: open.id }, data: { pickupId: oldest.pickupId } });
      hit.push(oldest.pickupId!);
      const flag = await this.raise(brandId, now, {
        pickupId: oldest.pickupId!,
        type: 'PARCELS_WAITING',
        severity: 'CRITICAL',
        title: `${list.length} parcels stuck at ${oldest.order.pickupWarehouse.name} since ${date(oldest.createdAt)}`,
        message: `${couriers} · ${fmtInr(value)} of orders not picked up within 1 working day`,
        action: 'Switch courier or get a pickup today',
        dueAt: new Date(now.getTime() + 2 * HOUR),
      });
      if (flag?.created) {
        for (const u of founders) {
          await this.alerts.send({
            brandId,
            userId: u.id,
            channel: 'APP',
            to: u.name,
            kind: 'FOUNDER_ALERT',
            title: `${list.length} parcels stuck at ${oldest.order.pickupWarehouse.name}`,
            body: `Not picked up within 1 working day (${couriers}, ${fmtInr(value)}).`,
            link: `/issues/${flag.id}`,
            dedupeKey: `founder:${flag.id}`,
            now,
          });
        }
      }
    }
    await this.settle(brandId, 'PARCELS_WAITING', hit, now, async () => 'Picked up');
    return byVendor.size;
  }

  /** Out for delivery with no delivered or failed scan by 9 pm that day. */
  private async outForDelivery(brandId: string, now: Date) {
    const list = await this.prisma.shipment.findMany({
      where: { brandId, status: 'OUT_FOR_DELIVERY', lastScanAt: { not: null } },
      include: { order: true, courier: true },
    });
    const late = list.filter((s) => istAt(s.lastScanAt!, 21).getTime() <= now.getTime());
    for (const s of late) {
      await this.raise(brandId, now, {
        shipmentId: s.id,
        type: 'OFD_NO_RESULT',
        severity: 'WARNING',
        title: 'Out for delivery, no result by 9 pm',
        message: `${s.courier.name} · ${s.awb} · ${s.order.city} · was it delivered or attempted?`,
        action: 'Ask the courier for the result',
        dueAt: new Date(now.getTime() + 12 * HOUR),
        role: 'SUPPORT',
      });
    }
    await this.settle(brandId, 'OFD_NO_RESULT', late.map((s) => s.id), now, (f) => this.shipmentOutcome(f.shipmentId!, 'DELIVERY'));
    return late.length;
  }

  /** The promised delivery date has passed and the parcel is still on the way. */
  private async delayed(brandId: string, now: Date) {
    const list = await this.prisma.shipment.findMany({
      where: { brandId, status: { in: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] }, expectedDelivery: { lt: now } },
      include: { order: true, courier: true },
    });
    const late = list.filter((s) => istAt(s.expectedDelivery!, 24).getTime() <= now.getTime());
    for (const s of late) {
      const days = Math.max(1, Math.floor((now.getTime() - s.expectedDelivery!.getTime()) / DAY));
      await this.raise(brandId, now, {
        shipmentId: s.id,
        type: 'DELAYED',
        severity: days >= 3 ? 'CRITICAL' : 'WARNING',
        title: `${days} day${days > 1 ? 's' : ''} past the delivery date`,
        message: `${s.courier.name} · ${s.awb} · promised ${date(s.expectedDelivery!)} · ${s.order.city}`,
        action: 'Get a new delivery date from the courier',
        dueAt: new Date(now.getTime() + 24 * HOUR),
      });
    }
    await this.settle(brandId, 'DELAYED', late.map((s) => s.id), now, (f) => this.shipmentOutcome(f.shipmentId!, 'TRANSIT'));
    return late.length;
  }

  /** A return started more than 10 days ago and still not back at our warehouse. */
  private async returnStuck(brandId: string, now: Date) {
    const list = await this.prisma.shipment.findMany({
      where: { brandId, status: 'RTO_INITIATED', events: { some: { status: 'RTO_INITIATED', occurredAt: { lt: new Date(now.getTime() - 10 * DAY) } } } },
      include: { order: true, courier: true, events: { where: { status: 'RTO_INITIATED' }, orderBy: { occurredAt: 'asc' }, take: 1 } },
    });
    for (const s of list) {
      const days = Math.floor((now.getTime() - s.events[0].occurredAt.getTime()) / DAY);
      await this.raise(brandId, now, {
        shipmentId: s.id,
        type: 'RETURN_STUCK',
        severity: 'CRITICAL',
        title: `Return not back after ${days} days`,
        message: `${s.courier.name} · ${s.awb} · ${fmtInr(Number(s.order.orderValue))} of stock out of reach`,
        action: 'Ask the courier where the parcel is',
        dueAt: new Date(now.getTime() + 24 * HOUR),
      });
    }
    await this.settle(brandId, 'RETURN_STUCK', list.map((s) => s.id), now, async () => 'Return received at warehouse');
    return list.length;
  }

  /** Three or more failed attempts: call the customer before it goes back. */
  private async attempts(brandId: string, now: Date) {
    const list = await this.prisma.shipment.findMany({
      where: { brandId, status: { in: ['NDR', 'OUT_FOR_DELIVERY', 'IN_TRANSIT'] } },
      include: { order: true, courier: true, events: { where: { status: 'NDR' } } },
    });
    const many = list.filter((s) => s.events.length >= 3);
    for (const s of many) {
      await this.raise(brandId, now, {
        shipmentId: s.id,
        type: 'ATTEMPTS_3',
        severity: 'CRITICAL',
        title: `${s.events.length} failed delivery attempts`,
        message: `${s.courier.name} · ${s.awb} · ${s.order.customerName}, ${s.order.city} · last: ${s.events.at(-1)?.remark ?? ''}`,
        action: 'Call the customer, then fix the address or date',
        dueAt: new Date(now.getTime() + 4 * HOUR),
        role: 'SUPPORT',
      });
    }
    await this.settle(brandId, 'ATTEMPTS_3', many.map((s) => s.id), now, (f) => this.shipmentOutcome(f.shipmentId!, 'DELIVERY'));
    return many.length;
  }

  private async shipmentOutcome(id: string, group: 'DELIVERY' | 'TRANSIT') {
    const s = await this.prisma.shipment.findUnique({ where: { id } });
    if (s?.status === 'DELIVERED') return 'Delivered';
    if (group === 'TRANSIT') return 'Moving again';
    return s?.status?.startsWith('RTO') ? 'Returned to seller' : 'Attempt recorded';
  }

  /**
   * Opens the issue, or keeps the open one current. A problem someone closed by
   * hand stays closed; one closed by the rules opens again if it comes back.
   */
  private async raise(brandId: string, now: Date, r: Raise): Promise<{ id: string; created: boolean } | null> {
    const target = { shipmentId: r.shipmentId ?? null, pickupId: r.pickupId ?? null, orderId: r.orderId ?? null };
    const open = await this.prisma.redFlag.findFirst({ where: { brandId, type: r.type, resolvedAt: null, ...target } });
    if (open) {
      if (open.title !== r.title || open.message !== r.message || open.severity !== r.severity) {
        await this.prisma.redFlag.update({ where: { id: open.id }, data: { title: r.title, message: r.message, severity: r.severity } });
      }
      return { id: open.id, created: false };
    }
    // One parcel, one issue room: if the parcel already has an open issue, this deadline is
    // added to it (and makes it urgent) rather than opening a second room and a second chase.
    if (r.shipmentId) {
      const other = await this.prisma.redFlag.findFirst({
        where: { brandId, shipmentId: r.shipmentId, resolvedAt: null, type: { notIn: [r.type, 'WEIGHT_DISPUTE'] } },
        include: { events: { select: { body: true } } },
      });
      if (other) {
        const note = `Also: ${WATCHDOG[r.type]?.label ?? r.title}`;
        if (!other.events.some((e) => e.body.startsWith(note))) {
          await this.prisma.issueEvent.create({
            data: { flagId: other.id, kind: 'SYSTEM', actorName: 'EcomNext', actorParty: 'SYSTEM', body: `${note} (${r.title.toLowerCase()}).`, createdAt: now },
          });
          if (r.severity === 'CRITICAL' && other.severity !== 'CRITICAL') await this.prisma.redFlag.update({ where: { id: other.id }, data: { severity: 'CRITICAL' } });
        }
        return null;
      }
    }
    const earlier = await this.prisma.redFlag.findFirst({ where: { brandId, type: r.type, ...target }, orderBy: { createdAt: 'desc' } });
    if (earlier?.resolvedAt && earlier.actedAt && earlier.actedAt.getTime() === earlier.resolvedAt.getTime()) return null;
    const owner = await this.brands.ownerFor(r.role ?? 'OPS');
    const data = { title: r.title, message: r.message, action: r.action, severity: r.severity, dueAt: r.dueAt, ownerId: owner?.id };
    if (earlier) {
      // Comes back: reopened, and the issue engine gives it to the right side again.
      await this.prisma.redFlag.update({
        where: { id: earlier.id },
        data: { ...data, resolvedAt: null, outcome: null, waitingOn: null, waitingSince: null, reminderCount: 0, lastReminderAt: null, escalationLevel: 0, escalatedAt: null },
      });
      return { id: earlier.id, created: false };
    }
    const f = await this.prisma.redFlag.create({ data: { ...data, brandId, type: r.type, ...target, createdAt: now } });
    return { id: f.id, created: true };
  }

  /** Closes this rule's issues whose order or parcel has moved on, with what actually happened. */
  private async settle(
    brandId: string,
    type: string,
    stillLate: string[],
    now: Date,
    outcome: (f: { shipmentId: string | null; pickupId: string | null; orderId: string | null }) => Promise<string>,
  ) {
    const key = type === 'NOT_BOOKED' ? 'orderId' : ['NOT_PACKED', 'PARCELS_WAITING'].includes(type) ? 'pickupId' : 'shipmentId';
    const open = await this.prisma.redFlag.findMany({ where: { brandId, type, resolvedAt: null, raisedById: null } });
    for (const f of open) {
      if (f[key] && stillLate.includes(f[key])) continue;
      const result = await outcome(f);
      await this.prisma.redFlag.update({ where: { id: f.id }, data: { resolvedAt: now, outcome: result, waitingOn: null } });
      await this.prisma.issueEvent.create({
        data: { flagId: f.id, kind: 'RESOLVED', actorName: 'EcomNext', actorParty: 'SYSTEM', body: `Closed by itself: ${result}.`, createdAt: now },
      });
    }
  }
}
