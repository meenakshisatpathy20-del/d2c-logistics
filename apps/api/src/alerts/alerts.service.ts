import { Injectable, Logger } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { closedReason, istAt, istDateKey, istDayStart, istHour, slotLabel } from '../common/ist.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 60 * 60 * 1000;
/** After the deadline: manager at once, courier account manager 2 h later, founder 4 h later. */
export const ESCALATION_STEPS_HOURS = [0, 2, 4];
export const SUMMARY_HOUR = 21; // 9 pm IST
export const VENDOR_LIST_HOUR = 9; // 9 am IST

type Channel = 'APP' | 'SMS' | 'EMAIL';
type Send = {
  brandId: string;
  userId?: string | null;
  channel: Channel;
  to: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
  dedupeKey: string;
  now: Date;
};

/** Links in SMS and email must be full addresses; Render sets RENDER_EXTERNAL_URL itself. */
export const fullLink = (path: string) => `${(process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, '')}${path}`;

/** SMS stays plain text: no emoji (they double the SMS cost and read as spam). */
const plain = (t: string) => t.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, '').trim();

const inr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Alerts reach people where they are, so nobody has to keep a dashboard open:
 *  - a new problem goes to its owner (app bell + an SMS link) with a link to it;
 *  - past its deadline it climbs the ladder: manager, courier account manager, founder;
 *  - at 9 pm management gets the daily summary; at 9 am each vendor gets its pickups.
 * WhatsApp is not used. The work happens on the platform; SMS and email only
 * carry a link to it. Until SMS/email are connected, those are kept in the
 * outbox marked DEMO, exactly as they would be sent.
 */
