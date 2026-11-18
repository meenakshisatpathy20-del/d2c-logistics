import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AlertsService, fullLink } from '../alerts/alerts.service.js';
import { BrandService } from '../common/brand.service.js';
import { closedReason, istHour } from '../common/ist.js';
import { DEMO_COURIERS } from '../couriers/demo/profiles.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  contactRoleFor,
  FAULT_PARTIES,
  firstTurn,
  type Group,
  GROUP_TYPES,
  groupOf,
  IGNORED_BEFORE_AUTO_SWITCH,
  IGNORED_BEFORE_MANAGER,
  OUTCOMES,
  type Party,
  PARTY_LABEL,
  NEEDS_REFERENCE,
  RAISED,
  REMIND_EVERY_HOURS,
  REMIND_FROM_HOUR,
  REMIND_UNTIL_HOUR,
  ROLE_LABEL,
} from './issue-rules.js';

const HOUR = 3600_000;
const partyEnum = z.enum(['OURS', 'COURIER', 'VENDOR', 'CUSTOMER']);
const when = z.coerce.date();

export const IssueActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), body: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal('ask'), party: z.enum(['COURIER', 'VENDOR', 'CUSTOMER']), body: z.string().trim().min(3).max(1000) }),
  z.object({
    kind: z.literal('partner_reply'),
    party: z.enum(['COURIER', 'VENDOR', 'CUSTOMER']),
    via: z.enum(['WHATSAPP', 'CALL', 'EMAIL']),
    body: z.string().trim().min(2).max(2000),
    promiseAt: when.optional(),
  }),
  z.object({
    kind: z.literal('call_note'),
    party: z.enum(['COURIER', 'VENDOR', 'CUSTOMER']),
    agreed: z.string().trim().min(3).max(1000),
    nextBy: partyEnum,
    deadline: when.optional(),
  }),
  z.object({ kind: z.literal('turn'), party: partyEnum }),
  z.object({ kind: z.literal('reassign'), ownerId: z.string().min(5) }),
  z.object({ kind: z.literal('postpone'), reason: z.string().trim().min(3).max(200) }),
  z.object({ kind: z.literal('switch_courier'), reason: z.string().trim().min(3).max(200) }),
  z.object({
    kind: z.literal('resolve'),
    outcome: z.string().trim().min(2).max(120),
    faultParty: z.enum(FAULT_PARTIES),
    note: z.string().trim().max(500).optional(),
  }),
]);
export type IssueAction = z.infer<typeof IssueActionSchema>;

export const RaiseSchema = z.object({
  type: z.string().refine((t) => t in RAISED, 'Unknown issue type'),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(3).max(2000),
  orderId: z.string().optional(),
  pickupId: z.string().optional(),
  courierCode: z.string().trim().toUpperCase().optional(),
  waitingOn: partyEnum.optional(),
  promiseAt: when.optional(),
});

export const VendorReplySchema = z.object({
  kind: z.enum(['READY', 'NOT_READY', 'MESSAGE']),
  body: z.string().trim().max(1000).optional(),
  promiseAt: when.optional(),
});

export const ContactSchema = z.object({
  courierCode: z.string().trim().toUpperCase(),
  name: z.string().trim().min(2).max(80),
  role: z.enum(['ACCOUNT_MANAGER', 'PICKUP_LEAD', 'HUB', 'REGIONAL_MANAGER']),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Mobile must be 10 digits starting 6–9'),
  email: z.string().trim().email().optional().or(z.literal('')),
  region: z.string().trim().max(60).optional(),
  active: z.boolean().optional(),
});

type Actor = { id: string; name: string; role: string; warehouseId?: string | null };

const include = {
  owner: { include: { manager: true } },
  courierContact: true,
  shipment: { include: { order: { include: { pickupWarehouse: true } }, courier: true } },
  pickup: { include: { warehouse: true, courier: true } },
} satisfies Prisma.RedFlagInclude;
type Flag = Prisma.RedFlagGetPayload<{ include: typeof include }>;

const fmt = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Issue rooms: every problem is raised, owned, discussed and solved in one
 * place, with whose turn it is, reminders that go out by themselves, promises
 * with a time, and an outcome that proves it is solved.
 */
@Injectable()
export class IssuesService {
  private readonly log = new Logger(IssuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly alerts: AlertsService,
    private readonly pickups: PickupsService,
  ) {}

  // ---------- People on each side ----------

  private courierOf(f: Flag): { code: string; name: string } | null {
    if (f.shipment) return { code: f.shipment.courierCode, name: f.shipment.courier.name };
    if (f.pickup) return { code: f.pickup.courierCode, name: f.pickup.courier.name };
    if (f.courierContact) {
      const code = f.courierContact.courierCode;
      return { code, name: DEMO_COURIERS.find((c) => c.code === code)?.name ?? code };
    }
    return null;
  }

