import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { CONFIRM_LEAD_HOURS, istAt, istDateKey, istDayStart, slotAfter, slotLabel } from '../common/ist.js';
import { CouriersService } from '../couriers/couriers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { openSlot } from '../common/open-slot.js';

const HOUR = 60 * 60 * 1000;
const EXECUTIVES = ['Ramesh K.', 'Sunil P.', 'Imran S.', 'Vikas M.', 'Arif K.', 'Deepak R.', 'Mahesh T.', 'Ravi N.'];

/** Stable 0-99 number, so a demo courier makes the same decision every run. */
function roll(text: string): number {
  return parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) % 100;
}

/**
 * Runs the pickup rules from the plan's Pickup Reliability section:
 *  1. The courier confirms each pickup 2 hours before the slot. No confirmation:
 *     the parcels move to the most reliable courier for the same slot.
 *  2. A confirmed pickup is collected during the slot, or it is missed.
 *  3. A miss raises a red flag with an owner and moves the parcels to the next
 *     slot; a second miss also moves them to the most reliable courier.
 * Demo couriers confirm and collect as often as their pickup on-time % says.
 */
@Injectable()
export class PickupsService {
  private readonly log = new Logger(PickupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly couriers: CouriersService,
    private readonly brands: BrandService,
  ) {}

