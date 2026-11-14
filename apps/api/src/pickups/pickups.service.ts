import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { CONFIRM_LEAD_HOURS, slotAfter, slotLabel } from '../common/ist.js';
import { CouriersService } from '../couriers/couriers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
      const pct = this.couriers.pickupOnTimePct(p.courierCode);
      if (roll(`${p.id}:confirm`) < pct) {
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
      const pct = this.couriers.pickupOnTimePct(p.courierCode);
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
            where: { brandId, resolvedAt: null, type: { in: ['PICKUP_MISSED', 'PICKUP_UNCONFIRMED'] }, pickup: { warehouseId: p.warehouseId } },
            data: { resolvedAt: at },
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
      include: { warehouse: true, courier: true, shipments: { where: { status: { not: 'CANCELLED' } }, include: { order: true } } },
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
        const best = this.couriers
          .compareRates(req)
          .filter((q) => q.serviceable && q.courierCode !== from.courierCode)
          .sort((a, b) => b.pickupOnTimePct - a.pickupOnTimePct || a.total - b.total)[0];
        if (!best) continue;
        const booked = await this.couriers
          .get(best.courierCode)
          .book({ ...req, orderNumber: s.order.orderNumber, idempotencyKey: `${s.idempotencyKey}:${best.courierCode}` }, now);
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
      const pickup = await this.prisma.pickup.upsert({
        where: { warehouseId_courierCode_slotStart: { warehouseId: from.warehouseId, courierCode, slotStart: slot.slotStart } },
        update: { parcelCount: { increment: 1 }, missCount },
        create: {
          brandId: from.brandId,
          warehouseId: from.warehouseId,
          courierCode,
          slotStart: slot.slotStart,
          slotEnd: slot.slotEnd,
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
                  ? `Moved from ${from.courier.name} to ${pickup.courier.name}, pickup ${slotLabel(slot.slotStart)}`
                  : `Pickup moved to ${slotLabel(slot.slotStart)}`,
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
