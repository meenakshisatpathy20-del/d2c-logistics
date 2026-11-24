import { Injectable, Logger } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { settleAdvance } from '../common/cod-advance.js';
import { CouriersService } from '../couriers/couriers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 60 * 60 * 1000;
export const NO_SCAN_HOURS = 48;
/** Picked up but no hub scan within a day: the parcel may still be with the executive. */
export const NOT_AT_HUB_HOURS = 24;
/** No scan for a week: treat as lost and start the claim. */
export const LIKELY_LOST_DAYS = 7;
const ACTIVE = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'NDR', 'RTO_INITIATED'] as const;
type Status = (typeof ACTIVE)[number] | 'DELIVERED' | 'RTO_DELIVERED';

/**
 * Pulls new scans from each shipment's courier, moves the shipment along, and
 * keeps red flags in step: raised with an owner when something goes wrong,
 * resolved by itself when the parcel moves again.
 */
@Injectable()
export class TrackingService {
  private readonly log = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly couriers: CouriersService,
    private readonly brands: BrandService,
  ) {}

  async sync(now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const shipments = await this.prisma.shipment.findMany({
      where: { brandId, status: { in: [...ACTIVE] } },
      include: {
        courier: true,
        order: { include: { pickupWarehouse: true } },
        events: { orderBy: { occurredAt: 'asc' } },
      },
    });
    let scans = 0;

    for (const s of shipments) {
      const pickedUp = s.events.find((e) => e.status === 'PICKED_UP');
      if (!pickedUp) continue;
      const last = s.events.at(-1)!;
      // The demo journey puts pickup 20 hours after booking; anchor it to the real pickup time.
      const anchor = new Date(pickedUp.occurredAt.getTime() - 20 * HOUR);
      const journey = await this.couriers.get(s.courierCode).track(s.awb, anchor, s.etaDays, now);
      const fresh = journey.filter(
        (e) => !['BOOKED', 'PICKUP_SCHEDULED', 'PICKED_UP'].includes(e.status) && e.occurredAt > last.occurredAt,
      );
      const place = (where: string) =>
        where === 'Origin hub'
          ? `${s.order.pickupWarehouse.city} hub`
          : where === 'Destination hub'
            ? `${s.order.city || s.order.pincode} hub`
            : where;

      let status = s.status as Status;
      let lastScanAt = s.lastScanAt ?? last.occurredAt;
      if (fresh.length) {
        await this.prisma.trackingEvent.createMany({
          data: fresh.map((e) => ({
            shipmentId: s.id,
            status: e.status,
            location: place(e.location),
            remark: e.remark,
            occurredAt: e.occurredAt,
            receivedAt: now,
          })),
        });
        status = fresh.at(-1)!.status as Status;
        lastScanAt = fresh.at(-1)!.occurredAt;
        scans += fresh.length;
        await this.prisma.shipment.update({ where: { id: s.id }, data: { status, lastScanAt } });
        const advanceStatus = Number(s.order.codAdvance) > 0 ? settleAdvance(status) : null;
        await this.prisma.order.update({
          where: { id: s.orderId },
          data: {
            ...(advanceStatus ? { advanceStatus } : {}),
            status:
              status === 'DELIVERED'
                ? 'DELIVERED'
                : status === 'NDR'
                  ? 'NEEDS_ATTENTION'
                  : status.startsWith('RTO')
                    ? 'RTO'
                    : 'IN_TRANSIT',
          },
        });
        // A new scan clears a "no scan" flag.
        await this.resolve(s.id, ['NO_SCAN_48H', 'NOT_AT_HUB'], now, status === 'DELIVERED' ? 'Delivered' : 'Moving again');
      }

      if (status === 'NDR') {
        await this.raise(brandId, s.id, 'NDR', 'WARNING', 'SUPPORT', {
          title: 'Delivery failed',
          message: `${s.courier.name} · ${fresh.at(-1)?.remark ?? 'customer not available'} · ${s.order.city}`,
          action: 'Confirm reattempt',
          dueAt: new Date(lastScanAt.getTime() + 24 * HOUR),
          now,
        });
      } else {
        await this.resolve(s.id, ['NDR'], now, status === 'DELIVERED' ? 'Delivered' : status.startsWith('RTO') ? 'Returned to seller' : 'Reattempt under way');
      }
      if (status === 'RTO_INITIATED') {
        await this.raise(brandId, s.id, 'RTO', 'CRITICAL', 'SUPPORT', {
          title: 'Returning to seller',
          message: `${s.courier.name} · customer refused · ${s.order.city}`,
          action: 'Call customer',
          dueAt: new Date(now.getTime() + 4 * HOUR),
          now,
        });
      }
      if (status === 'RTO_DELIVERED' || status === 'DELIVERED') {
        await this.resolve(s.id, ['RTO', 'NDR', 'NO_SCAN_48H', 'NOT_AT_HUB'], now, status === 'DELIVERED' ? 'Delivered' : 'Returned to seller');
      }

      const silentHours = (now.getTime() - lastScanAt.getTime()) / HOUR;
      // Picked up but never reached the hub: a day is enough to ask. In transit: two days.
      const silent =
        status === 'PICKED_UP' && silentHours >= NOT_AT_HUB_HOURS
          ? { type: 'NOT_AT_HUB', what: (h: number) => `Not at the hub ${h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hours`} after pickup` }
          : status === 'IN_TRANSIT' && silentHours >= NO_SCAN_HOURS
            ? { type: 'NO_SCAN_48H', what: (h: number) => `No scan for ${h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hours`}` }
            : null;
      if (silent) {
        const lastPlace = place(fresh.at(-1)?.location ?? last.location ?? '');
        const lost = silentHours >= LIKELY_LOST_DAYS * 24;
        await this.raise(brandId, s.id, silent.type, 'CRITICAL', 'OPS', {
          title: lost ? `No scan for ${Math.floor(silentHours / 24)} days: likely lost` : silent.what(Math.floor(silentHours)),
          message: `${s.courier.name} · last seen at ${lastPlace} · ${s.order.city}`,
          action: lost ? 'Raise a lost claim' : 'Send RCA to courier',
          dueAt: new Date(now.getTime() + 4 * HOUR),
          now,
        });
      }
    }

    if (scans) this.log.log({ scans });
    return { checked: shipments.length, scans };
  }

  private async raise(
    brandId: string,
    shipmentId: string,
    type: string,
    severity: 'WARNING' | 'CRITICAL',
    role: 'OPS' | 'SUPPORT',
    f: { title: string; message: string; action: string; dueAt: Date; now: Date },
  ) {
    const open = await this.prisma.redFlag.findFirst({ where: { type, shipmentId, resolvedAt: null } });
    if (open) {
      // Keep the hours count current on an open "no scan" flag.
      if (open.title !== f.title) {
        const nowLost = f.title.includes('likely lost') && !open.title.includes('likely lost');
        await this.prisma.redFlag.update({ where: { id: open.id }, data: { title: f.title, ...(nowLost ? { action: f.action, severity: 'CRITICAL' } : {}) } });
        if (nowLost) {
          await this.prisma.issueEvent.create({
            data: { flagId: open.id, kind: 'SYSTEM', actorName: 'EcomNext', actorParty: 'SYSTEM', body: `${LIKELY_LOST_DAYS} days without a scan: treat it as lost. Ask the courier to declare it lost and raise the claim.`, createdAt: f.now },
          });
        }
      }
      return;
    }
    const owner = await this.brands.ownerFor(role);
    const data = { title: f.title, message: f.message, action: f.action, dueAt: f.dueAt, ownerId: owner?.id };
    // One flag per problem per shipment: a problem that comes back reopens its flag.
    const earlier = await this.prisma.redFlag.findFirst({ where: { type, shipmentId } });
    // Someone closed this problem by hand: it stays closed for the same status.
    if (earlier?.resolvedAt && earlier.actedAt && earlier.actedAt.getTime() === earlier.resolvedAt.getTime()) return;
    if (earlier) {
      await this.prisma.redFlag.update({ where: { id: earlier.id }, data: { ...data, resolvedAt: null } });
    } else {
      await this.prisma.redFlag.create({ data: { ...data, brandId, shipmentId, type, severity, createdAt: f.now } });
    }
  }

  /** Closes a flag on the real outcome the courier's scans show. */
  private async resolve(shipmentId: string, types: string[], now: Date, outcome: string) {
    await this.prisma.redFlag.updateMany({ where: { shipmentId, type: { in: types }, resolvedAt: null }, data: { resolvedAt: now, outcome, waitingOn: null } });
  }
}