  private vendorOf(f: Flag) {
    return f.pickup?.warehouse ?? f.shipment?.order.pickupWarehouse ?? null;
  }

  /** The person whose turn it is, by name, so a delay sits with someone on the record. */
  /** Whose turn it is; a red flag the engine has not opened yet already shows the right side. */
  private turn(f: Flag): Party {
    return (f.waitingOn as Party | null) ?? firstTurn(f.type);
  }

  private turnPerson(f: Flag): string {
    switch (this.turn(f)) {
      case 'COURIER': {
        const c = this.courierOf(f);
        return f.courierContact ? `${f.courierContact.name} (${c?.name ?? f.courierContact.courierCode} ${ROLE_LABEL[f.courierContact.role]})` : `${c?.name ?? 'Courier'} (no contact added)`;
      }
      case 'VENDOR': {
        const w = this.vendorOf(f);
        return w ? `${w.contactName} (${w.name})` : 'Vendor';
      }
      case 'CUSTOMER':
        return f.shipment ? `${f.shipment.order.customerName} (customer)` : 'Customer';
      default:
        return f.owner?.name ?? 'Our team';
    }
  }

  private async pickContact(brandId: string, courierCode: string | undefined, type: string) {
    if (!courierCode) return null;
    const contacts = await this.prisma.courierContact.findMany({ where: { brandId, courierCode, active: true } });
    return contacts.find((c) => c.role === contactRoleFor(type)) ?? contacts.find((c) => c.role === 'ACCOUNT_MANAGER') ?? contacts[0] ?? null;
  }

  private event(flagId: string, e: { kind: string; actorId?: string | null; actorName: string; actorParty: string; body: string; via?: string; promiseAt?: Date | null; at: Date }) {
    return this.prisma.issueEvent.create({
      data: { flagId, kind: e.kind, actorId: e.actorId ?? null, actorName: e.actorName, actorParty: e.actorParty, body: e.body, via: e.via, promiseAt: e.promiseAt ?? null, createdAt: e.at },
    });
  }

  // ---------- Engine: open new issues, reminders, broken promises ----------

  async run(now: Date = new Date()) {
    const opened = await this.openNew();
    const broken = await this.brokenPromises(now);
    const reminded = await this.remind(now);
    if (opened || broken || reminded) this.log.log({ opened, broken, reminded });
    return { opened, broken, reminded };
  }

  /** A red flag raised by the rules becomes an issue: first turn, courier contact, first line of the story. */
  private async openNew() {
    const brandId = await this.brands.currentBrandId();
    const fresh = await this.prisma.redFlag.findMany({ where: { brandId, resolvedAt: null, waitingSince: null }, include });
    for (const f of fresh) {
      const courier = this.courierOf(f);
      const contact = f.courierContactId ? null : await this.pickContact(brandId, courier?.code, f.type);
      await this.prisma.redFlag.update({
        where: { id: f.id },
        data: { waitingOn: f.waitingOn ?? firstTurn(f.type), waitingSince: f.createdAt, ...(contact ? { courierContactId: contact.id } : {}) },
      });
      await this.event(f.id, { kind: 'SYSTEM', actorName: 'D2C Logistics', actorParty: 'SYSTEM', body: `Raised automatically: ${f.title}. ${f.message}`, at: f.createdAt });
    }
    return fresh.length;
  }

  /** A promised time passed with the issue still open: counted, and the reminders start again. */
  private async brokenPromises(now: Date) {
    const brandId = await this.brands.currentBrandId();
    const due = await this.prisma.redFlag.findMany({ where: { brandId, resolvedAt: null, promiseAt: { lt: now } }, include });
    for (const f of due) {
      await this.prisma.redFlag.update({
        where: { id: f.id },
        data: { promisesBroken: { increment: 1 }, promiseAt: null, waitingSince: now, lastReminderAt: null, reminderCount: 0, dueAt: now, escalationLevel: 0, escalatedAt: null },
      });
      await this.event(f.id, {
        kind: 'PROMISE_BROKEN',
        actorName: 'D2C Logistics',
        actorParty: 'SYSTEM',
        body: `Promise missed: "${f.promiseText ?? 'promised time'}" by ${fmt(f.promiseAt!)}. Still waiting on ${this.turnPerson(f)}.`,
        at: now,
      });
    }
    return due.length;
  }