  async run(now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    let confirmed = 0;
    let moved = 0;
    let collected = 0;
    let missed = 0;

    // 1. Confirmation window.
    const toConfirm = await this.prisma.pickup.findMany({
      where: { brandId, status: 'SCHEDULED', slotStart: { lte: new Date(now.getTime() + CONFIRM_LEAD_HOURS * HOUR) } },
      include: { warehouse: true, courier: true, shipments: { where: { status: { not: 'CANCELLED' } } } },
    });
    for (const p of toConfirm) {
      if (p.shipments.length === 0) {
        // Every parcel was cancelled: call off the pickup so no executive is sent.
        await this.prisma.pickup.update({ where: { id: p.id }, data: { status: 'CANCELLED' } });
        continue;
      }
      const pct = this.couriers.contractPickupPct(p.courierCode); // demo: how the simulated courier behaves
      // Live: only the courier's own confirmation in the partner app counts (PICKUP_CONFIRM=partner).
      // Demo: courier staff are simulated by their on-time rate.
      if (process.env.PICKUP_CONFIRM !== 'partner' && roll(`${p.id}:confirm`) < pct) {
        await this.prisma.pickup.update({
          where: { id: p.id },
          data: { status: 'CONFIRMED', confirmedAt: now, executiveName: EXECUTIVES[roll(p.id) % EXECUTIVES.length] },
        });
        await this.prisma.shipment.updateMany({ where: { pickupId: p.id, status: { not: 'CANCELLED' } }, data: { status: 'PICKUP_SCHEDULED' } });
        confirmed++;
      } else {
        const to = await this.moveParcels(p.id, { slotStart: p.slotStart, slotEnd: p.slotEnd }, true, now);
        await this.prisma.pickup.update({ where: { id: p.id }, data: { status: 'REASSIGNED', movedToId: to?.id } });
        await this.raise(brandId, p.id, 'PICKUP_UNCONFIRMED', 'WARNING', {
          title: `${p.courier.name} didn't confirm ${p.warehouse.name} pickup`,
          message: to ? `Moved to ${to.courierName}, same slot ${slotLabel(p.slotStart)}` : 'No other courier delivers there',
          action: 'Check with vendor',
          dueAt: p.slotStart,
          now,
        });
        moved++;
      }
    }

    // 2. Pickup during the slot: collected one hour in, or missed when the slot ends.
    const due = await this.prisma.pickup.findMany({
      where: { brandId, status: 'CONFIRMED', slotStart: { lte: new Date(now.getTime() - HOUR) } },
      include: { warehouse: true, courier: true, shipments: { where: { status: { not: 'CANCELLED' } } } },
    });
    for (const p of due) {
      const pct = this.couriers.contractPickupPct(p.courierCode); // demo: how the simulated courier behaves
      if (roll(`${p.id}:collect`) < pct) {
        const at = new Date(p.slotStart.getTime() + (30 + (roll(`${p.id}:minute`) % 75)) * 60 * 1000);
        await this.prisma.$transaction([
          this.prisma.pickup.update({ where: { id: p.id }, data: { status: 'PICKED_UP', pickedUpAt: at } }),
          this.prisma.shipment.updateMany({ where: { pickupId: p.id, status: { not: 'CANCELLED' } }, data: { status: 'PICKED_UP', lastScanAt: at } }),
          this.prisma.trackingEvent.createMany({
            data: p.shipments.map((s) => ({
              shipmentId: s.id,
              status: 'PICKED_UP' as const,
              location: p.warehouse.city,
              remark: `Picked up by ${p.executiveName ?? p.courier.name}`,
              occurredAt: at,
              receivedAt: at,
            })),
          }),
          // Any open pickup red flag for this vendor is solved once parcels leave.
          this.prisma.redFlag.updateMany({
            where: { brandId, resolvedAt: null, type: { in: ['PICKUP_MISSED', 'PICKUP_UNCONFIRMED', 'PICKUP_CLAIM', 'PICKUP_PENDING'] }, pickup: { warehouseId: p.warehouseId } },
            data: { resolvedAt: at, outcome: 'Picked up', waitingOn: null },
          }),
        ]);
        await this.checkWeights(brandId, p, now);
        collected++;
      } else if (now.getTime() >= p.slotEnd.getTime()) {
        const secondMiss = p.missCount >= 1;
        const next = slotAfter(p.slotStart);
        const to = await this.moveParcels(p.id, next, secondMiss, now, p.missCount + 1);
        await this.prisma.pickup.update({
          where: { id: p.id },
          data: { status: 'MISSED', missReason: 'Executive did not arrive', movedToId: to?.id },
        });
        await this.raise(brandId, p.id, 'PICKUP_MISSED', 'CRITICAL', {
          title: `${p.warehouse.name} pickup missed${secondMiss ? ' twice' : ''}`,
          message: `${p.courier.name} · ${slotLabel(p.slotStart)} · ${p.parcelCount} parcels`,
          action: to ? `Moved to ${to.courierName} ${slotLabel(next.slotStart)}` : 'Reschedule',
          dueAt: new Date(now.getTime() + 2 * HOUR),
          now,
        });
        missed++;
      }
    }

    if (confirmed || moved || collected || missed) this.log.log({ confirmed, moved, collected, missed });
    return { confirmed, moved, collected, missed };
  }

  /**
   * One-click postpone (by our team or the vendor): every parcel moves to the
   * next slot the courier can still confirm, with the reason logged.
   */
  async postpone(pickupId: string, reason: string, actor: { id: string; name: string; warehouseId?: string | null }, now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const p = await this.prisma.pickup.findFirst({ where: { id: pickupId, brandId }, include: { warehouse: true, courier: true } });
    if (!p) throw new NotFoundException('Pickup not found');
    if (actor.warehouseId && actor.warehouseId !== p.warehouseId) throw new NotFoundException('Pickup not found');
    if (!['SCHEDULED', 'CONFIRMED'].includes(p.status)) throw new BadRequestException('Only an upcoming pickup can be postponed');
    if (p.slotEnd <= now) throw new BadRequestException('This slot is already over');

    let next = slotAfter(p.slotStart);
    while (next.slotStart.getTime() - now.getTime() < CONFIRM_LEAD_HOURS * HOUR) next = slotAfter(next.slotStart);
    const to = await this.moveParcels(p.id, next, false, now);
    await this.prisma.pickup.update({ where: { id: p.id }, data: { status: 'POSTPONED', postponeReason: reason, movedToId: to?.id } });
    await this.prisma.auditLog.create({
      data: { brandId, actorId: actor.id || null, action: 'PICKUP_POSTPONED', entityType: 'Pickup', entityId: p.id, after: { reason, to: to?.id ?? null, by: actor.name }, createdAt: now },
    });
    // The parcels may land later than the next slot if that one is closed.
    const landed = to ? (await this.prisma.pickup.findUniqueOrThrow({ where: { id: to.id } })).slotStart : next.slotStart;
    const when = `${landed.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })}, ${slotLabel(landed)}`;
    return { ok: true, movedTo: when, pickupId: to?.id ?? null, warehouse: { name: p.warehouse.name, contactPhone: p.warehouse.contactPhone }, courier: p.courier.name, slot: slotLabel(p.slotStart) };
  }

