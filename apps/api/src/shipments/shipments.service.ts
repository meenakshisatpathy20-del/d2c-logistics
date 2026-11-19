import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { closedReason, hoursLabel, istDayStart, nextBookableSlot, slotFits, slotLabel, slotWindow } from '../common/ist.js';
import { BookingError, CouriersService, RELIABLE_PICKUP_PCT } from '../couriers/couriers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BookOrder, BulkBook } from './booking.schema.js';
import { initials, laneFor } from './lanes.js';
import { rtoRisk } from '../common/rto-risk.js';
import { openSlot } from '../common/open-slot.js';


@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly couriers: CouriersService,
    private readonly brands: BrandService,
  ) {}

  /**
   * Books one order: picks the courier, gets the AWB, and saves order,
   * shipment, pickup and the first tracking event together.
   * The same idempotency key always returns the same shipment.
   */
  async book(input: BookOrder, now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();

    const repeat = await this.prisma.shipment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (repeat) return this.summary(repeat.id);

    const existing = await this.prisma.order.findUnique({
      where: { brandId_orderNumber: { brandId, orderNumber: input.orderNumber } },
      include: { shipments: { where: { status: { not: 'CANCELLED' } } } },
    });
    if (existing?.shipments.length) {
      throw new ConflictException(`Order #${input.orderNumber} is already booked (AWB ${existing.shipments[0].awb})`);
    }

    const warehouse = await this.prisma.warehouse.findUnique({
      where: { brandId_code: { brandId, code: input.warehouseCode } },
    });
    if (!warehouse) throw new BadRequestException(`Unknown pickup warehouse ${input.warehouseCode}`);
    const rto = input.rtoWarehouseCode
      ? await this.prisma.warehouse.findUnique({ where: { brandId_code: { brandId, code: input.rtoWarehouseCode } } })
      : null;
    if (input.rtoWarehouseCode && !rto) throw new BadRequestException(`Unknown RTO warehouse ${input.rtoWarehouseCode}`);

    // COD with an advance: the courier collects only the balance.
    const cod = input.paymentMode === 'COD';
    const advance = cod ? (input.codAdvance ?? 0) : 0;
    if (advance >= input.orderValue) throw new BadRequestException('The advance must be less than the order value');
    const collect = cod ? Math.round((input.orderValue - advance) * 100) / 100 : 0;

    const rateReq = {
      originPincode: warehouse.pincode,
      destinationPincode: input.pincode,
      weightGrams: input.weightGrams,
      lengthCm: input.lengthCm,
      breadthCm: input.breadthCm,
      heightCm: input.heightCm,
      paymentMode: input.paymentMode,
      codAmount: collect,
    };
    const quotes = this.couriers.compareRates(rateReq);
    const quote = input.courierCode
      ? quotes.find((q) => q.courierCode === input.courierCode)
      : quotes.find((q) => q.recommended);
    if (!quote) throw new BadRequestException(`Unknown courier ${input.courierCode}`);
    if (quote.switchedOff) throw new BadRequestException(`${quote.courierName} is switched off by our team right now. Pick another courier.`);
    if (!quote.serviceable) throw new BadRequestException(`${quote.courierName} does not deliver to pin code ${input.pincode}`);

    const requested = input.slot ? slotWindow(now, input.slot.day, input.slot.startHour) : nextBookableSlot(now);
    if (input.slot) {
      const closed = closedReason(requested.slotStart);
      if (closed) throw new BadRequestException(`Couriers do not pick up on that day (${closed}). Pick another slot.`);
      if (requested.slotStart.getTime() - now.getTime() < 2 * 60 * 60 * 1000) {
        throw new BadRequestException('That pickup slot is too close for the courier to confirm. Pick a later slot.');
      }
      if (!slotFits(requested.slotStart, warehouse)) {
        throw new BadRequestException(`${warehouse.name} is closed at ${slotLabel(requested.slotStart)} that day (open ${hoursLabel(warehouse)}). Pick another slot.`);
      }
    }

    const pastReturns = await this.prisma.shipment.count({
      where: { brandId, status: { in: ['RTO_INITIATED', 'RTO_DELIVERED'] }, order: { customerPhone: input.customerPhone } },
    });
    const risk = rtoRisk({ paymentMode: input.paymentMode, orderValue: input.orderValue, codAdvance: advance, pincode: input.pincode, addressLine: input.addressLine, pastReturns });

    // A courier whose connection fails is not a dead end: the next best courier is tried at
    // once, and the failure becomes an issue naming the courier who must fix it.
    // A courier picked by hand is not swapped silently; the error names the next best one.
    const candidates = input.courierCode
      ? [quote]
      : [quote, ...quotes.filter((q) => q.serviceable && q !== quote).sort((a, b) => Number(b.pickupOnTimePct >= RELIABLE_PICKUP_PCT) - Number(a.pickupOnTimePct >= RELIABLE_PICKUP_PCT) || a.total - b.total)];
    const failures: Array<{ courierCode: string; courierName: string; reason: string }> = [];
    let chosen: { quote: (typeof quotes)[number]; booked: Awaited<ReturnType<CouriersService['bookWith']>>; slotStart: Date; slotEnd: Date } | null = null;
    for (const q of candidates) {
      // A slot whose pickup already happened (or was missed), or outside the warehouse's hours, is closed to new parcels.
      const open = await openSlot(this.prisma, warehouse.id, q.courierCode, requested, !!input.slot);
      if (!open) {
        if (input.courierCode || candidates.length === 1) {
          throw new BadRequestException(
            input.slot ? `The ${slotLabel(requested.slotStart)} pickup is already closed. Pick a later slot.` : 'No open pickup slot found for this courier. Contact operations.',
          );
        }
        continue;
      }
      if (open.slotStart.getTime() - now.getTime() < 2 * 60 * 60 * 1000 || closedReason(open.slotStart)) continue;
      try {
        const booked = await this.couriers.bookWith(q.courierCode, { ...rateReq, orderNumber: input.orderNumber, idempotencyKey: input.idempotencyKey }, now);
        chosen = { quote: q, booked, ...open };
        break;
      } catch (e) {
        if (!(e instanceof BookingError)) throw e;
        failures.push({ courierCode: e.courierCode, courierName: e.courierName, reason: e.reason });
        await this.bookingFailed(brandId, e, input.orderNumber, now);
      }
    }
    if (!chosen) {
      if (failures.length) {
        const next = input.courierCode ? quotes.find((q) => q.serviceable && q.courierCode !== input.courierCode) : null;
        throw new BadRequestException(
          `Booking with ${failures.map((f) => `${f.courierName} failed (${f.reason})`).join('; ')}. An issue was raised with the courier.` +
            (next ? ` Book with ${next.courierName} (₹${next.total}) instead.` : ''),
        );
      }
      throw new BadRequestException('No open pickup slot found for this order. Contact operations.');
    }
    const { booked, slotStart, slotEnd } = chosen;
    const picked = chosen.quote;
    const adapter = this.couriers.get(picked.courierCode);
    const owner = await this.brands.ownerFor('OPS');

    const shipment = await this.prisma.$transaction(async (tx) => {
      const orderData = {
        productBrand: input.productBrand,
        status: 'READY_TO_SHIP' as const,
        pickupWarehouseId: warehouse.id,
        rtoWarehouseId: rto?.id ?? warehouse.id,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        addressLine: input.addressLine,
        city: input.city ?? '',
        state: input.state ?? '',
        pincode: input.pincode,
        paymentMode: input.paymentMode,
        orderValue: input.orderValue,
        codAmount: collect,
        codAdvance: advance,
        advanceStatus: advance > 0 ? 'PAID' : null,
        weightGrams: input.weightGrams,
        lengthCm: input.lengthCm,
        breadthCm: input.breadthCm,
        heightCm: input.heightCm,
        items: [{ name: input.productName ?? 'Order items', qty: 1, price: input.orderValue }],
        rtoRisk: risk.score,
      };
      // An order that exists but was never booked is booked with the details entered now.
      const order = await tx.order.upsert({
        where: { brandId_orderNumber: { brandId, orderNumber: input.orderNumber } },
        update: orderData,
        create: { ...orderData, brandId, orderNumber: input.orderNumber, source: 'MANUAL', createdAt: now },
      });
      const pickup = await tx.pickup.upsert({
        where: { warehouseId_courierCode_slotStart: { warehouseId: warehouse.id, courierCode: picked.courierCode, slotStart } },
        update: { parcelCount: { increment: 1 } },
        create: { brandId, warehouseId: warehouse.id, courierCode: picked.courierCode, slotStart, slotEnd, parcelCount: 1, createdAt: now },
      });
      const created = await tx.shipment.create({
        data: {
          brandId,
          orderId: order.id,
          courierCode: picked.courierCode,
          awb: booked.awb,
          isDemo: adapter.mode === 'DEMO',
          status: 'BOOKED',
          chargedAmount: booked.chargedAmount,
          chargedWeightG: booked.chargedWeightGrams,
          etaDays: picked.etaDays,
          expectedDelivery: booked.expectedDelivery,
          pickupId: pickup.id,
          lastScanAt: now,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          events: { create: { status: 'BOOKED', location: warehouse.city, remark: `Booked with ${picked.courierName}`, occurredAt: now } },
        },
      });
      await tx.auditLog.create({
        data: {
          brandId,
          actorId: owner?.id,
          action: 'SHIPMENT_BOOKED',
          entityType: 'Shipment',
          entityId: created.id,
          after: { awb: booked.awb, courier: picked.courierCode, failedOver: failures, slotStart: slotStart.toISOString(), charged: booked.chargedAmount },
          createdAt: now,
        },
      });
      return created;
    });

    return { ...(await this.summary(shipment.id)), failedOver: failures };
  }

  /** Books many orders; each row succeeds or fails on its own. */
  async bulk(input: BulkBook, now: Date = new Date()) {
    const results: Array<{ orderNumber: string; ok: boolean; awb?: string; courier?: string; error?: string }> = [];
    for (const row of input.rows) {
      try {
        const s = await this.book({ ...row, idempotencyKey: `${input.batchKey}:${row.orderNumber}` }, now);
        results.push({ orderNumber: row.orderNumber, ok: true, awb: s.awb, courier: s.courierName });
      } catch (e) {
        results.push({ orderNumber: row.orderNumber, ok: false, error: (e as Error).message });
      }
    }
    return { booked: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  /**
   * One open issue per failing courier connection: a new failure is added to it
   * rather than opening another. The issue engine gives it to the courier's
   * account manager and reminds them until it is fixed.
   */
  private async bookingFailed(brandId: string, e: BookingError, orderNumber: string, now: Date) {
    const open = await this.prisma.redFlag.findFirst({ where: { brandId, type: 'BOOKING_FAILED', courierCode: e.courierCode, resolvedAt: null } });
    if (open) {
      await this.prisma.issueEvent.create({
        data: { flagId: open.id, kind: 'SYSTEM', actorName: 'D2C Logistics', actorParty: 'SYSTEM', body: `Failed again for order #${orderNumber}: ${e.reason}`, createdAt: now },
      });
      return;
    }
    const owner = await this.brands.ownerFor('OPS');
    await this.prisma.redFlag.create({
      data: {
        brandId,
        courierCode: e.courierCode,
        type: 'BOOKING_FAILED',
        severity: 'CRITICAL',
        title: `${e.courierName} bookings failing`,
        message: `${e.reason} · first seen on order #${orderNumber}. Orders are going to the next courier meanwhile.`,
        action: 'Get the courier to fix the connection',
        dueAt: new Date(now.getTime() + 4 * 3600_000),
        ownerId: owner?.id,
        createdAt: now,
      },
    });
  }

  async summary(id: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { id },
      include: { courier: true, pickup: true, order: true },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    return {
      id: s.id,
      orderNumber: s.order.orderNumber,
      courierCode: s.courierCode,
      courierName: s.courier.name,
      mode: s.isDemo ? 'DEMO' : 'LIVE',
      awb: s.awb,
      chargedAmount: Number(s.chargedAmount),
      chargedWeightGrams: s.chargedWeightG,
      expectedDelivery: s.expectedDelivery,
      pickupSlot: s.pickup ? { start: s.pickup.slotStart, end: s.pickup.slotEnd, label: slotLabel(s.pickup.slotStart) } : null,
      labelUrl: `/api/shipments/${s.id}/label.pdf`,
    };
  }

  /** Every shipment, plus orders not booked yet, as journey-board cards. */
  async board() {
    const brandId = await this.brands.currentBrandId();
    const [shipments, unbooked] = await Promise.all([
      this.prisma.shipment.findMany({
        // Finished parcels only from the last 7 days, so the board stays fast; the Orders list has the rest.
        where: {
          brandId,
          OR: [
            { status: { notIn: ['CANCELLED', 'DELIVERED', 'RTO_DELIVERED'] } },
            { status: { in: ['DELIVERED', 'RTO_DELIVERED'] }, lastScanAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } },
          ],
        },
        include: {
          order: { include: { pickupWarehouse: true } },
          courier: true,
          pickup: true,
          redFlags: { where: { resolvedAt: null }, include: { owner: true }, orderBy: { createdAt: 'desc' } },
          events: { orderBy: { occurredAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.findMany({
        where: { brandId, status: { not: 'CANCELLED' }, shipments: { none: { status: { not: 'CANCELLED' } } } },
        include: { pickupWarehouse: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const pickupFlags = await this.prisma.redFlag.findMany({
      where: { brandId, resolvedAt: null, pickupId: { not: null } },
      include: { owner: true },
    });

    const cards = shipments.map((s) => {
      const flag = s.redFlags[0] ?? pickupFlags.find((f) => f.pickupId === s.pickupId) ?? null;
      const lane = laneFor({
        status: s.status,
        pickupStatus: s.pickup?.status,
        openFlag: flag,
        slotLabel: s.pickup ? slotLabel(s.pickup.slotStart) : null,
        lastScanPlace: s.events[0]?.location,
        courier: s.courier.name,
      });
      const owner = flag?.owner?.name ?? 'Ops Executive';
      return {
        id: s.id,
        orderNumber: s.order.orderNumber,
        brand: s.order.productBrand ?? 'D2C',
        product: itemName(s.order.items),
        customer: s.order.customerName,
        phone: maskPhone(s.order.customerPhone),
        city: s.order.city,
        pincode: s.order.pincode,
        payment: s.order.paymentMode === 'COD' ? 'COD' : 'Prepaid',
        amount: Number(s.order.orderValue),
        collect: Number(s.order.codAmount),
        advance: Number(s.order.codAdvance),
        advanceStatus: s.order.advanceStatus,
        vendor: s.order.pickupWarehouse.name,
        courier: s.courier.name,
        awb: s.awb,
        isDemo: s.isDemo,
        status: s.status,
        ...lane,
        owner: initials(owner),
        ownerName: owner,
        labelUrl: `/api/shipments/${s.id}/label.pdf`,
        createdAt: s.createdAt,
      };
    });
    const pending = unbooked.map((o) => ({
      id: `order-${o.id}`,
      orderNumber: o.orderNumber,
      brand: o.productBrand ?? 'D2C',
      product: itemName(o.items),
      customer: o.customerName,
      phone: maskPhone(o.customerPhone),
      city: o.city,
      pincode: o.pincode,
      payment: o.paymentMode === 'COD' ? 'COD' : 'Prepaid',
      amount: Number(o.orderValue),
      collect: Number(o.codAmount),
      advance: Number(o.codAdvance),
      advanceStatus: o.advanceStatus,
      vendor: o.pickupWarehouse.name,
      courier: null,
      awb: null,
      isDemo: false,
      status: 'UNBOOKED',
      ...laneFor({ status: 'UNBOOKED' }),
      owner: 'OE',
      ownerName: 'Ops Executive',
      labelUrl: null,
      createdAt: o.createdAt,
    }));
    return [...cards, ...pending];
  }

  async warehouses() {
    const brandId = await this.brands.currentBrandId();
    const rows = await this.prisma.warehouse.findMany({
      where: { brandId },
      select: { code: true, name: true, city: true, pincode: true, cluster: true, opensAt: true, closesAt: true, saturdayClosesAt: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((w) => ({ ...w, hours: hoursLabel(w) }));
  }

  /** Orders created today (IST) vs. shipped, by our brand. */
  async brandsToday(now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const orders = await this.prisma.order.findMany({
      where: { brandId, createdAt: { gte: istDayStart(now) } },
      include: { shipments: { select: { status: true } } },
    });
    const byBrand = new Map<string, { orders: number; shipped: number }>();
    for (const o of orders) {
      const key = o.productBrand ?? 'D2C';
      const row = byBrand.get(key) ?? { orders: 0, shipped: 0 };
      row.orders++;
      if (o.shipments.some((s) => !['BOOKED', 'PICKUP_SCHEDULED', 'CANCELLED'].includes(s.status))) row.shipped++;
      byBrand.set(key, row);
    }
    return [...byBrand.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.orders - a.orders);
  }
}

function itemName(items: unknown): string {
  const first = Array.isArray(items) ? (items[0] as { name?: string } | undefined) : undefined;
  return first?.name ?? 'Order items';
}

function maskPhone(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 2)}xxxxxx${phone.slice(-2)}` : phone;
}