  /** Nobody chases by hand: the platform reminds the person whose turn it is, and tells their manager when ignored. */
  private async remind(now: Date) {
    if (closedReason(now) || istHour(now) < REMIND_FROM_HOUR || istHour(now) >= REMIND_UNTIL_HOUR) return 0;
    const brandId = await this.brands.currentBrandId();
    const waiting = await this.prisma.redFlag.findMany({
      where: { brandId, resolvedAt: null, waitingOn: { in: ['COURIER', 'VENDOR'] }, promiseAt: null, waitingSince: { not: null } },
      include,
    });
    let n = 0;
    for (const f of waiting) {
      const since = (f.lastReminderAt ?? f.waitingSince!).getTime();
      if (now.getTime() - since < REMIND_EVERY_HOURS * HOUR) continue;
      const count = f.reminderCount + 1;
      const target = this.reminderTarget(f);
      const link = `/issues/${f.id}`;
      const waitedH = Math.max(1, Math.round((now.getTime() - f.waitingSince!.getTime()) / HOUR));
      await this.alerts.send({
        brandId,
        channel: 'WHATSAPP',
        to: target.phone ? `+91 ${target.phone}` : target.name,
        kind: 'ISSUE_REMINDER',
        title: `Reminder ${count}: ${f.title}`,
        body: `${f.title} — waiting on you for ${waitedH} h.\nPlease reply with a name and a time, or the result.\n${this.replyHint(f.waitingOn)}`,
        link,
        dedupeKey: `remind:${f.id}:${since}`,
        now,
      });
      await this.prisma.redFlag.update({ where: { id: f.id }, data: { reminderCount: count, lastReminderAt: now } });
      await this.event(f.id, { kind: 'REMINDER', actorName: 'D2C Logistics', actorParty: 'SYSTEM', body: `Reminder ${count} sent to ${target.name} on WhatsApp. No reply for ${waitedH} h.`, via: 'WHATSAPP', at: now });
      if (count === IGNORED_BEFORE_MANAGER) await this.toManager(f, brandId, count, now);
      if (count >= IGNORED_BEFORE_AUTO_SWITCH && f.waitingOn === 'COURIER') await this.stopWaiting(f, count, now);
      n++;
    }
    return n;
  }

  /**
   * Where the other side answers. Vendors have their own login; couriers reply
   * on the WhatsApp itself until their Partner app login, and the reply is
   * logged on the issue. Never a link to a page they cannot open.
   */
  private replyHint(party: string | null): string {
    if (party === 'VENDOR') return `Answer here: ${fullLink('/v')}`;
    return 'Reply to this message; your reply is recorded on the issue with the time.';
  }

  private reminderTarget(f: Flag): { name: string; phone: string | null } {
    if (f.waitingOn === 'CUSTOMER') {
      return f.shipment ? { name: `${f.shipment.order.customerName} (customer)`, phone: f.shipment.order.customerPhone } : { name: 'Customer', phone: null };
    }
    if (f.waitingOn === 'VENDOR') {
      const w = this.vendorOf(f);
      return { name: w ? `${w.contactName} (${w.name})` : 'Vendor', phone: w?.contactPhone ?? null };
    }
    return f.courierContact ? { name: `${f.courierContact.name}`, phone: f.courierContact.phone } : { name: this.turnPerson(f), phone: null };
  }

  /**
   * Nudging alone can be ignored, as on WhatsApp. So when a courier stays silent
   * after its manager was told, the platform stops waiting: pickup parcels move
   * to the most reliable other courier, and the silence goes on the scorecard.
   */
  private async stopWaiting(f: Flag, ignored: number, now: Date) {
    if (!f.pickupId || groupOf(f.type) !== 'PICKUPS') return;
    if (!['SCHEDULED', 'CONFIRMED', 'MISSED'].includes(f.pickup?.status ?? '')) return;
    try {
      const r = await this.pickups.switchCourier(f.pickupId, `${ignored} reminders ignored`, { id: '', name: 'D2C Logistics' }, now);
      await this.prisma.redFlag.update({ where: { id: f.id }, data: { waitingOn: 'OURS', waitingSince: now, reminderCount: 0, lastReminderAt: null } });
      await this.event(f.id, {
        kind: 'ACTION',
        actorName: 'D2C Logistics',
        actorParty: 'SYSTEM',
        body: `${ignored} reminders ignored, so we stopped waiting: parcels moved from ${r.from} to ${r.to}, pickup ${r.slot}. The old booking was cancelled. Close this with who was at fault.`,
        at: now,
      });
    } catch (e) {
      await this.event(f.id, { kind: 'SYSTEM', actorName: 'D2C Logistics', actorParty: 'SYSTEM', body: `Could not move the parcels by itself: ${(e as Error).message}. Switch the courier from here.`, at: now });
    }
  }

