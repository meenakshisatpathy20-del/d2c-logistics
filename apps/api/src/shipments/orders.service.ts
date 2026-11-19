import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { BrandService } from '../common/brand.service.js';
import { riskLevel, rtoRisk } from '../common/rto-risk.js';
import { slotLabel } from '../common/ist.js';
import { CouriersService } from '../couriers/couriers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { laneFor } from './lanes.js';

export const ORDER_TABS = ['NEW', 'READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO', 'ATTENTION', 'CANCELLED', 'ALL'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const OrdersQuerySchema = z.object({
  tab: z.enum(ORDER_TABS).default('ALL'),
  q: z.string().trim().max(60).optional(),
  brand: z.string().trim().max(60).optional(),
  courier: z.string().trim().max(20).optional(),
  payment: z.enum(['COD', 'PREPAID']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;

export const EditOrderSchema = z
  .object({
    customerName: z.string().trim().min(2).max(80),
    customerPhone: z.string().regex(/^[6-9]\d{9}$/, 'Mobile must be 10 digits starting 6–9'),
    addressLine: z.string().trim().min(8, 'Full delivery address is required').max(200),
    city: z.string().trim().max(60),
    state: z.string().trim().max(60),
    pincode: z.string().regex(/^[1-9]\d{5}$/, 'Pin code must be 6 digits'),
    weightGrams: z.number().int().positive().max(50_000),
  })
  .partial();
export type EditOrder = z.infer<typeof EditOrderSchema>;

export const CancelSchema = z.object({
  scope: z.enum(['shipment', 'order']),
  reason: z.string().trim().min(3, 'Give a reason').max(200),
});

const LIVE = { status: { not: 'CANCELLED' as const } };
const PRE_PICKUP = ['BOOKED', 'PICKUP_SCHEDULED'];
const openFlag = { redFlags: { some: { resolvedAt: null } } };

/** Which orders sit in a tab. Every tab reads from orders, so one list serves them all. */
function tabWhere(tab: OrderTab): Prisma.OrderWhereInput {
  const ship = (statuses: string[]): Prisma.OrderWhereInput => ({
    status: { not: 'CANCELLED' },
    shipments: { some: { status: { in: statuses as never } } },
  });
  switch (tab) {
    case 'NEW':
      return { status: { not: 'CANCELLED' }, shipments: { none: LIVE } };
    case 'READY':
      return ship(PRE_PICKUP);
    case 'IN_TRANSIT':
      return ship(['PICKED_UP', 'IN_TRANSIT']);
    case 'OUT_FOR_DELIVERY':
      return ship(['OUT_FOR_DELIVERY']);
    case 'DELIVERED':
      return ship(['DELIVERED']);
    case 'RTO':
      return ship(['RTO_INITIATED', 'RTO_DELIVERED']);
    case 'ATTENTION':
      return {
        status: { not: 'CANCELLED' },
        shipments: { some: { ...LIVE, OR: [{ status: 'NDR' }, openFlag, { pickup: openFlag }] } },
      };
    case 'CANCELLED':
      return { status: 'CANCELLED' };
    default:
      return {};
  }
}

const maskPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 2)}xxxxxx${p.slice(-2)}` : p);
const itemName = (items: unknown) => (Array.isArray(items) ? ((items[0] as { name?: string })?.name ?? 'Order items') : 'Order items');

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly couriers: CouriersService,
  ) {}

  /** The Orders screen: one page of a tab, with search, filters and every tab's count. */
  async list(query: OrdersQuery) {
    const brandId = await this.brands.currentBrandId();
    const q = query.q?.replace(/^#/, '');
    const filters: Prisma.OrderWhereInput[] = [{ brandId }];
    if (q) {
      filters.push({
        OR: [
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { customerPhone: { contains: q } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { shipments: { some: { awb: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    if (query.brand) filters.push({ productBrand: query.brand });
    if (query.payment) filters.push({ paymentMode: query.payment });
    if (query.courier) filters.push({ shipments: { some: { ...LIVE, courierCode: query.courier } } });

    const where = { AND: [...filters, tabWhere(query.tab)] };
    const [total, rows, counts] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          pickupWarehouse: true,
          shipments: {
            where: LIVE,
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              courier: true,
              pickup: { include: { redFlags: { where: { resolvedAt: null }, include: { owner: true } } } },
              redFlags: { where: { resolvedAt: null }, include: { owner: true }, orderBy: { createdAt: 'desc' } },
              events: { orderBy: { occurredAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      Promise.all(ORDER_TABS.map((t) => this.prisma.order.count({ where: { AND: [...filters, tabWhere(t)] } }))),
    ]);

    return {
      tab: query.tab,
      page: query.page,
      size: query.size,
      total,
      pages: Math.max(1, Math.ceil(total / query.size)),
      counts: Object.fromEntries(ORDER_TABS.map((t, i) => [t, counts[i]])) as Record<OrderTab, number>,
      rows: rows.map((o) => {
        const s = o.shipments[0];
        const flag = s?.redFlags[0] ?? s?.pickup?.redFlags[0] ?? null;
        const lane =
          o.status === 'CANCELLED'
            ? { lane: 'CANCELLED', note: 'Cancelled', tone: 'grey' }
            : s
              ? laneFor({
                  status: s.status,
                  pickupStatus: s.pickup?.status,
                  openFlag: flag,
                  slotLabel: s.pickup ? slotLabel(s.pickup.slotStart) : null,
                  lastScanPlace: s.events[0]?.location,
                  courier: s.courier.name,
                })
              : laneFor({ status: 'UNBOOKED' });
        return {
          id: o.id,
          shipmentId: s?.id ?? null,
          orderNumber: o.orderNumber,
          createdAt: o.createdAt,
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
          vendor: o.pickupWarehouse.name,
          courier: s?.courier.name ?? null,
          awb: s?.awb ?? null,
          isDemo: s?.isDemo ?? false,
          status: o.status === 'CANCELLED' ? 'CANCELLED' : (s?.status ?? 'UNBOOKED'),
          ...lane,
          flag: flag ? { id: flag.id, title: flag.title, action: flag.action, owner: flag.owner?.name ?? null } : null,
          rtoRisk: riskLevel(o.rtoRisk ?? this.estimateRisk(o)),
          canCancel: o.status !== 'CANCELLED' && (!s || PRE_PICKUP.includes(s.status)),
          labelUrl: s ? `/api/shipments/${s.id}/label.pdf` : null,
        };
      }),
    };
  }

  private estimateRisk(o: { paymentMode: 'PREPAID' | 'COD'; orderValue: unknown; codAdvance: unknown; pincode: string; addressLine: string }) {
    return rtoRisk({ ...o, orderValue: Number(o.orderValue), codAdvance: Number(o.codAdvance), pastReturns: 0 }).score;
  }

  /** Everything about one order: shipments, full tracking, problems, pickup and history. */
  async detail(id: string) {
    const brandId = await this.brands.currentBrandId();
    const o = await this.prisma.order.findFirst({
      where: { brandId, OR: [{ id }, { orderNumber: id }] },
      include: {
        pickupWarehouse: true,
        rtoWarehouse: true,
        messages: { orderBy: { createdAt: 'asc' } },
        // Problems about the order itself, before it has a shipment (e.g. not booked in 24 hours).
        redFlags: { where: { resolvedAt: null }, include: { owner: true }, orderBy: { createdAt: 'desc' } },
        shipments: {
          orderBy: { createdAt: 'desc' },
          include: {
            courier: true,
            pickup: true,
            events: { orderBy: { occurredAt: 'desc' } },
            redFlags: { include: { owner: true }, orderBy: { createdAt: 'desc' } },
            photos: { select: { id: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    const ids = [o.id, ...o.shipments.map((s) => s.id)];
    const history = await this.prisma.auditLog.findMany({ where: { brandId, entityId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 50 });
    const actors = await this.prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorId).filter((x): x is string => !!x) } } });
    const pastReturns = await this.prisma.shipment.count({
      where: { brandId, orderId: { not: o.id }, status: { in: ['RTO_INITIATED', 'RTO_DELIVERED'] }, order: { customerPhone: o.customerPhone } },
    });
    const risk = rtoRisk({ ...o, orderValue: Number(o.orderValue), codAdvance: Number(o.codAdvance), pastReturns });
    const live = o.shipments.find((s) => s.status !== 'CANCELLED') ?? null;

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      createdAt: o.createdAt,
      brand: o.productBrand ?? 'D2C',
      items: o.items,
      customer: { name: o.customerName, phone: o.customerPhone, address: o.addressLine, city: o.city, state: o.state, pincode: o.pincode },
      payment: {
        mode: o.paymentMode,
        orderValue: Number(o.orderValue),
        collect: Number(o.codAmount),
        advance: Number(o.codAdvance),
        advanceStatus: o.advanceStatus,
      },
      parcel: { weightGrams: o.weightGrams, lengthCm: o.lengthCm, breadthCm: o.breadthCm, heightCm: o.heightCm },
      pickupFrom: { code: o.pickupWarehouse.code, name: o.pickupWarehouse.name, city: o.pickupWarehouse.city, pincode: o.pickupWarehouse.pincode },
      returnTo: o.rtoWarehouse ? { name: o.rtoWarehouse.name, city: o.rtoWarehouse.city } : null,
      rtoRisk: { score: risk.score, level: riskLevel(risk.score), reasons: risk.reasons },
      canEdit: o.status !== 'CANCELLED' && (!live || PRE_PICKUP.includes(live.status)),
      canEditPincode: o.status !== 'CANCELLED' && !live,
      canCancel: o.status !== 'CANCELLED' && (!live || PRE_PICKUP.includes(live.status)),
      shipments: o.shipments.map((s) => ({
        id: s.id,
        courier: s.courier.name,
        courierCode: s.courierCode,
        awb: s.awb,
        isDemo: s.isDemo,
        status: s.status,
        charged: Number(s.chargedAmount),
        chargedWeightG: s.chargedWeightG,
        courierWeightG: s.courierWeightG,
        expectedDelivery: s.expectedDelivery,
        pickup: s.pickup
          ? { id: s.pickup.id, slot: slotLabel(s.pickup.slotStart), date: s.pickup.slotStart, status: s.pickup.status, executive: s.pickup.executiveName, manifestUrl: `/api/pickups/${s.pickup.id}/manifest.pdf` }
          : null,
        labelUrl: `/api/shipments/${s.id}/label.pdf`,
        packedAt: s.packedAt,
        photos: s.photos.map((p) => ({ id: p.id, url: `/api/photos/${p.id}`, at: p.createdAt })),
        events: s.events.map((e) => ({ status: e.status, location: e.location, remark: e.remark, at: e.occurredAt })),
        flags: s.redFlags.map((f) => ({
          id: f.id,
          type: f.type,
          title: f.title,
          message: f.message,
          owner: f.owner?.name ?? null,
          action: f.action,
          note: f.note,
          escalationLevel: f.escalationLevel,
          open: !f.resolvedAt,
          createdAt: f.createdAt,
        })),
      })),
      orderFlags: o.redFlags.map((f) => ({
        id: f.id,
        type: f.type,
        title: f.title,
        message: f.message,
        owner: f.owner?.name ?? null,
        action: f.action,
        note: f.note,
        escalationLevel: f.escalationLevel,
        open: true,
        createdAt: f.createdAt,
      })),
      messages: o.messages.map((m) => ({ from: m.senderType, name: m.senderName, body: m.body, channel: m.channel, at: m.createdAt })),
      history: history.map((h) => ({
        action: h.action,
        by: actors.find((a) => a.id === h.actorId)?.name ?? 'System',
        at: h.createdAt,
        after: h.after,
      })),
    };
  }

  /**
   * Cancel before pickup. scope 'shipment' cancels the courier booking and puts
   * the order back in New (to book again); scope 'order' cancels the order too.
   */
  async cancel(id: string, scope: 'shipment' | 'order', reason: string, actorId?: string, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const o = await this.prisma.order.findFirst({
      where: { id, brandId },
      include: { shipments: { where: LIVE, include: { courier: true } } },
    });
    if (!o) throw new NotFoundException('Order not found');
    if (o.status === 'CANCELLED') throw new BadRequestException('This order is already cancelled');
    const s = o.shipments[0];
    if (s && !PRE_PICKUP.includes(s.status)) {
      throw new BadRequestException('The courier already has this parcel. Ask for a return (RTO) instead.');
    }
    if (!s && scope === 'shipment') throw new BadRequestException('This order has no shipment to cancel');

    let courierCancelled = false;
    if (s) {
      courierCancelled = (await this.couriers.get(s.courierCode).cancel(s.awb).catch(() => ({ cancelled: false }))).cancelled;
    }
    await this.prisma.$transaction(async (tx) => {
      if (s) {
        await tx.shipment.update({
          where: { id: s.id },
          data: {
            status: 'CANCELLED',
            events: { create: { status: 'CANCELLED', location: null, remark: `Cancelled: ${reason}`, occurredAt: now, receivedAt: now } },
          },
        });
        if (s.pickupId) await tx.pickup.update({ where: { id: s.pickupId }, data: { parcelCount: { decrement: 1 } } });
        await tx.redFlag.updateMany({ where: { shipmentId: s.id, resolvedAt: null }, data: { resolvedAt: now, note: 'Shipment cancelled' } });
      }
      await tx.order.update({
        where: { id: o.id },
        data:
          scope === 'order'
            ? { status: 'CANCELLED', ...(Number(o.codAdvance) > 0 ? { advanceStatus: 'REFUNDED' } : {}) }
            : { status: 'NEW' },
      });
      await tx.auditLog.create({
        data: {
          brandId,
          actorId,
          action: scope === 'order' ? 'ORDER_CANCELLED' : 'SHIPMENT_CANCELLED',
          entityType: 'Order',
          entityId: o.id,
          before: s ? { awb: s.awb, courier: s.courierCode } : undefined,
          after: { reason, courierBookingCancelled: courierCancelled },
          createdAt: now,
        },
      });
    });
    return this.detail(o.id);
  }

  /** Fix customer details before pickup. Pin code and weight change the rate, so only before booking. */
  async edit(id: string, patch: EditOrder, actorId?: string, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const o = await this.prisma.order.findFirst({ where: { id, brandId }, include: { shipments: { where: LIVE } } });
    if (!o) throw new NotFoundException('Order not found');
    const s = o.shipments[0];
    if (o.status === 'CANCELLED') throw new BadRequestException('A cancelled order cannot be changed');
    if (s && !PRE_PICKUP.includes(s.status)) throw new BadRequestException('The courier already has this parcel; details can no longer change');
    if (s && (patch.pincode !== undefined || patch.weightGrams !== undefined)) {
      throw new BadRequestException('Pin code and weight set the courier rate. Cancel the shipment and book again to change them.');
    }
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (o as Record<string, unknown>)[k]]));
    await this.prisma.order.update({ where: { id: o.id }, data: patch });
    await this.prisma.auditLog.create({
      data: { brandId, actorId, action: 'ORDER_EDITED', entityType: 'Order', entityId: o.id, before: before as Prisma.InputJsonValue, after: patch, createdAt: now },
    });
    return this.detail(o.id);
  }

  /** Money in one place: COD on the way, COD delivered (remittance due), advances and freight. */
  async payments(now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const since = new Date(now.getTime() - 30 * 24 * 3600_000);
    const sum = (where: Prisma.OrderWhereInput) =>
      this.prisma.order.aggregate({ where: { brandId, ...where }, _sum: { codAmount: true }, _count: true });
    const advance = (st: string) => this.prisma.order.aggregate({ where: { brandId, advanceStatus: st }, _sum: { codAdvance: true }, _count: true });
    const [onTheWay, delivered, held, adjusted, refunded, forfeited, freight] = await Promise.all([
      sum({ paymentMode: 'COD', shipments: { some: { status: { in: ['BOOKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'NDR'] } } } }),
      sum({ paymentMode: 'COD', shipments: { some: { status: 'DELIVERED' } } }),
      advance('PAID'),
      advance('ADJUSTED'),
      advance('REFUNDED'),
      advance('FORFEITED'),
      this.prisma.shipment.aggregate({ where: { brandId, status: { not: 'CANCELLED' }, createdAt: { gte: since } }, _sum: { chargedAmount: true }, _count: true }),
    ]);
    const adv = (a: { _sum: { codAdvance: unknown }; _count: number }) => ({ amount: Number(a._sum.codAdvance ?? 0), orders: a._count });
    return {
      codOnTheWay: { amount: Number(onTheWay._sum.codAmount ?? 0), orders: onTheWay._count },
      codDelivered: { amount: Number(delivered._sum.codAmount ?? 0), orders: delivered._count },
      advances: { held: adv(held), adjusted: adv(adjusted), refunded: adv(refunded), forfeited: adv(forfeited) },
      freight30d: { amount: Number(freight._sum.chargedAmount ?? 0), shipments: freight._count },
    };
  }

  /**
   * Weight check before booking: the usual declared weight of this product in
   * our past orders. A booking far from it is probably a typing mistake, which
   * becomes a weight dispute later.
   */
  async weightHint(product: string) {
    const brandId = await this.brands.currentBrandId();
    const name = product.trim();
    if (name.length < 3) return { product: name, samples: 0, typicalGrams: null };
    const rows = await this.prisma.order.findMany({
      where: { brandId, status: { not: 'CANCELLED' }, items: { path: ['0', 'name'], string_contains: name } },
      select: { weightGrams: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const same = rows.filter((r) => Array.isArray(r.items) && String((r.items[0] as { name?: string })?.name ?? '').toLowerCase() === name.toLowerCase());
    const weights = same.map((r) => r.weightGrams).sort((a, b) => a - b);
    const typical = weights.length >= 2 ? weights[Math.floor(weights.length / 2)] : null;
    return { product: name, samples: weights.length, typicalGrams: typical };
  }

  /** Names for the brand and courier filters. */
  async filters() {
    const brandId = await this.brands.currentBrandId();
    const [brands, couriers] = await Promise.all([
      this.prisma.order.findMany({ where: { brandId, productBrand: { not: null } }, distinct: ['productBrand'], select: { productBrand: true } }),
      this.prisma.courier.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { brands: brands.map((b) => b.productBrand!).sort(), couriers };
  }
}
