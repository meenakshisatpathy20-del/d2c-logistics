import { Injectable } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { CONFIRM_LEAD_HOURS, istAt, istDayStart, istHour, slotLabel } from '../common/ist.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShipmentsService } from '../shipments/shipments.service.js';

const HOUR = 60 * 60 * 1000;

function dueLabel(dueAt: Date | null, now: Date): string {
  if (!dueAt) return 'Open';
  const mins = Math.round((dueAt.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return `Overdue ${mins > -60 ? `${-mins} m` : `${Math.round(-mins / 60)} h`}`;
  return `Due in ${mins < 60 ? `${mins} m` : `${Math.round(mins / 60)} h`}`;
}

@Injectable()
export class TodayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly shipments: ShipmentsService,
  ) {}

  async today(now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const dayStart = istDayStart(now);
    const dayEnd = istAt(now, 24);

    const [flags, pickups, active, deliveredToday, codOpen, brands] = await Promise.all([
      this.prisma.redFlag.findMany({
        where: { brandId, resolvedAt: null },
        include: { owner: true, shipment: { include: { order: true } } },
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.pickup.findMany({
        where: { brandId, slotStart: { gte: dayStart, lt: dayEnd } },
        include: { warehouse: true, courier: true },
        orderBy: { slotStart: 'asc' },
      }),
      this.prisma.shipment.groupBy({ by: ['status'], where: { brandId }, _count: true }),
      this.prisma.shipment.count({ where: { brandId, status: 'DELIVERED', lastScanAt: { gte: dayStart } } }),
      this.prisma.order.aggregate({
        where: { brandId, paymentMode: 'COD', shipments: { some: { status: { notIn: ['DELIVERED', 'RTO_DELIVERED', 'CANCELLED'] } } } },
        _sum: { codAmount: true },
        _count: true,
      }),
      this.shipments.brandsToday(now),
    ]);
    const advances = await this.prisma.order.aggregate({
      where: { brandId, advanceStatus: 'PAID' },
      _sum: { codAdvance: true },
      _count: true,
    });

    const count = (...st: string[]) => active.filter((a) => st.includes(a.status)).reduce((n, a) => n + a._count, 0);

    const needsYou = flags.map((f) => ({
      id: f.id,
      severity: f.severity === 'CRITICAL' ? 'critical' : 'warning',
      title: f.title,
      detail: f.shipment ? `#${f.shipment.order.orderNumber} · ${f.shipment.order.productBrand ?? ''} · ${f.message}`.replace(' ·  · ', ' · ') : f.message,
      owner: f.owner?.name ?? 'Unassigned',
      due: dueLabel(f.dueAt, now),
      overdue: !!f.dueAt && f.dueAt < now,
      action: f.action ?? 'Open',
    }));

    const rows = new Map<string, { vendor: string; area: string; slots: unknown[] }>();
    for (const p of pickups) {
      const row = rows.get(p.warehouseId) ?? { vendor: p.warehouse.name, area: p.warehouse.cluster?.split(' - ').at(-1) ?? p.warehouse.city, slots: [] };
      const confirmWindow = p.slotStart.getTime() - now.getTime() <= CONFIRM_LEAD_HOURS * HOUR;
      const state =
        p.status === 'PICKED_UP'
          ? { status: 'done', label: 'Picked up' }
          : p.status === 'CONFIRMED'
            ? { status: 'confirmed', label: `Confirmed · ${p.executiveName ?? 'executive'}` }
            : p.status === 'MISSED'
              ? { status: 'missed', label: 'Missed · moved' }
              : p.status === 'REASSIGNED'
                ? { status: 'missed', label: 'Not confirmed · moved' }
                : confirmWindow
                  ? { status: 'waiting', label: 'Awaiting confirmation' }
                  : { status: 'scheduled', label: 'Scheduled' };
      row.slots.push({
        id: p.id,
        start: istHour(p.slotStart),
        end: istHour(p.slotEnd),
        slot: slotLabel(p.slotStart),
        courier: p.courier.name,
        parcels: p.parcelCount,
        ...state,
        manifestUrl: `/api/pickups/${p.id}/manifest.pdf`,
      });
      rows.set(p.warehouseId, row);
    }
    const counted = pickups.filter((p) => p.status !== 'REASSIGNED' && p.status !== 'MISSED');

    return {
      now: now.toISOString(),
      nowHour: istHour(now),
      summary: {
        pickupsDue: counted.length,
        pickupsDone: counted.filter((p) => p.status === 'PICKED_UP').length,
        needsYou: needsYou.length,
      },
      needsYou,
      pickups: [...rows.values()],
      pulse: {
        moving: count('PICKED_UP', 'IN_TRANSIT'),
        outToday: count('OUT_FOR_DELIVERY'),
        deliveredToday,
        codToCollect: Number(codOpen._sum.codAmount ?? 0),
        codOrders: codOpen._count,
        advancesHeld: Number(advances._sum.codAdvance ?? 0),
        advanceOrders: advances._count,
      },
      brands,
    };
  }
}