  /**
   * From inside an issue: move every parcel of a pickup to the most reliable
   * other courier (the old booking is cancelled), at the earliest slot it can
   * still confirm.
   */
  async switchCourier(pickupId: string, reason: string, actor: { id: string; name: string }, now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const p = await this.prisma.pickup.findFirst({ where: { id: pickupId, brandId }, include: { courier: true, warehouse: true } });
    if (!p) throw new NotFoundException('Pickup not found');
    if (!['SCHEDULED', 'CONFIRMED', 'MISSED'].includes(p.status)) throw new BadRequestException('These parcels already left or moved');
    let slot = { slotStart: p.slotStart, slotEnd: p.slotEnd };
    while (slot.slotStart.getTime() - now.getTime() < CONFIRM_LEAD_HOURS * HOUR) slot = slotAfter(slot.slotStart);
    const to = await this.moveParcels(p.id, slot, true, now);
    if (!to) throw new BadRequestException('No other courier delivers these parcels');
    await this.prisma.pickup.update({ where: { id: p.id }, data: { status: 'REASSIGNED', movedToId: to.id } });
    await this.prisma.auditLog.create({
      data: { brandId, actorId: actor.id || null, action: 'PICKUP_COURIER_SWITCHED', entityType: 'Pickup', entityId: p.id, after: { reason, to: to.courierName } },
    });
    const landed = (await this.prisma.pickup.findUniqueOrThrow({ where: { id: to.id } })).slotStart;
    return { from: p.courier.name, to: to.courierName, slot: `${landed.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })}, ${slotLabel(landed)}` };
  }