  /** Ignored twice: the courier's manager hears about it; for a vendor, our owner and their manager do. */
  private async toManager(f: Flag, brandId: string, ignored: number, now: Date) {
    const link = `/issues/${f.id}`;
    if (f.waitingOn === 'COURIER' && f.courierContact) {
      const boss = await this.prisma.courierContact.findFirst({
        where: { brandId, courierCode: f.courierContact.courierCode, active: true, role: f.courierContact.role === 'REGIONAL_MANAGER' ? 'ACCOUNT_MANAGER' : 'REGIONAL_MANAGER', id: { not: f.courierContact.id } },
      });
      if (boss) {
        await this.alerts.send({
          brandId,
          channel: 'WHATSAPP',
          to: `+91 ${boss.phone}`,
          kind: 'ISSUE_ESCALATED',
          title: `${f.courierContact.name} has not answered: ${f.title}`,
          body: `${f.courierContact.name} ignored ${ignored} reminders on "${f.title}". Please take it over.\n${this.replyHint('COURIER')}`,
          link,
          dedupeKey: `ignored:${f.id}:${f.waitingSince!.getTime()}`,
          now,
        });
        await this.prisma.redFlag.update({ where: { id: f.id }, data: { courierContactId: boss.id } });
        await this.event(f.id, { kind: 'ESCALATED', actorName: 'D2C Logistics', actorParty: 'SYSTEM', body: `${f.courierContact.name} ignored ${ignored} reminders. Handed to ${boss.name} (${ROLE_LABEL[boss.role]}).`, at: now });
        return;
      }
    }
    const owner = f.owner;
    if (owner) {
      await this.alerts.send({
        brandId,
        userId: owner.id,
        channel: 'APP',
        to: owner.name,
        kind: 'ISSUE_ESCALATED',
        title: `No answer from ${this.turnPerson(f)}: ${f.title}`,
        body: `${ignored} reminders ignored. Call them and log the call on the issue, or switch courier.`,
        link,
        dedupeKey: `ignored:${f.id}:${f.waitingSince!.getTime()}:owner`,
        now,
      });
    }
    await this.event(f.id, { kind: 'ESCALATED', actorName: 'D2C Logistics', actorParty: 'SYSTEM', body: `${ignored} reminders ignored by ${this.turnPerson(f)}. ${owner?.name ?? 'Our team'} alerted to call and log it.`, at: now });
  }

  // ---------- Inbox ----------