@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
  ) {}

  async run(now: Date = new Date()) {
    const alerted = await this.alertOwners(now);
    const escalated = await this.escalate(now);
    const summary = istHour(now) >= SUMMARY_HOUR ? await this.dailySummary(now) : null;
    const vendorLists = istHour(now) >= VENDOR_LIST_HOUR ? await this.vendorPickupLists(now) : 0;
    if (alerted || escalated || vendorLists || summary?.sent) this.log.log({ alerted, escalated, vendorLists, summary: !!summary?.sent });
    return { alerted, escalated, summary: !!summary?.sent, vendorLists };
  }

  /** Sends once per dedupe key; returns true if it was new. */
  async send(m: Send): Promise<boolean> {
    try {
      await this.prisma.notification.create({
        data: {
          brandId: m.brandId,
          userId: m.userId ?? null,
          channel: m.channel,
          to: m.to,
          kind: m.kind,
          title: m.title,
          body: m.body,
          link: m.link,
          // Outside channels are not connected yet: kept as DEMO. The app bell is real.
          status: m.channel === 'APP' ? 'SENT' : (process.env.MESSAGING_MODE ?? 'DEMO') === 'DEMO' ? 'DEMO' : 'PENDING',
          dedupeKey: m.dedupeKey,
          createdAt: m.now,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  /**
   * A partner (courier contact, vendor) or customer: the alert lands in their
   * own login when they have one, and an SMS carries only the link to it,
   * never the conversation. Returns true if anything new was sent.
   */
  async notify(m: { brandId: string; phone: string | null; name: string; kind: string; title: string; body: string; link?: string; dedupeKey: string; now: Date }) {
    const user = m.phone ? await this.prisma.user.findFirst({ where: { brandId: m.brandId, phone: m.phone, active: true } }) : null;
    const app = user
      ? await this.send({ brandId: m.brandId, userId: user.id, channel: 'APP', to: user.name, kind: m.kind, title: m.title, body: m.body, link: m.link, dedupeKey: `${m.dedupeKey}:app`, now: m.now })
      : false;
    const sms = m.phone
      ? await this.send({
          brandId: m.brandId,
          channel: 'SMS',
          to: `+91 ${m.phone}`,
          kind: m.kind,
          title: m.title,
          body: `EcomNext: ${plain(m.title)}.${m.link ? ` Open: ${fullLink(m.link)}` : ''}`,
          link: m.link,
          dedupeKey: `${m.dedupeKey}:sms`,
          now: m.now,
        })
      : false;
    return app || sms;
  }

  /** App bell + an SMS link for one team member. */
  private async toPerson(
    brandId: string,
    user: { id: string; name: string; phone: string },
    m: { kind: string; title: string; body: string; link?: string; key: string; now: Date },
  ) {
    const app = await this.send({ brandId, userId: user.id, channel: 'APP', to: user.name, ...m, dedupeKey: `${m.key}:app` });
    await this.send({
      brandId,
      userId: user.id,
      channel: 'SMS',
      to: `+91 ${user.phone}`,
      kind: m.kind,
      title: m.title,
      body: `EcomNext: ${plain(m.title)}.${m.link ? ` Open: ${fullLink(m.link)}` : ''}`,
      link: m.link,
      dedupeKey: `${m.key}:sms`,
      now: m.now,
    });
    return app;
  }

  /** Every alert opens the issue room, where the whole story and the actions are. */
  private flagLink(f: { id: string }) {
    return `/issues/${f.id}`;
  }

  /** Every open problem reaches its owner once (again if the owner changes). */
  private async alertOwners(now: Date) {
    const brandId = await this.brands.currentBrandId();
    const flags = await this.prisma.redFlag.findMany({
      where: { brandId, resolvedAt: null, ownerId: { not: null } },
      include: { owner: true, shipment: { include: { order: true } } },
    });
    // One query for what was already sent, so only new alerts are written.
    const keys = flags.map((f) => `flag:${f.id}:${f.ownerId}:app`);
    const done = new Set(
      (await this.prisma.notification.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((n) => n.dedupeKey),
    );
    let n = 0;
    for (const f of flags) {
      if (done.has(`flag:${f.id}:${f.ownerId}:app`)) continue;
      const due = f.dueAt ? ` · due ${f.dueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
      const order = f.shipment ? `#${f.shipment.order.orderNumber} · ` : '';
      if (
        await this.toPerson(brandId, f.owner!, {
          kind: 'FLAG',
          title: `${f.severity === 'CRITICAL' ? '🔴' : '🟠'} ${f.title}`,
          body: `${order}${f.message}${due}\nYou own this. Suggested fix: ${f.action ?? 'open it'}`,
          link: this.flagLink(f),
          key: `flag:${f.id}:${f.ownerId}`,
          now,
        })
      )
        n++;
    }
    return n;
  }

  /** Overdue and nobody acted: owner → manager → courier account manager → founder. */
  private async escalate(now: Date) {
    const brandId = await this.brands.currentBrandId();
    const overdue = await this.prisma.redFlag.findMany({
      // Acted-on problems are included: past their follow-up time with no result, they climb again.
      where: { brandId, resolvedAt: null, dueAt: { lt: now }, escalationLevel: { lt: 3 } },
      include: {
        owner: { include: { manager: true } },
        shipment: { include: { order: true, courier: true } },
        pickup: { include: { courier: true, warehouse: true } },
      },
    });
    const founder = await this.prisma.user.findFirst({ where: { brandId, role: 'ADMIN', active: true }, orderBy: { createdAt: 'asc' } });
    let n = 0;
    for (const f of overdue) {
      const late = now.getTime() - f.dueAt!.getTime();
      const target = ESCALATION_STEPS_HOURS.filter((h) => late >= h * HOUR).length; // 1..3
      for (let level = f.escalationLevel + 1; level <= target; level++) {
        const courier = f.shipment?.courier ?? f.pickup?.courier ?? null;
        const what = `${f.title}${f.shipment ? ` · #${f.shipment.order.orderNumber}` : f.pickup ? ` · ${f.pickup.warehouse.name}` : ''}`;
        const lateText = `${f.actedAt ? `no result after "${f.note ?? 'action'}", ` : ''}overdue by ${Math.max(1, Math.round(late / HOUR))} h, owner ${f.owner?.name ?? 'unassigned'}`;
        // A new deadline (after an action) starts a new round of escalation messages.
        const round = f.dueAt!.getTime();
        const link = this.flagLink(f);
        let to = '';
        if (level === 1) {
          const manager = f.owner?.manager ?? founder;
          if (manager) {
            to = manager.name;
            await this.toPerson(brandId, manager, { kind: 'ESCALATION', title: `⬆ Escalated to you: ${what}`, body: `${f.message} · ${lateText}`, link, key: `esc:${f.id}:1:${round}`, now });
          }
        } else if (level === 2) {
          if (courier) {
            // The courier's own account manager, by name, from Settings → Courier contacts.
            const am =
              (f.courierContactId ? await this.prisma.courierContact.findUnique({ where: { id: f.courierContactId } }) : null) ??
              (await this.prisma.courierContact.findFirst({ where: { brandId, courierCode: courier.code, role: 'ACCOUNT_MANAGER', active: true } }));
            to = am ? `${am.name} (${courier.name} account manager)` : `${courier.name} account manager (no contact added)`;
            await this.notify({
              brandId,
              phone: am?.phone ?? null,
              name: to,
              kind: 'ESCALATION',
              title: `Escalation: ${what}`,
              body: `${f.title}${f.shipment ? ` · AWB ${f.shipment.awb}` : ''}\n${f.message}\nThis is ${lateText}. Reply in the partner app with the reason (RCA), a name and a time.`,
              link: '/p',
              dedupeKey: `esc:${f.id}:2:${round}`,
              now,
            });
          } else to = 'no courier involved, skipped';
        } else if (founder) {
          to = founder.name;
          // App only: one SMS per issue would flood the founder. The 7 pm agent summary lists who is ignoring us.
          await this.send({ brandId, userId: founder.id, channel: 'APP', to: founder.name, kind: 'ESCALATION', title: `⬆⬆ Founder escalation: ${what}`, body: `${f.message} · ${lateText}`, link, dedupeKey: `esc:${f.id}:3:${round}:app`, now });
        }
        await this.prisma.redFlag.update({ where: { id: f.id }, data: { escalationLevel: level, escalatedAt: now } });
        await this.prisma.auditLog.create({
          data: { brandId, action: 'FLAG_ESCALATED', entityType: 'RedFlag', entityId: f.id, after: { level, to }, createdAt: now },
        });
        n++;
      }
    }
    return n;
  }

  /** The day in numbers for management. Built once at 9 pm; can also be built on demand. */
  async buildSummary(now: Date = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const dayStart = istDayStart(now);
    const dayEnd = istAt(now, 24);
    const during = { gte: dayStart, lt: dayEnd };
    const eventCount = (status: 'PICKED_UP' | 'DELIVERED' | 'RTO_INITIATED') =>
      this.prisma.trackingEvent.count({ where: { status, occurredAt: during, shipment: { brandId } } });
    const [booked, pickedUp, delivered, rto, stuck, openFlags, overdue, cod, advances, pickups, freight] = await Promise.all([
      this.prisma.shipment.count({ where: { brandId, createdAt: during, status: { not: 'CANCELLED' } } }),
      eventCount('PICKED_UP'),
      eventCount('DELIVERED'),
      eventCount('RTO_INITIATED'),
      this.prisma.redFlag.count({ where: { brandId, resolvedAt: null, type: 'NO_SCAN_48H' } }),
      this.prisma.redFlag.findMany({ where: { brandId, resolvedAt: null }, orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }], include: { owner: true } }),
      this.prisma.redFlag.count({ where: { brandId, resolvedAt: null, dueAt: { lt: now } } }),
      this.prisma.order.aggregate({
        where: { brandId, paymentMode: 'COD', shipments: { some: { status: { in: ['BOOKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'NDR'] } } } },
        _sum: { codAmount: true },
        _count: true,
      }),
      this.prisma.order.aggregate({ where: { brandId, advanceStatus: 'PAID' }, _sum: { codAdvance: true } }),
      this.prisma.pickup.findMany({ where: { brandId, slotStart: during, status: { not: 'CANCELLED' }, parcelCount: { gt: 0 } }, select: { status: true } }),
      this.prisma.shipment.aggregate({ where: { brandId, createdAt: during, status: { not: 'CANCELLED' } }, _sum: { chargedAmount: true } }),
    ]);
    // Moved or postponed pickups are counted where their parcels went.
    const counted = pickups.filter((p) => !['REASSIGNED', 'POSTPONED'].includes(p.status));
    return {
      day: istDateKey(now),
      booked,
      pickedUp,
      delivered,
      rtoStarted: rto,
      stuck,
      redFlagsOpen: openFlags.length,
      critical: openFlags.filter((f) => f.severity === 'CRITICAL').length,
      overdue,
      codPending: Number(cod._sum.codAmount ?? 0),
      codPendingOrders: cod._count,
      advancesHeld: Number(advances._sum.codAdvance ?? 0),
      freightToday: Number(freight._sum.chargedAmount ?? 0),
      pickups: { due: counted.length, done: counted.filter((p) => p.status === 'PICKED_UP').length, missed: counted.filter((p) => p.status === 'MISSED').length },
      topProblems: openFlags.slice(0, 5).map((f) => ({ title: f.title, message: f.message, owner: f.owner?.name ?? 'Unassigned' })),
    };
  }

  static summaryText(s: Awaited<ReturnType<AlertsService['buildSummary']>>) {
    const lines = [
      `EcomNext · ${s.day}`,
      `Booked ${s.booked} · picked up ${s.pickedUp} · delivered ${s.delivered} · RTO started ${s.rtoStarted}`,
      `Pickups ${s.pickups.done}/${s.pickups.due} done${s.pickups.missed ? `, ${s.pickups.missed} missed` : ''}`,
      `Stuck (no scan 48 h): ${s.stuck} · issues open: ${s.redFlagsOpen} (${s.critical} critical, ${s.overdue} overdue)`,
      `COD with couriers: ${inr(s.codPending)} on ${s.codPendingOrders} orders · advances held ${inr(s.advancesHeld)} · freight today ${inr(s.freightToday)}`,
    ];
    if (s.topProblems.length) lines.push('Top problems:', ...s.topProblems.map((p, i) => `${i + 1}. ${p.title} (${p.owner})`));
    return lines.join('\n');
  }

  /** Saves today's summary once and sends it to every admin. */
  async dailySummary(now: Date = new Date(), force = false) {
    const brandId = await this.brands.currentBrandId();
    const day = istDateKey(now);
    const existing = await this.prisma.dailySummary.findUnique({ where: { brandId_day: { brandId, day } } });
    if (existing && !force) return { summary: existing, sent: false };
    const data = await this.buildSummary(now);
    const summary = await this.prisma.dailySummary.upsert({
      where: { brandId_day: { brandId, day } },
      update: { data, createdAt: now },
      create: { brandId, day, data, createdAt: now },
    });
    const admins = await this.prisma.user.findMany({ where: { brandId, role: 'ADMIN', active: true } });
    const body = AlertsService.summaryText(data);
    for (const a of admins) {
      const key = `summary:${day}:${a.id}${force ? `:${now.getTime()}` : ''}`;
      await this.toPerson(brandId, a, { kind: 'DAILY_SUMMARY', title: `Daily summary · ${day}`, body, link: '/reports', key, now });
      if (a.email) {
        await this.send({ brandId, userId: a.id, channel: 'EMAIL', to: a.email, kind: 'DAILY_SUMMARY', title: `Daily summary · ${day}`, body, link: '/reports', dedupeKey: `${key}:email`, now });
      }
    }
    return { summary, sent: true };
  }

  /** At 9 am each vendor gets today's pickup list in its login, with an SMS link to it. */
  private async vendorPickupLists(now: Date) {
    if (closedReason(now)) return 0;
    const brandId = await this.brands.currentBrandId();
    const day = istDateKey(now);
    const pickups = await this.prisma.pickup.findMany({
      where: { brandId, slotStart: { gte: istDayStart(now), lt: istAt(now, 24) }, status: { in: ['SCHEDULED', 'CONFIRMED'] }, parcelCount: { gt: 0 } },
      include: { warehouse: true, courier: true },
      orderBy: { slotStart: 'asc' },
    });
    const byWarehouse = new Map<string, typeof pickups>();
    for (const p of pickups) byWarehouse.set(p.warehouseId, [...(byWarehouse.get(p.warehouseId) ?? []), p]);
    let n = 0;
    for (const list of byWarehouse.values()) {
      const w = list[0].warehouse;
      const body = [
        `Good morning ${w.contactName}, today's pickups at ${w.name}:`,
        ...list.map((p) => `• ${slotLabel(p.slotStart)} · ${p.courier.name} · ${p.parcelCount} parcel${p.parcelCount === 1 ? '' : 's'}`),
        'Please pack, add photos and mark "packed and ready".',
      ].join('\n');
      if (await this.notify({ brandId, phone: w.contactPhone, name: w.contactName, kind: 'VENDOR_PICKUPS', title: `Pickups today · ${w.name}`, body, link: '/v', dedupeKey: `vendor9am:${w.id}:${day}`, now }))
        n++;
    }
    return n;
  }

  // ---------- Bell and outbox ----------

  async mine(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId, channel: 'APP' }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId, channel: 'APP', readAt: null } }),
    ]);
    return { unread, items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.readAt, at: n.createdAt })) };
  }

  async markRead(userId: string, id?: string, now = new Date()) {
    await this.prisma.notification.updateMany({ where: { userId, channel: 'APP', readAt: null, ...(id ? { id } : {}) }, data: { readAt: now } });
    return { ok: true };
  }

  async outbox(page = 1, size = 50) {
    const brandId = await this.brands.currentBrandId();
    const where = { brandId, channel: { not: 'APP' as const } };
    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * size, take: size }),
    ]);
    return { total, page, pages: Math.max(1, Math.ceil(total / size)), rows: rows.map((n) => ({ id: n.id, channel: n.channel, to: n.to, kind: n.kind, title: n.title, body: n.body, status: n.status, at: n.createdAt })) };
  }

  async latestSummary() {
    const brandId = await this.brands.currentBrandId();
    const s = await this.prisma.dailySummary.findFirst({ where: { brandId }, orderBy: { day: 'desc' } });
    return s ? { day: s.day, createdAt: s.createdAt, data: s.data, text: AlertsService.summaryText(s.data as never) } : null;
  }
}