  /** Every pickup from today for the next 7 days, grouped by day: the Pickups screen and the vendor view. */
  async upcoming(filter: { warehouseId?: string | null } = {}, now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const start = istDayStart(now);
    const pickups = await this.prisma.pickup.findMany({
      where: {
        brandId,
        slotStart: { gte: start, lt: istAt(now, 24, 7) },
        parcelCount: { gt: 0 },
        status: { not: 'CANCELLED' },
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
      },
      include: {
        warehouse: true,
        courier: true,
        shipments: {
          where: { status: { not: 'CANCELLED' } },
          include: { order: true, photos: { select: { id: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ slotStart: 'asc' }],
    });
    const todayKey = istDateKey(now);
    const tomorrowKey = istDateKey(istAt(now, 12, 1));
    const days = new Map<string, { day: string; pickups: unknown[] }>();
    for (const p of pickups) {
      // A pickup whose parcels all moved elsewhere has nothing left to collect.
      if (p.shipments.length === 0 && ['REASSIGNED', 'MISSED', 'POSTPONED'].includes(p.status)) continue;
      const key = istDateKey(p.slotStart);
      const label =
        key === todayKey ? 'Today' : key === tomorrowKey ? 'Tomorrow' : p.slotStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
      const group = days.get(key) ?? { day: label, pickups: [] };
      group.pickups.push({
        id: p.id,
        warehouse: { code: p.warehouse.code, name: p.warehouse.name, area: p.warehouse.cluster?.split(' - ').at(-1) ?? p.warehouse.city },
        slot: slotLabel(p.slotStart),
        slotStart: p.slotStart,
        courier: p.courier.name,
        status: p.status,
        executive: p.executiveName,
        postponeReason: p.postponeReason,
        canPostpone: ['SCHEDULED', 'CONFIRMED'].includes(p.status) && p.slotEnd > now,
        parcelCount: p.shipments.length,
        packed: p.shipments.filter((s) => s.packedAt).length,
        manifestUrl: `/api/pickups/${p.id}/manifest.pdf`,
        parcels: p.shipments.map((s) => ({
          id: s.id,
          awb: s.awb,
          orderNumber: s.order.orderNumber,
          product: Array.isArray(s.order.items) ? ((s.order.items[0] as { name?: string })?.name ?? 'Order items') : 'Order items',
          brand: s.order.productBrand ?? 'D2C',
          city: s.order.city,
          pincode: s.order.pincode,
          payment: s.order.paymentMode === 'COD' ? `COD ${Number(s.order.codAmount)}` : 'Prepaid',
          weightKg: s.chargedWeightG / 1000,
          packed: !!s.packedAt,
          photos: s.photos.map((ph) => ph.id),
        })),
      });
      days.set(key, group);
    }
    return [...days.values()];
  }

  /**
   * Moves every parcel of a pickup to a new slot. With switchCourier, parcels are
   * re-booked with the most reliable courier that delivers to each address.
   */
  private async moveParcels(
    pickupId: string,
    slot: { slotStart: Date; slotEnd: Date },
    switchCourier: boolean,
    now: Date,
    missCount = 0,
  ): Promise<{ id: string; courierName: string } | null> {
    const from = await this.prisma.pickup.findUniqueOrThrow({
      where: { id: pickupId },
      // Only parcels still waiting: one already picked up is with a courier and must never be re-booked.
      include: { warehouse: true, courier: true, shipments: { where: { status: { in: ['BOOKED', 'PICKUP_SCHEDULED'] } }, include: { order: true } } },
    });
    let target: { id: string; courierName: string } | null = null;

    for (const s of from.shipments) {
      let courierCode = from.courierCode;
      let awb = s.awb;
      let charged = Number(s.chargedAmount);
      if (switchCourier) {
        const req = {
          originPincode: from.warehouse.pincode,
          destinationPincode: s.order.pincode,
          weightGrams: s.order.weightGrams,
          lengthCm: s.order.lengthCm,
          breadthCm: s.order.breadthCm,
          heightCm: s.order.heightCm,
          paymentMode: s.order.paymentMode,
          codAmount: Number(s.order.codAmount),
        };
        const ranked = this.couriers
          .compareRates(req)
          .filter((q) => q.serviceable && q.courierCode !== from.courierCode)
          .sort((a, b) => b.pickupOnTimePct - a.pickupOnTimePct || a.total - b.total);
        // If a courier's connection fails, the next most reliable one is tried.
        let best: (typeof ranked)[number] | null = null;
        let booked: Awaited<ReturnType<CouriersService['bookWith']>> | null = null;
        for (const q of ranked) {
          try {
            booked = await this.couriers.bookWith(q.courierCode, { ...req, orderNumber: s.order.orderNumber, idempotencyKey: `${s.idempotencyKey}:${q.courierCode}` }, now);
            best = q;
            break;
          } catch {
            continue;
          }
        }
        if (!best || !booked) continue;
        // Cancel the old booking so the first courier neither comes nor bills us.
        const cancelled = await this.couriers
          .get(from.courierCode)
          .cancel(s.awb)
          .catch(() => ({ cancelled: false }));
        await this.prisma.auditLog.create({
          data: {
            brandId: from.brandId,
            action: 'COURIER_BOOKING_CANCELLED',
            entityType: 'Shipment',
            entityId: s.id,
            before: { courier: from.courierCode, awb: s.awb },
            after: { courier: best.courierCode, awb: booked.awb, oldBookingCancelled: cancelled.cancelled },
            createdAt: now,
          },
        });
        courierCode = best.courierCode;
        awb = booked.awb;
        charged = booked.chargedAmount;
      }
      // Never into a slot whose pickup already happened or was missed.
      const into = await openSlot(this.prisma, from.warehouseId, courierCode, slot);
      if (!into) continue; // nothing open: the parcel stays put and its red flag stays open
      const pickup = await this.prisma.pickup.upsert({
        where: { warehouseId_courierCode_slotStart: { warehouseId: from.warehouseId, courierCode, slotStart: into.slotStart } },
        update: { parcelCount: { increment: 1 }, missCount },
        create: {
          brandId: from.brandId,
          warehouseId: from.warehouseId,
          courierCode,
          slotStart: into.slotStart,
          slotEnd: into.slotEnd,
          parcelCount: 1,
          missCount,
          createdAt: now,
        },
        include: { courier: true },
      });
      target = { id: pickup.id, courierName: pickup.courier.name };
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: {
          pickupId: pickup.id,
          courierCode,
          awb,
          chargedAmount: charged,
          status: 'BOOKED',
          events: {
            create: {
              status: 'PICKUP_SCHEDULED',
              location: from.warehouse.city,
              remark:
                courierCode !== from.courierCode
                  ? `Moved from ${from.courier.name} to ${pickup.courier.name}, pickup ${slotLabel(into.slotStart)}`
                  : `Pickup moved to ${slotLabel(into.slotStart)}`,
              occurredAt: now,
              receivedAt: now,
            },
          },
        },
      });
    }
    return target;
  }

  /**
   * The courier weighs every parcel at pickup. When its weight is in a higher
   * slab than what we were charged, a weight dispute opens for Finance with
   * the packing details as proof. Demo couriers do this for about 1 in 12 parcels.
   */
  private async checkWeights(
    brandId: string,
    p: { id: string; courier: { name: string }; shipments: { id: string; chargedWeightG: number; awb: string }[] },
    now: Date,
  ) {
    for (const s of p.shipments) {
      if (roll(`${s.id}:weight`) >= 8) continue;
      const courierWeightG = s.chargedWeightG + 500;
      await this.prisma.shipment.update({ where: { id: s.id }, data: { courierWeightG } });
      const exists = await this.prisma.redFlag.findFirst({ where: { type: 'WEIGHT_DISPUTE', shipmentId: s.id } });
      if (exists) continue;
      const owner = await this.brands.ownerFor('FINANCE');
      await this.prisma.redFlag.create({
        data: {
          brandId,
          shipmentId: s.id,
          type: 'WEIGHT_DISPUTE',
          severity: 'WARNING',
          title: 'Weight dispute',
          message: `${p.courier.name} weighed ${courierWeightG / 1000} kg, we declared ${s.chargedWeightG / 1000} kg · AWB ${s.awb}`,
          action: 'Raise dispute with proof',
          dueAt: new Date(now.getTime() + 7 * 24 * HOUR),
          ownerId: owner?.id,
          createdAt: now,
        },
      });
    }
  }

  private async raise(
    brandId: string,
    pickupId: string,
    type: string,
    severity: 'WARNING' | 'CRITICAL',
    f: { title: string; message: string; action: string; dueAt: Date; now: Date },
  ) {
    const exists = await this.prisma.redFlag.findFirst({ where: { type, pickupId } });
    if (exists) return;
    const owner = await this.brands.ownerFor('OPS');
    await this.prisma.redFlag.create({
      data: { brandId, pickupId, type, severity, title: f.title, message: f.message, action: f.action, dueAt: f.dueAt, ownerId: owner?.id, createdAt: f.now },
    });
  }
}