  async list(q: { status?: 'open' | 'closed'; group?: Group | 'ALL'; waiting?: Party | 'ALL'; mine?: boolean; page?: number }, me: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const base: Prisma.RedFlagWhereInput = { brandId, resolvedAt: q.status === 'closed' ? { not: null } : null };
    const where: Prisma.RedFlagWhereInput = {
      ...base,
      ...(q.group && q.group !== 'ALL' ? (q.group === 'OTHER' ? { type: { notIn: (['PICKUPS', 'TRANSIT', 'DELIVERY', 'RETURNS', 'WEIGHT', 'MONEY', 'BOOKING'] as Group[]).flatMap(GROUP_TYPES) } } : { type: { in: GROUP_TYPES(q.group) } }) : {}),
      ...(q.waiting && q.waiting !== 'ALL' ? { waitingOn: q.waiting } : {}),
      ...(q.mine ? { ownerId: me.id } : {}),
    };
    const size = 30;
    const page = Math.max(1, q.page ?? 1);
    const [total, rows, byGroup, byWaiting] = await Promise.all([
      this.prisma.redFlag.count({ where }),
      this.prisma.redFlag.findMany({
        where,
        include,
        orderBy: q.status === 'closed' ? [{ resolvedAt: 'desc' }] : [{ severity: 'desc' }, { waitingSince: 'asc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.redFlag.groupBy({ by: ['type'], where: base, _count: true }),
      this.prisma.redFlag.groupBy({ by: ['waitingOn'], where: base, _count: true }),
    ]);
    const groups: Record<string, number> = {};
    for (const g of byGroup) groups[groupOf(g.type)] = (groups[groupOf(g.type)] ?? 0) + g._count;
    return {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / size)),
      counts: { groups, waiting: Object.fromEntries(byWaiting.map((w) => [w.waitingOn ?? 'OURS', w._count])) },
      rows: rows.map((f) => this.row(f, now)),
    };
  }

  private row(f: Flag, now: Date) {
    const waitedMs = f.waitingSince ? now.getTime() - f.waitingSince.getTime() : 0;
    return {
      id: f.id,
      type: f.type,
      group: groupOf(f.type),
      title: f.title,
      message: f.message,
      severity: f.severity === 'CRITICAL' ? 'critical' : 'warning',
      about: f.shipment
        ? { kind: 'order', id: f.shipment.orderId, label: `#${f.shipment.order.orderNumber}`, sub: `${f.shipment.courier.name} · ${f.shipment.awb}` }
        : f.pickup
          ? { kind: 'pickup', id: f.pickup.id, label: f.pickup.warehouse.name, sub: `${f.pickup.courier.name} pickup` }
          : null,
      waitingOn: this.turn(f),
      waitingOnLabel: PARTY_LABEL[this.turn(f)],
      waitingPerson: this.turnPerson(f),
      waitedMinutes: Math.max(0, Math.round(waitedMs / 60000)),
      reminders: f.reminderCount,
      promiseAt: f.promiseAt,
      promiseText: f.promiseText,
      promisesBroken: f.promisesBroken,
      owner: f.owner ? { id: f.owner.id, name: f.owner.name } : null,
      dueAt: f.dueAt,
      overdue: !!f.dueAt && f.dueAt < now && !f.resolvedAt,
      escalationLevel: f.escalationLevel,
      openedAt: f.createdAt,
      resolvedAt: f.resolvedAt,
      outcome: f.outcome,
      faultParty: f.faultParty,
    };
  }

  // ---------- Room ----------

  private async load(id: string, brandId: string) {
    const f = await this.prisma.redFlag.findFirst({ where: { id, brandId }, include });
    if (!f) throw new NotFoundException('Issue not found');
    return f;
  }

  async detail(id: string, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const f = await this.load(id, brandId);
    const [events, team] = await Promise.all([
      this.prisma.issueEvent.findMany({ where: { flagId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findMany({ where: { brandId, active: true, role: { notIn: ['VENDOR', 'COURIER'] } }, select: { id: true, name: true, role: true } }),
    ]);
    const courier = this.courierOf(f);
    const vendor = this.vendorOf(f);
    const lastBy = (party: string) => [...events].reverse().find((e) => e.actorParty === party)?.createdAt ?? null;
    const contacts = courier ? await this.prisma.courierContact.findMany({ where: { brandId, courierCode: courier.code, active: true } }) : [];

    const people = [
      ...(f.owner ? [{ party: 'OURS', name: f.owner.name, role: 'Owner', company: 'D2C Ecommerce', phone: null as string | null, lastActive: lastBy('OURS') }] : []),
      ...(f.owner?.manager ? [{ party: 'OURS', name: f.owner.manager.name, role: 'Escalation (manager)', company: 'D2C Ecommerce', phone: null, lastActive: null }] : []),
      ...(courier
        ? f.courierContact
          ? [{ party: 'COURIER', name: f.courierContact.name, role: ROLE_LABEL[f.courierContact.role], company: courier.name, phone: f.courierContact.phone, lastActive: lastBy('COURIER') }]
          : [{ party: 'COURIER', name: 'No contact added', role: 'Add one in Settings → Courier contacts', company: courier.name, phone: null, lastActive: null }]
        : []),
      ...(vendor ? [{ party: 'VENDOR', name: vendor.contactName, role: 'Vendor contact', company: vendor.name, phone: vendor.contactPhone, lastActive: lastBy('VENDOR') }] : []),
      ...(f.shipment ? [{ party: 'CUSTOMER', name: f.shipment.order.customerName, role: 'Customer', company: f.shipment.order.city || f.shipment.order.pincode, phone: f.shipment.order.customerPhone, lastActive: lastBy('CUSTOMER') }] : []),
    ];

    return {
      ...this.row(f, now),
      open: !f.resolvedAt,
      action: f.action,
      outcomes: OUTCOMES[groupOf(f.type)],
      people,
      courierContacts: contacts.map((c) => ({ id: c.id, name: c.name, role: ROLE_LABEL[c.role], phone: c.phone })),
      team,
      shipment: f.shipment
        ? { id: f.shipment.id, orderId: f.shipment.orderId, orderNumber: f.shipment.order.orderNumber, status: f.shipment.status, courier: f.shipment.courier.name, awb: f.shipment.awb, city: f.shipment.order.city }
        : null,
      pickup: f.pickup
        ? {
            id: f.pickup.id,
            warehouse: f.pickup.warehouse.name,
            courier: f.pickup.courier.name,
            slotStart: f.pickup.slotStart,
            status: f.pickup.status,
            canPostpone: ['SCHEDULED', 'CONFIRMED'].includes(f.pickup.status) && f.pickup.slotEnd > now,
            canSwitch: ['SCHEDULED', 'CONFIRMED', 'MISSED'].includes(f.pickup.status),
            manifestUrl: `/api/pickups/${f.pickup.id}/manifest.pdf`,
          }
        : null,
      events: events.map((e) => ({ id: e.id, kind: e.kind, by: e.actorName, party: e.actorParty, body: e.body, via: e.via, promiseAt: e.promiseAt, at: e.createdAt })),
    };
  }

  /** Everything our team does in a room. Each step is time-stamped with a name. */
  async act(id: string, a: IssueAction, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const f = await this.load(id, brandId);
    if (f.resolvedAt) throw new BadRequestException('This issue is closed');
    const me = { actorId: actor.id, actorName: actor.name, actorParty: 'OURS', at: now };
    const turnTo = (party: Party, extra: Prisma.RedFlagUpdateInput = {}) =>
      this.prisma.redFlag.update({ where: { id }, data: { waitingOn: party, waitingSince: now, reminderCount: 0, lastReminderAt: null, ...extra } });

    switch (a.kind) {
      case 'message':
        await this.event(id, { ...me, kind: 'MESSAGE', body: a.body });
        break;

      case 'ask': {
        await turnTo(a.party, { promiseAt: null, promiseText: null });
        const target = this.reminderTarget({ ...f, waitingOn: a.party });
        await this.alerts.send({
          brandId,
          channel: 'WHATSAPP',
          to: target.phone ? `+91 ${target.phone}` : target.name,
          kind: 'ISSUE_ASK',
          title: f.title,
          body: `${a.body}\nPlease answer with a name and a time, or the result.\n${this.replyHint(a.party)}`,
          link: `/issues/${id}`,
          dedupeKey: `ask:${id}:${now.getTime()}`,
          now,
        });
        await this.event(id, { ...me, kind: 'ASK', body: `Asked ${target.name}: ${a.body}`, via: 'WHATSAPP' });
        break;
      }

      case 'partner_reply': {
        // Logged from WhatsApp, a call or email, so it counts on the record like a reply on the platform.
        const who = a.party === 'COURIER' ? (f.courierContact?.name ?? this.courierOf(f)?.name ?? 'Courier') : a.party === 'VENDOR' ? (this.vendorOf(f)?.contactName ?? 'Vendor') : (f.shipment?.order.customerName ?? 'Customer');
        await this.event(id, { kind: 'PARTNER_REPLY', actorId: actor.id, actorName: `${who} (logged by ${actor.name})`, actorParty: a.party, body: a.body, via: a.via, promiseAt: a.promiseAt, at: now });
        if (a.promiseAt) {
          if (a.promiseAt <= now) throw new BadRequestException('A promised time must be in the future');
          // They committed: still their turn, but no reminders until the promised time.
          await turnTo(a.party, { promiseAt: a.promiseAt, promiseText: a.body.slice(0, 200), dueAt: a.promiseAt, escalationLevel: 0, escalatedAt: null });
        } else {
          await turnTo('OURS', { promiseAt: null, promiseText: null });
        }
        break;
      }

      case 'call_note': {
        const theirs = a.nextBy !== 'OURS';
        await this.event(id, { ...me, kind: 'CALL_NOTE', body: `Call with ${PARTY_LABEL[a.party].toLowerCase()}: ${a.agreed}${a.deadline ? ` · next step by ${PARTY_LABEL[a.nextBy].toLowerCase()} before ${fmt(a.deadline)}` : ''}`, via: 'CALL', promiseAt: theirs ? a.deadline : null });
        if (a.deadline && a.deadline <= now) throw new BadRequestException('The deadline must be in the future');
        await turnTo(a.nextBy, theirs && a.deadline ? { promiseAt: a.deadline, promiseText: a.agreed.slice(0, 200), dueAt: a.deadline, escalationLevel: 0, escalatedAt: null } : { promiseAt: null, promiseText: null, ...(a.deadline ? { dueAt: a.deadline } : {}) });
        break;
      }

      case 'turn':
        await turnTo(a.party);
        await this.event(id, { ...me, kind: 'ACTION', body: `Marked as waiting on ${PARTY_LABEL[a.party].toLowerCase()}` });
        break;

      case 'reassign': {
        const owner = await this.prisma.user.findFirst({ where: { id: a.ownerId, brandId, active: true, role: { notIn: ['VENDOR', 'COURIER'] } } });
        if (!owner) throw new BadRequestException('Pick a team member');
        await this.prisma.redFlag.update({ where: { id }, data: { ownerId: owner.id, escalationLevel: 0, escalatedAt: null } });
        await this.event(id, { ...me, kind: 'ACTION', body: `Owner changed to ${owner.name}` });
        break;
      }

      case 'postpone': {
        if (!f.pickupId) throw new BadRequestException('This issue is not about a pickup');
        const r = await this.pickups.postpone(f.pickupId, a.reason, { id: actor.id, name: actor.name }, now);
        await this.event(id, { ...me, kind: 'ACTION', body: `Pickup moved to ${r.movedTo}. Reason: ${a.reason}` });
        break;
      }

      case 'switch_courier': {
        if (!f.pickupId) throw new BadRequestException('This issue is not about a pickup');
        const r = await this.pickups.switchCourier(f.pickupId, a.reason, { id: actor.id, name: actor.name }, now);
        await this.event(id, { ...me, kind: 'ACTION', body: `Parcels moved from ${r.from} to ${r.to}, pickup ${r.slot}. The old booking was cancelled. Reason: ${a.reason}` });
        break;
      }

      case 'resolve': {
        const allowed = OUTCOMES[groupOf(f.type)];
        if (!allowed.includes(a.outcome)) throw new BadRequestException(`Pick what actually solved it: ${allowed.join(', ')}`);
        await this.checkProof(f, a.outcome, a.note);
        await this.prisma.redFlag.update({
          where: { id },
          // actedAt = resolvedAt marks a hand-closed issue, so the rules do not reopen it for the same status.
          data: { resolvedAt: now, actedAt: now, outcome: a.outcome, faultParty: a.faultParty, note: `${a.outcome}${a.note ? `: ${a.note}` : ''} · ${actor.name}` },
        });
        await this.event(id, { ...me, kind: 'RESOLVED', body: `Solved: ${a.outcome}. At fault: ${a.faultParty === 'NONE' ? 'nobody' : PARTY_LABEL[a.faultParty].toLowerCase()}.${a.note ? ` ${a.note}` : ''}` });
        break;
      }
    }
    await this.prisma.auditLog.create({ data: { brandId, actorId: actor.id, action: `ISSUE_${a.kind.toUpperCase()}`, entityType: 'RedFlag', entityId: id } });
    return this.detail(id, now);
  }

  /**
   * Solved means proven: an outcome the courier's scans can show must be in the
   * scans, and a money outcome needs its reference. Otherwise the issue closes
   * by itself when the scan arrives.
   */
  private async checkProof(f: Flag, outcome: string, note?: string) {
    if (outcome === 'Picked up') {
      const picked = f.pickup
        ? f.pickup.status === 'PICKED_UP' || (await this.prisma.shipment.count({ where: { pickupId: f.pickupId!, status: { notIn: ['BOOKED', 'PICKUP_SCHEDULED', 'CANCELLED'] } } })) > 0
        : !!f.shipment && !['BOOKED', 'PICKUP_SCHEDULED'].includes(f.shipment.status);
      if (!picked) throw new BadRequestException('No pickup scan yet. The issue closes by itself when the courier scans the parcels.');
    }
    if (['Delivered', 'Delivered after address fix'].includes(outcome) && f.shipment && f.shipment.status !== 'DELIVERED') {
      throw new BadRequestException('No delivered scan yet. The issue closes by itself when the courier scans it delivered.');
    }
    if (NEEDS_REFERENCE.includes(outcome) && (note ?? '').trim().length < 4) {
      throw new BadRequestException('Add the reference as proof: UTR, credit note number or invoice line.');
    }
  }

  /** Anyone on our team can raise a problem the rules did not catch, on an order, a pickup or a courier. */
  async raise(input: z.infer<typeof RaiseSchema>, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    let shipmentId: string | null = null;
    let courierCode = input.courierCode;
    if (input.orderId) {
      // Accepts our order ID or the order number people know.
      const o = await this.prisma.order.findFirst({ where: { brandId, OR: [{ id: input.orderId }, { orderNumber: input.orderId }] } });
      if (!o) throw new BadRequestException('No order with that number');
      const s = await this.prisma.shipment.findFirst({ where: { brandId, orderId: o.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' } });
      if (!s) throw new BadRequestException('That order has no shipment yet');
      shipmentId = s.id;
      courierCode = s.courierCode;
    }
    if (input.pickupId) {
      const p = await this.prisma.pickup.findFirst({ where: { id: input.pickupId, brandId } });
      if (!p) throw new BadRequestException('Pickup not found');
      courierCode = p.courierCode;
    }
    if (!shipmentId && !input.pickupId && !courierCode) throw new BadRequestException('Raise it on an order, a pickup or a courier');
    // The same problem raised twice opens the existing issue instead of a second one.
    if (shipmentId || input.pickupId) {
      const same = await this.prisma.redFlag.findFirst({ where: { brandId, type: input.type, resolvedAt: null, shipmentId, pickupId: input.pickupId ?? null } });
      if (same) {
        await this.event(same.id, { kind: 'MESSAGE', actorId: actor.id, actorName: actor.name, actorParty: 'OURS', body: `Raised again: ${input.body}`, at: now });
        return this.detail(same.id, now);
      }
    }
    const contact = await this.pickContact(brandId, courierCode, input.type);
    const waitingOn = input.waitingOn ?? firstTurn(input.type);
    const f = await this.prisma.redFlag.create({
      data: {
        brandId,
        shipmentId,
        pickupId: input.pickupId ?? null,
        type: input.type,
        severity: ['BOOKING_BLOCKED', 'BOOKING_FAILED', 'PICKUP_PENDING', 'LOST', 'EXECUTIVE_CONDUCT', 'NOT_RECEIVED'].includes(input.type) ? 'CRITICAL' : 'WARNING',
        title: input.title || RAISED[input.type].label,
        message: input.body,
        ownerId: actor.id,
        raisedById: actor.id,
        waitingOn,
        waitingSince: now,
        courierContactId: contact?.id ?? null,
        promiseAt: input.promiseAt ?? null,
        dueAt: input.promiseAt ?? new Date(now.getTime() + 4 * HOUR),
        createdAt: now,
      },
    });
    await this.event(f.id, { kind: 'SYSTEM', actorId: actor.id, actorName: actor.name, actorParty: 'OURS', body: `Raised: ${input.body}`, at: now });
    return this.detail(f.id, now);
  }

  // ---------- Vendor side ----------

  async vendorIssues(actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    if (!actor.warehouseId) return [];
    const rows = await this.prisma.redFlag.findMany({
      where: { brandId, resolvedAt: null, OR: [{ pickup: { warehouseId: actor.warehouseId } }, { shipment: { order: { pickupWarehouseId: actor.warehouseId } } }] },
      include: { ...include, events: { orderBy: { createdAt: 'desc' }, take: 3 } },
      orderBy: { waitingSince: 'asc' },
    });
    // Vendors see what concerns them, never our internal notes or other parties' contacts.
    return rows.map((f) => ({
      id: f.id,
      title: f.title,
      about: f.pickup ? `${f.pickup.courier.name} pickup` : f.shipment ? `Order #${f.shipment.order.orderNumber}` : '',
      yourTurn: f.waitingOn === 'VENDOR',
      waitedMinutes: f.waitingSince ? Math.round((now.getTime() - f.waitingSince.getTime()) / 60000) : 0,
      recent: f.events.filter((e) => e.kind !== 'MESSAGE').map((e) => ({ by: e.actorParty === 'OURS' ? 'D2C team' : e.actorName, body: e.body, at: e.createdAt })),
    }));
  }

  async vendorReply(id: string, r: z.infer<typeof VendorReplySchema>, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const f = await this.load(id, brandId);
    const wh = f.pickup?.warehouseId ?? f.shipment?.order.pickupWarehouseId;
    if (!actor.warehouseId || wh !== actor.warehouseId || f.resolvedAt) throw new NotFoundException('Issue not found');
    if (r.promiseAt && r.promiseAt <= now) throw new BadRequestException('Pick a time in the future');
    const body = r.kind === 'READY' ? `Open and parcels are ready.${r.body ? ` ${r.body}` : ''}` : r.kind === 'NOT_READY' ? `Not ready.${r.body ? ` ${r.body}` : ''}` : (r.body ?? '');
    if (!body.trim()) throw new BadRequestException('Write a message');
    await this.event(id, { kind: 'PARTNER_REPLY', actorId: actor.id, actorName: `${this.vendorOf(f)?.contactName ?? actor.name} (${this.vendorOf(f)?.name ?? 'vendor'})`, actorParty: 'VENDOR', body, via: 'PLATFORM', promiseAt: r.promiseAt, at: now });
    // A vendor's "ready" passes the turn back to the courier; "not ready by 3 pm" is the vendor's promise.
    const next: Party = r.kind === 'READY' && f.waitingOn === 'VENDOR' ? 'COURIER' : r.promiseAt ? 'VENDOR' : 'OURS';
    await this.prisma.redFlag.update({
      where: { id },
      data: { waitingOn: next, waitingSince: now, reminderCount: 0, lastReminderAt: null, promiseAt: r.promiseAt ?? null, promiseText: r.promiseAt ? body.slice(0, 200) : null },
    });
    return { ok: true };
  }

  // ---------- Courier contacts ----------

  async contacts() {
    const brandId = await this.brands.currentBrandId();
    return this.prisma.courierContact.findMany({ where: { brandId }, orderBy: [{ courierCode: 'asc' }, { role: 'asc' }] });
  }

  async saveContact(input: z.infer<typeof ContactSchema>, id?: string) {
    const brandId = await this.brands.currentBrandId();
    const data = { ...input, email: input.email || null };
    if (id) {
      const c = await this.prisma.courierContact.findFirst({ where: { id, brandId } });
      if (!c) throw new NotFoundException('Contact not found');
      return this.prisma.courierContact.update({ where: { id }, data });
    }
    return this.prisma.courierContact.create({ data: { ...data, brandId } });
  }
}
