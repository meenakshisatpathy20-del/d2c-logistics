import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
 * After someone acts, the other side gets this long to show a result
 * (the parcel moves, the pickup happens). Still open after it, the
 * escalation ladder starts again: an action is not a resolution.
 */
export const FOLLOW_UP_HOURS: Record<string, number> = {
  NO_SCAN_48H: 4, // courier answers the RCA
  RTO: 4,
  PICKUP_MISSED: 2,
  PICKUP_UNCONFIRMED: 2,
  NDR: 24,
  WEIGHT_DISPUTE: 72,
};

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

  async act(id: string, input: FlagAction, actor: { id: string; name: string; role?: string }, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const f = await this.prisma.redFlag.findFirst({ where: { id, brandId }, include: { shipment: { include: { courier: true } } } });
    if (!f) throw new NotFoundException('Problem not found');
    if (f.resolvedAt) throw new BadRequestException('This problem is already closed');
    if (f.type === 'WEIGHT_DISPUTE' && actor.role && !['ADMIN', 'FINANCE', 'OPS'].includes(actor.role)) {
      throw new ForbiddenException('Weight disputes are handled by Finance or Operations');
    }

    if (input.kind === 'reassign') {
      const owner = await this.prisma.user.findFirst({ where: { id: input.ownerId, brandId, active: true } });
      if (!owner) throw new BadRequestException('Pick a team member');
      // A new owner gets a fresh deadline clock: the escalation ladder starts again.
      await this.prisma.redFlag.update({ where: { id }, data: { ownerId: owner.id, escalationLevel: 0, escalatedAt: null } });
      await this.audit(brandId, actor.id, 'FLAG_REASSIGNED', id, { to: owner.name }, now);
      await this.prisma.issueEvent.create({ data: { flagId: id, kind: 'ACTION', actorId: actor.id, actorName: actor.name, actorParty: 'OURS', body: `Owner changed to ${owner.name}`, createdAt: now } });
      return { ok: true, message: `Assigned to ${owner.name}` };
    }

    if (input.kind === 'resolve') {
      const note = input.note || 'Resolved';
      await this.prisma.redFlag.update({ where: { id }, data: { resolvedAt: now, actedAt: now, outcome: 'Solved', faultParty: 'NONE', note: `${note} · ${actor.name}` } });
      await this.audit(brandId, actor.id, 'FLAG_RESOLVED', id, { note }, now);
      await this.prisma.issueEvent.create({ data: { flagId: id, kind: 'RESOLVED', actorId: actor.id, actorName: actor.name, actorParty: 'OURS', body: `Closed: ${note}`, createdAt: now } });
      return { ok: true, message: 'Closed' };
    }

    // act: record the suggested fix and tell the courier through the shipment's timeline.
    const what = f.action ?? 'Action taken';
    const note = `${what}${input.note ? `: ${input.note}` : ''} · ${actor.name}`;
    const followUp = new Date(now.getTime() + (FOLLOW_UP_HOURS[f.type] ?? 24) * 3600_000);
    await this.prisma.redFlag.update({ where: { id }, data: { actedAt: now, note, dueAt: followUp, escalationLevel: 0, escalatedAt: null } });
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
    await this.prisma.issueEvent.create({ data: { flagId: id, kind: 'ACTION', actorId: actor.id, actorName: actor.name, actorParty: 'OURS', body: `${what}${input.note ? `: ${input.note}` : ''}`, createdAt: now } });
    return { ok: true, message: `${what} · done` };
  }

  async team() {
    const brandId = await this.brands.currentBrandId();
    return this.prisma.user.findMany({
      // Our own team only: vendor and courier partner logins are not owners of problems.
      where: { brandId, role: { notIn: ['VENDOR', 'COURIER'] } },
      select: { id: true, name: true, role: true, email: true, phone: true, active: true, managerId: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private audit(brandId: string, actorId: string, action: string, flagId: string, after: object, now: Date) {
    return this.prisma.auditLog.create({ data: { brandId, actorId, action, entityType: 'RedFlag', entityId: flagId, after, createdAt: now } });
  }
}
