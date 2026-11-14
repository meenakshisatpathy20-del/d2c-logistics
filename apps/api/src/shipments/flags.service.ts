import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { BrandService } from '../common/brand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const FlagActionSchema = z.object({
  kind: z.enum(['act', 'resolve', 'reassign']),
  note: z.string().trim().max(300).optional(),
  ownerId: z.string().trim().optional(),
});
export type FlagAction = z.infer<typeof FlagActionSchema>;

/**
 * The buttons on "Needs you":
 *  act      - do the suggested fix (reattempt, RCA to courier, call customer...).
 *             The flag stays open, marked "action taken", until the parcel moves.
 *  resolve  - close it by hand with a note.
 *  reassign - give it to another team member.
 */
@Injectable()
export class FlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
  ) {}

  async act(id: string, input: FlagAction, actor: { id: string; name: string }, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const f = await this.prisma.redFlag.findFirst({ where: { id, brandId }, include: { shipment: { include: { courier: true } } } });
    if (!f) throw new NotFoundException('Problem not found');
    if (f.resolvedAt) throw new BadRequestException('This problem is already closed');

    if (input.kind === 'reassign') {
      const owner = await this.prisma.user.findFirst({ where: { id: input.ownerId, brandId, active: true } });
      if (!owner) throw new BadRequestException('Pick a team member');
      await this.prisma.redFlag.update({ where: { id }, data: { ownerId: owner.id } });
      await this.audit(brandId, actor.id, 'FLAG_REASSIGNED', id, { to: owner.name }, now);
      return { ok: true, message: `Assigned to ${owner.name}` };
    }

    if (input.kind === 'resolve') {
      const note = input.note || 'Resolved';
      await this.prisma.redFlag.update({ where: { id }, data: { resolvedAt: now, actedAt: now, note: `${note} · ${actor.name}` } });
      await this.audit(brandId, actor.id, 'FLAG_RESOLVED', id, { note }, now);
      return { ok: true, message: 'Closed' };
    }

    // act: record the suggested fix and tell the courier through the shipment's timeline.
    const what = f.action ?? 'Action taken';
    const note = `${what}${input.note ? `: ${input.note}` : ''} · ${actor.name}`;
    await this.prisma.redFlag.update({ where: { id }, data: { actedAt: now, note } });
    if (f.shipmentId && f.shipment) {
      await this.prisma.trackingEvent.create({
        data: {
          shipmentId: f.shipmentId,
          status: f.shipment.status === 'CANCELLED' ? 'BOOKED' : f.shipment.status,
          location: null,
          remark: `${what} sent to ${f.shipment.courier.name}${input.note ? ` (${input.note})` : ''}`,
          occurredAt: now,
          receivedAt: now,
        },
      });
    }
    await this.audit(brandId, actor.id, 'FLAG_ACTION', id, { action: what, note: input.note }, now);
    return { ok: true, message: `${what} · done` };
  }

  async team() {
    const brandId = await this.brands.currentBrandId();
    return this.prisma.user.findMany({
      where: { brandId, active: true },
      select: { id: true, name: true, role: true, email: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private audit(brandId: string, actorId: string, action: string, flagId: string, after: object, now: Date) {
    return this.prisma.auditLog.create({ data: { brandId, actorId, action, entityType: 'RedFlag', entityId: flagId, after, createdAt: now } });
  }
}
