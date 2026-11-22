import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertsService, fullLink } from '../alerts/alerts.service.js';
import { BrandService } from '../common/brand.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_PHOTOS_PER_PARCEL = 6;
const IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

type Actor = { id: string; name: string; role: string; warehouseId: string | null };

/**
 * The vendor's phone view: today's pickups at their own warehouse, "packed and
 * ready", packing photos and postpone. A vendor never sees another warehouse.
 */
@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly pickups: PickupsService,
    private readonly alerts: AlertsService,
  ) {}

  private warehouseOf(actor: Actor) {
    if (!actor.warehouseId) throw new BadRequestException('This login is not linked to a warehouse');
    return actor.warehouseId;
  }

  async today(actor: Actor, now = new Date()) {
    const warehouseId = this.warehouseOf(actor);
    const w = await this.prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
    const days = await this.pickups.upcoming({ warehouseId }, now);
    return { warehouse: { code: w.code, name: w.name, city: w.city, contactName: w.contactName }, days };
  }

  /** A shipment this vendor may touch (its own warehouse, not cancelled). */
  private async ownShipment(actor: Actor, shipmentId: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, status: { not: 'CANCELLED' }, order: { pickupWarehouseId: this.warehouseOf(actor) } },
      include: { _count: { select: { photos: true } } },
    });
    if (!s) throw new NotFoundException('Parcel not found');
    return s;
  }

  async markPacked(actor: Actor, shipmentIds: string[], packed = true, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    for (const id of shipmentIds) {
      const s = await this.ownShipment(actor, id);
      if (!['BOOKED', 'PICKUP_SCHEDULED'].includes(s.status)) continue; // already handed over
      await this.prisma.shipment.update({ where: { id }, data: { packedAt: packed ? now : null } });
      await this.prisma.auditLog.create({
        data: { brandId, actorId: actor.id, action: packed ? 'PACKED_AND_READY' : 'PACKED_UNDONE', entityType: 'Shipment', entityId: id, createdAt: now },
      });
    }
    return { ok: true };
  }

  async addPhoto(actor: Actor, shipmentId: string, dataUrl: string, now = new Date()) {
    const s = await this.ownShipment(actor, shipmentId);
    if (s._count.photos >= MAX_PHOTOS_PER_PARCEL) throw new BadRequestException(`Up to ${MAX_PHOTOS_PER_PARCEL} photos per parcel`);
    const m = IMAGE.exec(dataUrl ?? '');
    if (!m) throw new BadRequestException('Send a JPEG, PNG or WebP photo');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > MAX_PHOTO_BYTES) throw new BadRequestException('Photo is larger than 3 MB');
    const photo = await this.prisma.packingPhoto.create({
      data: { shipmentId, mime: m[1], data, sizeBytes: data.length, uploadedById: actor.id, createdAt: now },
    });
    return { id: photo.id };
  }

  /** A photo for our team, or for the vendor who took it. */
  async photo(actor: Actor, photoId: string) {
    const brandId = await this.brands.currentBrandId();
    const p = await this.prisma.packingPhoto.findFirst({
      where: { id: photoId, shipment: { brandId, ...(actor.role === 'VENDOR' ? { order: { pickupWarehouseId: this.warehouseOf(actor) } } : {}) } },
    });
    if (!p) throw new NotFoundException('Photo not found');
    return p;
  }

  async postpone(actor: Actor, pickupId: string, reason: string, now = new Date()) {
    const res = await this.pickups.postpone(pickupId, reason, { id: actor.id, name: actor.name, warehouseId: actor.role === 'VENDOR' ? this.warehouseOf(actor) : null }, now);
    const brandId = await this.brands.currentBrandId();
    // Tell the vendor (when our team moved it) and the owner of pickups (when the vendor did).
    if (actor.role !== 'VENDOR') {
      await this.alerts.notify({
        brandId,
        phone: res.warehouse.contactPhone,
        name: res.warehouse.name,
        kind: 'PICKUP_POSTPONED',
        title: `Pickup moved · ${res.warehouse.name}`,
        body: `Your ${res.slot} ${res.courier} pickup moved to ${res.movedTo}. Reason: ${reason}`,
        link: '/v',
        dedupeKey: `postpone:${pickupId}:vendor`,
        now,
      });
    } else {
      const owner = await this.brands.ownerFor('OPS');
      if (owner) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
        await this.alerts.send({
          brandId,
          userId: user.id,
          channel: 'APP',
          to: user.name,
          kind: 'PICKUP_POSTPONED',
          title: `${res.warehouse.name} postponed a pickup`,
          body: `${res.slot} ${res.courier} moved to ${res.movedTo}. Reason: ${reason}`,
          link: '/pickups',
          dedupeKey: `postpone:${pickupId}:ops`,
          now,
        });
      }
    }
    return res;
  }
}
