import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service.js';
import { BrandService } from '../common/brand.service.js';
import { hoursLabel, istAt, istDayStart, slotLabel } from '../common/ist.js';
import { DEMO_COURIERS } from '../couriers/demo/profiles.js';
import { IssuesService } from '../issues/issues.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 3600_000;

export const ConfirmSchema = z.object({
  executiveName: z.string().trim().min(2, "Enter the executive's name").max(60),
  executivePhone: z.string().regex(/^[6-9]\d{9}$/, '10-digit mobile number'),
});

export const PROBLEMS = {
  CLOSED: 'Warehouse was closed',
  NOT_READY: 'Parcels were not ready',
  ADDRESS: 'Could not find the address',
  NO_EXECUTIVE: 'No executive available for this slot',
  OTHER: 'Other problem',
} as const;

export const ProblemSchema = z.object({
  reason: z.enum(Object.keys(PROBLEMS) as [keyof typeof PROBLEMS, ...(keyof typeof PROBLEMS)[]]),
  note: z.string().trim().max(500).optional(),
  dataUrl: z.string().max(5_000_000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export type Partner = { id: string; name: string; courierCode: string };

const courierName = (code: string) => DEMO_COURIERS.find((c) => c.code === code)?.name ?? code;

/**
 * The partner app for courier staff. Everything they owe us is done here, on
 * the record: confirm a pickup with the executive's name, report a problem
 * with a photo, answer an issue with a name and a time. Nothing on WhatsApp.
 */
@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly issues: IssuesService,
    private readonly alerts: AlertsService,
  ) {}

  private async contactOf(p: Partner) {
    const brandId = await this.brands.currentBrandId();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    return this.prisma.courierContact.findFirst({ where: { brandId, courierCode: p.courierCode, phone: user.phone, active: true } });
  }

  async home(p: Partner, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const contact = await this.contactOf(p);
    const flags = await this.prisma.redFlag.findMany({
      where: {
        brandId,
        resolvedAt: null,
        OR: [{ shipment: { courierCode: p.courierCode } }, { pickup: { courierCode: p.courierCode } }, { courierCode: p.courierCode }],
      },
      include: { shipment: { include: { order: true } }, pickup: { include: { warehouse: true } }, order: true },
    });
    const issues = flags
      .map((f) => ({
        id: f.id,
        title: f.title,
        message: f.message,
        about: f.shipment ? `#${f.shipment.order.orderNumber} · AWB ${f.shipment.awb} · ${f.shipment.order.city}` : f.pickup ? `${f.pickup.warehouse.name} pickup · ${slotLabel(f.pickup.slotStart)}` : 'Your account with us',
        yourTurn: f.waitingOn === 'COURIER',
        assignedToYou: !!contact && f.courierContactId === contact.id,
        waitedMinutes: f.waitingSince ? Math.max(0, Math.round((now.getTime() - f.waitingSince.getTime()) / 60000)) : 0,
        reminders: f.waitingOn === 'COURIER' ? f.reminderCount : 0,
        promiseAt: f.promiseAt,
        promisesBroken: f.promisesBroken,
      }))
      .sort((a, b) => Number(b.yourTurn) - Number(a.yourTurn) || Number(b.assignedToYou) - Number(a.assignedToYou) || b.waitedMinutes - a.waitedMinutes);

    const pickups = await this.prisma.pickup.findMany({
      where: { brandId, courierCode: p.courierCode, slotStart: { gte: istDayStart(now), lt: istAt(now, 24, 2) }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
      include: { warehouse: true, shipments: { where: { status: { not: 'CANCELLED' } }, select: { id: true, packedAt: true } } },
      orderBy: { slotStart: 'asc' },
    });
    return {
      me: { name: p.name, role: contact?.role ?? null },
      courier: { code: p.courierCode, name: courierName(p.courierCode) },
      counts: { yourTurn: issues.filter((i) => i.yourTurn).length, toConfirm: pickups.filter((x) => x.status === 'SCHEDULED' && x.shipments.length).length },
      issues,
      pickups: pickups
        .filter((x) => x.shipments.length)
        .map((x) => ({
          id: x.id,
          warehouse: x.warehouse.name,
          address: `${x.warehouse.address}, ${x.warehouse.city} ${x.warehouse.pincode}`,
          contact: `${x.warehouse.contactName} · ${x.warehouse.contactPhone}`,
          hours: hoursLabel(x.warehouse),
          slotStart: x.slotStart,
          slot: slotLabel(x.slotStart),
          status: x.status,
          parcels: x.shipments.length,
          packed: x.shipments.filter((s) => s.packedAt).length,
          executive: x.executiveName ? `${x.executiveName}${x.executivePhone ? ` · ${x.executivePhone}` : ''}` : null,
          canConfirm: x.slotEnd > now,
        })),
    };
  }

  private async ownPickup(p: Partner, id: string) {
    const brandId = await this.brands.currentBrandId();
    const pickup = await this.prisma.pickup.findFirst({ where: { id, brandId, courierCode: p.courierCode }, include: { warehouse: true } });
    if (!pickup) throw new NotFoundException('Pickup not found');
    return pickup;
  }

  /** The courier names the executive coming: the pickup is confirmed and the vendor knows who to expect. */
  async confirm(p: Partner, id: string, input: z.infer<typeof ConfirmSchema>, now = new Date()) {
    const pickup = await this.ownPickup(p, id);
    if (!['SCHEDULED', 'CONFIRMED'].includes(pickup.status) || pickup.slotEnd <= now) throw new BadRequestException('This pickup can no longer be confirmed');
    await this.prisma.$transaction([
      this.prisma.pickup.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: pickup.confirmedAt ?? now, executiveName: input.executiveName, executivePhone: input.executivePhone } }),
      this.prisma.shipment.updateMany({ where: { pickupId: id, status: 'BOOKED' }, data: { status: 'PICKUP_SCHEDULED' } }),
      this.prisma.auditLog.create({
        data: { brandId: pickup.brandId, actorId: p.id, action: 'PICKUP_CONFIRMED', entityType: 'Pickup', entityId: id, after: { executive: input.executiveName, phone: input.executivePhone }, createdAt: now },
      }),
    ]);
    await this.alerts.notify({
      brandId: pickup.brandId,
      phone: pickup.warehouse.contactPhone,
      name: pickup.warehouse.name,
      kind: 'PICKUP_CONFIRMED',
      title: `${courierName(p.courierCode)} pickup confirmed · ${slotLabel(pickup.slotStart)}`,
      body: `${input.executiveName} (${input.executivePhone}) will collect your parcels ${slotLabel(pickup.slotStart)}.`,
      link: '/v',
      dedupeKey: `confirmed:${id}:${input.executivePhone}`,
      now,
    });
    return this.home(p, now);
  }

  /**
   * "Warehouse closed", "not ready": reported in the app with a photo, so it is
   * checked against the vendor's declared hours and the vendor answers in the
   * same room. A claim without a photo is still logged, marked as such.
   */
  async problem(p: Partner, id: string, input: z.infer<typeof ProblemSchema>, now = new Date()) {
    const pickup = await this.ownPickup(p, id);
    const contact = await this.contactOf(p);
    const owner = await this.brands.ownerFor('OPS');
    const label = PROBLEMS[input.reason];
    const vendorTurn = input.reason === 'CLOSED' || input.reason === 'NOT_READY';
    const open = await this.prisma.redFlag.findFirst({ where: { brandId: pickup.brandId, type: 'PICKUP_CLAIM', pickupId: id, resolvedAt: null } });
    const flag =
      open ??
      (await this.prisma.redFlag.create({
        data: {
          brandId: pickup.brandId,
          pickupId: id,
          type: 'PICKUP_CLAIM',
          severity: 'CRITICAL',
          title: `${courierName(p.courierCode)}: ${label.toLowerCase()} at ${pickup.warehouse.name}`,
          message: `${slotLabel(pickup.slotStart)} pickup${input.note ? ` · "${input.note}"` : ''}`,
          action: vendorTurn ? 'Vendor to confirm, then a new slot' : 'Switch courier or give a new slot',
          ownerId: owner?.id,
          raisedById: p.id,
          waitingOn: vendorTurn ? 'VENDOR' : 'OURS',
          waitingSince: now,
          courierContactId: contact?.id ?? null,
          dueAt: new Date(now.getTime() + 2 * HOUR),
          createdAt: now,
        },
      }));
    await this.issues.partnerEvent(flag.id, {
      kind: 'PARTNER_REPLY',
      actorId: p.id,
      actorName: `${p.name} (${courierName(p.courierCode)})`,
      actorParty: 'COURIER',
      body: `${label}${input.note ? `: ${input.note}` : ''}${input.dataUrl ? '' : ' (no photo)'}`,
      at: now,
    });
    if (input.dataUrl) {
      await this.issues.addPhoto(flag.id, input.dataUrl, { lat: input.lat, lng: input.lng }, { id: p.id, name: p.name, party: 'COURIER', company: courierName(p.courierCode) }, now);
    }
    if (!open) {
      if (input.reason === 'CLOSED' || input.reason === 'NOT_READY') await this.issues.hoursCheck(flag.id, id, now);
      await this.issues.announce(flag.id, now);
    }
    return { issueId: flag.id };
  }
}
