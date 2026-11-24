import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AlertsService } from '../alerts/alerts.service.js';
import { BrandService } from '../common/brand.service.js';
import { closedReason, istDateKey, istHour, slotLabel } from '../common/ist.js';
import type { Prisma } from '../generated/prisma/client.js';
import { groupOf, PARTY_LABEL, type Party } from '../issues/issue-rules.js';
import { IssuesService } from '../issues/issues.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShipmentsService } from '../shipments/shipments.service.js';
import { llmIntent } from './llm.js';
import { parseWhen, timeLabel } from './when.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** A parcel not picked up within this long is ageing (1 working day, as agreed with couriers). */
const AGEING_HOURS = 24;
/** Minutes a person spends on one chase by hand: find the chat, type, check back. */
const MINUTES_PER_ACTION = 4;
/** The 9 am and 6 pm lists go out within this hour (IST). */
export const ROUTINE_HOURS = [9, 18] as const;
/** The day's summary for the team, in the chat. */
export const SUMMARY_HOUR = 19;
const BOOK_CAP = 50;
const CHASE_CAP = 40;

export const AGENT_NAME = 'EcomNext Agent';
export const AskSchema = z.object({ text: z.string().trim().min(1, 'Type what you need').max(1000) });
export const InboundSchema = z.object({ phone: z.string().trim().min(10).max(16), text: z.string().trim().min(1).max(2000) });

type Actor = { id: string; name: string; role: string };
export type Intent =
  | { kind: 'help' }
  | { kind: 'pending'; vendor?: string }
  | { kind: 'ageing' }
  | { kind: 'chase'; courier?: string; refs: string[] }
  | { kind: 'status'; refs: string[] }
  | { kind: 'book'; refs: string[]; allNew: boolean }
  | { kind: 'switch'; courier?: string; vendor?: string }
  | { kind: 'credit'; amount: number; courier?: string; note: string; by: Date | null }
  | { kind: 'lists' }
  | { kind: 'summary' }
  | { kind: 'unknown' };

/** One line the page draws as a row: a parcel, a pickup, an issue or a courier. */
type Item = { label: string; sub?: string; tone?: 'red' | 'amber' | 'green' | 'blue' | 'grey'; href?: string; days?: number };
type Reply = { body: string; items?: Item[]; groups?: Array<{ title: string; items: Item[] }>; actions?: number; approvalId?: string; tips?: string[] };

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "5 hours" or, past two days, "6 days". */
const waitedLabel = (h: number) => (h >= 48 ? plural(Math.floor(h / 24), 'day') : plural(h, 'hour'));

/** Order numbers and AWBs in a message: digit runs of 4+ characters, or codes like DL123456. */
export function refsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#?\b([A-Z]{0,4}\d[\dA-Z-]{3,})\b/gi)) out.add(m[1].toUpperCase());
  return [...out];
}

/** "₹1,788", "rs 1788", "1788 rs", "Rs. 1,788.50" */
export function amountIn(text: string): number | null {
  const m = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:rs|rupees|inr)\b/i.exec(text);
  const raw = m?.[1] ?? m?.[2];
  return raw ? Number(raw.replace(/,/g, '')) : null;
}

/**
 * Reads what the team typed into an intent, with plain rules first: they are
 * instant, free and predictable. Only a message the rules cannot read goes to
 * Claude (when a key is set), and Claude only picks the intent; the code does
 * the work and checks it, so a model mistake cannot move a parcel.
 */
export function readIntent(text: string, now: Date): Intent {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const refs = refsIn(text);
  const amount = amountIn(text);
  if (/^(help|\?|hi|hello|what can you do)/.test(t)) return { kind: 'help' };
  if (/\b(morning|evening|9 ?am|6 ?pm)\b.*\blists?\b|\bsend (the )?lists?\b/.test(t)) return { kind: 'lists' };
  if (/\b(summary|report|how did (we|today) do|day so far)\b/.test(t)) return { kind: 'summary' };
  if (amount !== null && /\b(credit|refund|adjust|owe|due|pending|payment|recover|claim)/.test(t)) {
    const by = /\bby\b/.test(t) ? parseWhen(t.slice(t.indexOf('by')), now) : null;
    return { kind: 'credit', amount, courier: courierWord(t), note: text.trim(), by };
  }
  if (/\b(switch|change|move)\b.*\bcourier\b|\bswitch\b/.test(t)) {
    const at = / (?:at|from|for) (.+)$/.exec(t);
    return { kind: 'switch', courier: courierWord(t), vendor: at?.[1]?.replace(/\b(pickup|pickups|vendor|warehouse)\b/g, '').trim() || undefined };
  }
  if (/\b(chase|nudge|remind|follow ?up|push|escalate)\b/.test(t)) return { kind: 'chase', courier: /\ball\b|everyone|every courier/.test(t) ? undefined : courierWord(t), refs };
  if (/\bbook\b|\bship\b/.test(t)) return { kind: 'book', refs, allNew: /\b(all|new|pending|every)\b/.test(t) && refs.length === 0 };
  if (/\b(ageing|aging|stuck|old|oldest|not picked|unpicked|delayed|late)\b/.test(t)) return { kind: 'ageing' };
  if (/\b(pending|today|open|left|what'?s up|status of today|summary)\b/.test(t) && refs.length === 0) {
    const at = / (?:at|for) (.+)$/.exec(t);
    return { kind: 'pending', vendor: at?.[1]?.trim() };
  }
  if (refs.length) return { kind: 'status', refs };
  return { kind: 'unknown' };
}

/** The word in a message that names a courier, matched later against our couriers. */
function courierWord(t: string): string | undefined {
  const known = ['delhivery', 'ekart', 'shadowfax', 'bluedart', 'blue dart', 'xpressbees', 'amazon', 'blitz', 'pikndel', 'dtdc', 'ecom express', 'ecom'];
  return known.find((k) => t.includes(k));
}

/**
 * The ops teammate. It does the chasing our team did by hand on WhatsApp: who
 * is pending, nudging the right person, holding them to the time they gave,
 * opening money cases, and asking before anything risky. Every step is written
 * in the team chat and in the issue room, so nothing depends on a phone.
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly issues: IssuesService,
    private readonly pickups: PickupsService,
    private readonly shipments: ShipmentsService,
    private readonly alerts: AlertsService,
  ) {}

  // ---------- Team chat ----------

  async feed(now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const [messages, approvals] = await Promise.all([
      this.prisma.agentMessage.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 80 }),
      this.prisma.agentApproval.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 40 }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(messages.map((m) => m.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return {
      messages: messages.reverse().map((m) => ({ id: m.id, role: m.role, by: m.role === 'AGENT' ? AGENT_NAME : (m.userId ? name.get(m.userId) : null) ?? 'Team', body: m.body, data: m.data, at: m.createdAt })),
      approvals: approvals.map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, status: a.status, result: a.result, at: a.createdAt, decidedAt: a.decidedAt })),
      stats: await this.stats(now),
    };
  }

  async ask(text: string, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    await this.prisma.agentMessage.create({ data: { brandId, userId: actor.id, role: 'USER', body: text, createdAt: now } });
    let intent = readIntent(text, now);
    if (intent.kind === 'unknown') intent = (await llmIntent(text, now).catch((e) => (this.log.warn(`Claude intent failed: ${(e as Error).message}`), null))) ?? intent;
    if (intent.kind === 'summary') return (await this.daySummary(now, true))!;
    let reply: Reply;
    try {
      reply = await this.run(intent, actor, brandId, now);
    } catch (e) {
      reply = { body: `I couldn't do that: ${(e as Error).message}` };
    }
    return this.say(brandId, reply, now, { intent: intent.kind });
  }

  private async say(brandId: string, r: Reply, now: Date, extra: Record<string, unknown> = {}) {
    const m = await this.prisma.agentMessage.create({
      data: { brandId, role: 'AGENT', body: r.body, data: { ...extra, items: r.items, groups: r.groups, actions: r.actions ?? 0, approvalId: r.approvalId, tips: r.tips } as Prisma.InputJsonValue, createdAt: new Date(now.getTime() + 1) },
    });
    return { id: m.id, role: 'AGENT', by: AGENT_NAME, body: m.body, data: m.data, at: m.createdAt };
  }

  private run(i: Intent, actor: Actor, brandId: string, now: Date): Promise<Reply> {
    switch (i.kind) {
      case 'help':
        return Promise.resolve(this.help());
      case 'pending':
        return this.pending(brandId, now, i.vendor);
      case 'ageing':
        return this.ageing(brandId, now);
      case 'chase':
        return this.chase(brandId, actor, now, i.courier, i.refs);
      case 'status':
        return this.status(brandId, now, i.refs);
      case 'book':
        return this.book(brandId, now, i.refs, i.allNew);
      case 'switch':
        return this.proposeSwitch(brandId, actor, now, i.courier, i.vendor);
      case 'credit':
        return this.credit(brandId, actor, now, i);
      case 'lists':
        return this.sendLists(brandId, now, true);
      default:
        return Promise.resolve({
          body: "I didn't get that. Try one of these:",
          tips: ["What's pending today?", 'Chase Delhivery', 'Where is 1042?', 'Book all new orders', 'Switch Ekart at Star India', 'Credit ₹1,788 from Delhivery by Friday'],
        });
    }
  }

  private help(): Reply {
    return {
      body: 'I chase couriers and vendors so nobody has to. Tell me in plain words:',
      tips: [
        "What's pending today?",
        'Show ageing shipments',
        'Chase all stuck pickups',
        'Chase Delhivery',
        'Where is 1042?',
        'Book all new orders',
        'Switch Ekart at Star India',
        'Credit ₹1,788 from Delhivery by Friday',
        'Send the 9 am lists now',
      ],
    };
  }

  // ---------- What is pending ----------

  private async findCourier(word?: string) {
    if (!word) return null;
    const all = await this.prisma.courier.findMany();
    const w = word.replace(/\s/g, '').toLowerCase();
    return all.find((c) => c.code.toLowerCase() === w || c.name.toLowerCase().replace(/\s/g, '').includes(w)) ?? null;
  }

  private async findVendor(brandId: string, word?: string) {
    if (!word) return null;
    const all = await this.prisma.warehouse.findMany({ where: { brandId } });
    const w = word.toLowerCase().trim();
    return all.find((v) => v.code.toLowerCase() === w || v.name.toLowerCase().includes(w) || w.includes(v.name.toLowerCase())) ?? null;
  }

  /** Parcels booked but not picked up for more than a working day: the 6-to-10-day problem. */
  private unpicked(brandId: string, now: Date, warehouseId?: string) {
    return this.prisma.shipment.findMany({
      where: { brandId, status: { in: ['BOOKED', 'PICKUP_SCHEDULED'] }, createdAt: { lte: new Date(now.getTime() - AGEING_HOURS * HOUR) }, ...(warehouseId ? { order: { pickupWarehouseId: warehouseId } } : {}) },
      include: { order: { include: { pickupWarehouse: true } }, courier: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** In transit past the promised delivery date. */
  private lateInTransit(brandId: string, now: Date) {
    return this.prisma.shipment.findMany({
      where: { brandId, status: { in: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'NDR'] }, expectedDelivery: { lt: now } },
      include: { order: true, courier: true },
      orderBy: { expectedDelivery: 'asc' },
    });
  }

  private async pending(brandId: string, now: Date, vendorWord?: string): Promise<Reply> {
    const vendor = await this.findVendor(brandId, vendorWord);
    const endOfDay = new Date(now.getTime() + DAY);
    const [pickups, unpicked, late, flags, newOrders] = await Promise.all([
      this.prisma.pickup.findMany({
        where: { brandId, status: { in: ['SCHEDULED', 'CONFIRMED', 'MISSED'] }, slotStart: { lte: endOfDay }, parcelCount: { gt: 0 }, ...(vendor ? { warehouseId: vendor.id } : {}) },
        include: { courier: true, warehouse: true },
        orderBy: { slotStart: 'asc' },
      }),
      this.unpicked(brandId, now, vendor?.id),
      vendor ? Promise.resolve([]) : this.lateInTransit(brandId, now),
      this.prisma.redFlag.findMany({ where: { brandId, resolvedAt: null }, select: { id: true, type: true, waitingOn: true, promiseAt: true, title: true } }),
      vendor ? Promise.resolve(0) : this.prisma.order.count({ where: { brandId, status: 'NEW' } }),
    ]);
    const waiting = (p: Party) => flags.filter((f) => (f.waitingOn ?? 'OURS') === p).length;
    const brokenPromises = flags.filter((f) => f.promiseAt && f.promiseAt < now).length;
    const moneyCases = flags.filter((f) => groupOf(f.type) === 'MONEY');
    const total = pickups.length + unpicked.length + late.length + waiting('COURIER') + waiting('VENDOR');
    const groups: Reply['groups'] = [];
    if (pickups.length)
      groups.push({
        title: `Pickups due (${pickups.length})`,
        items: pickups.slice(0, 8).map((p) => ({
          label: `${p.courier.name} at ${p.warehouse.name}`,
          sub: `${slotLabel(p.slotStart)} · ${plural(p.parcelCount, 'parcel')} · ${p.status === 'CONFIRMED' ? `${p.executiveName ?? 'executive'} confirmed` : p.status === 'MISSED' ? 'missed' : 'not confirmed yet'}`,
          tone: p.status === 'MISSED' ? 'red' : p.status === 'CONFIRMED' ? 'green' : 'amber',
          href: '/pickups',
        })),
      });
    if (unpicked.length) groups.push({ title: `Not picked up after 1 day (${unpicked.length})`, items: this.byCourierVendor(unpicked, now).slice(0, 8) });
    if (late.length)
      groups.push({
        title: `Late in transit (${late.length})`,
        items: late.slice(0, 6).map((s) => ({ label: `#${s.order.orderNumber} · ${s.courier.name}`, sub: `${s.awb} · ${Math.ceil((now.getTime() - s.expectedDelivery!.getTime()) / DAY)}d past delivery date`, tone: 'red', href: `/orders/${s.orderId}` })),
      });
    const people: Item[] = [];
    if (waiting('COURIER')) people.push({ label: `${plural(waiting('COURIER'), 'issue')} waiting on couriers`, tone: 'amber', href: '/issues?waiting=COURIER' });
    if (waiting('VENDOR')) people.push({ label: `${plural(waiting('VENDOR'), 'issue')} waiting on vendors`, tone: 'amber', href: '/issues?waiting=VENDOR' });
    if (waiting('OURS')) people.push({ label: `${plural(waiting('OURS'), 'issue')} waiting on us`, tone: 'blue', href: '/issues?waiting=OURS' });
    if (brokenPromises) people.push({ label: `${plural(brokenPromises, 'promise')} past their time`, tone: 'red', href: '/issues' });
    if (moneyCases.length) people.push({ label: `${plural(moneyCases.length, 'money case')} open`, tone: 'blue', href: '/issues?group=MONEY' });
    if (newOrders) people.push({ label: `${plural(newOrders, 'new order')} not booked`, sub: 'Say "book all new orders"', tone: 'grey', href: '/orders' });
    if (people.length) groups.push({ title: 'Waiting on people', items: people });
    const body = total + newOrders === 0
      ? `Nothing pending${vendor ? ` at ${vendor.name}` : ''}. Every pickup is on time and nobody owes us an answer.`
      : `${vendor ? `${vendor.name}: ` : ''}${plural(pickups.length, 'pickup')} due, ${plural(unpicked.length, 'parcel')} not picked up after a day${late.length ? `, ${late.length} late in transit` : ''}. ${unpicked.length || waiting('COURIER') ? 'Say "chase all" and I will message every courier now.' : ''}`.trim();
    return { body, groups };
  }

  /** Unpicked parcels grouped by courier and vendor, oldest first, with the days they have waited. */
  private byCourierVendor(list: Awaited<ReturnType<AgentService['unpicked']>>, now: Date): Item[] {
    const g = new Map<string, { courier: string; vendor: string; n: number; oldest: Date; value: number; cod: number }>();
    for (const s of list) {
      const k = `${s.courierCode}:${s.order.pickupWarehouseId}`;
      const e = g.get(k) ?? { courier: s.courier.name, vendor: s.order.pickupWarehouse.name, n: 0, oldest: s.createdAt, value: 0, cod: 0 };
      e.n++;
      e.value += Number(s.order.orderValue);
      e.cod += Number(s.order.codAmount);
      if (s.createdAt < e.oldest) e.oldest = s.createdAt;
      g.set(k, e);
    }
    return [...g.values()]
      // Most money held up first: that is the order to chase in.
      .sort((a, b) => b.value - a.value || a.oldest.getTime() - b.oldest.getTime())
      .map((e) => {
        const days = Math.floor((now.getTime() - e.oldest.getTime()) / DAY);
        return { label: `${e.courier} at ${e.vendor}`, sub: `${plural(e.n, 'parcel')} · ${money(e.value)} held up${e.cod ? ` · ${money(e.cod)} COD` : ''}`, days, tone: days >= 3 ? 'red' : 'amber', href: '/pickups' };
      });
  }

  private async ageing(brandId: string, now: Date): Promise<Reply> {
    const [unpicked, late] = await Promise.all([this.unpicked(brandId, now), this.lateInTransit(brandId, now)]);
    if (!unpicked.length && !late.length) return { body: 'No ageing shipments. Every parcel was picked up within a day and nothing is past its delivery date.' };
    const buckets = [
      { title: '1–2 days', min: 1, max: 3 },
      { title: '3–5 days', min: 3, max: 6 },
      { title: '6+ days', min: 6, max: 999 },
    ];
    const age = (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);
    const oldest = unpicked[0] ? age(unpicked[0].createdAt) : 0;
    return {
      body: `${plural(unpicked.length, 'parcel')} not picked up${oldest ? `, the oldest for ${plural(oldest, 'day')}` : ''}. ${plural(late.length, 'parcel')} past the delivery date. Say "chase all" and I will message every courier with their list.`,
      groups: [
        ...buckets
          .map((b) => ({ title: `Not picked up · ${b.title}`, items: this.byCourierVendor(unpicked.filter((s) => age(s.createdAt) >= b.min && age(s.createdAt) < b.max), now) }))
          .filter((g) => g.items.length),
        ...(late.length
          ? [{ title: 'Past delivery date', items: late.slice(0, 10).map((s) => ({ label: `#${s.order.orderNumber} · ${s.courier.name}`, sub: `${s.awb} · ${s.order.city}`, days: age(s.expectedDelivery!), tone: 'red' as const, href: `/orders/${s.orderId}` })) }]
          : []),
      ],
    };
  }

  // ---------- Chasing ----------

  /**
   * Messages every courier or vendor who owes us an answer, and opens an issue
   * for each ageing pickup nobody has raised yet (which messages its courier
   * at once). People with a promise still in time are left alone.
   */
  private async chase(brandId: string, actor: Actor, now: Date, courierWord: string | undefined, refs: string[]): Promise<Reply> {
    const courier = await this.findCourier(courierWord);
    if (courierWord && !courier) throw new BadRequestException(`No courier called ${courierWord}`);
    const me = { id: actor.id, name: AGENT_NAME, role: actor.role };
    let shipmentIds: string[] | null = null;
    if (refs.length) {
      const s = await this.prisma.shipment.findMany({ where: { brandId, OR: [{ awb: { in: refs } }, { order: { orderNumber: { in: refs } } }] }, select: { id: true } });
      if (!s.length) throw new BadRequestException(`I found no shipment for ${refs.join(', ')}`);
      shipmentIds = s.map((x) => x.id);
    }

    // 1. Ageing pickups nobody has raised: open one issue per pickup (the courier hears at once).
    let opened = 0;
    const unpicked = (await this.unpicked(brandId, now)).filter((s) => (!courier || s.courierCode === courier.code) && (!shipmentIds || shipmentIds.includes(s.id)));
    const pickupIds = [...new Set(unpicked.map((s) => s.pickupId).filter(Boolean) as string[])];
    for (const pickupId of pickupIds.slice(0, CHASE_CAP)) {
      const open = await this.prisma.redFlag.findFirst({ where: { brandId, pickupId, resolvedAt: null } });
      if (open) continue;
      const n = unpicked.filter((s) => s.pickupId === pickupId);
      const days = Math.floor((now.getTime() - n[0].createdAt.getTime()) / DAY);
      await this.issues.raise({ type: 'PICKUP_PENDING', pickupId, body: `${plural(n.length, 'parcel')} booked ${plural(days, 'day')} ago at ${n[0].order.pickupWarehouse.name} are still not picked up. Give a name and a time for the pickup today.` }, me, now);
      opened++;
    }

    // 2. Open issues waiting on a courier or vendor, with no promise still in time: ask again now.
    const where: Prisma.RedFlagWhereInput = {
      brandId,
      resolvedAt: null,
      waitingOn: { in: ['COURIER', 'VENDOR'] },
      OR: [{ promiseAt: null }, { promiseAt: { lt: now } }],
      ...(courier ? { AND: [{ OR: [{ courierCode: courier.code }, { shipment: { courierCode: courier.code } }, { pickup: { courierCode: courier.code } }] }] } : {}),
      ...(shipmentIds ? { shipmentId: { in: shipmentIds } } : {}),
      // Not the ones just opened above: they were messaged a moment ago.
      createdAt: { lt: now },
    };
    const flags = await this.prisma.redFlag.findMany({ where, include: { pickup: { include: { courier: true, warehouse: true } }, shipment: { include: { courier: true, order: true } } }, orderBy: { waitingSince: 'asc' }, take: CHASE_CAP });
    const asked: Item[] = [];
    for (const f of flags) {
      const party = f.waitingOn as 'COURIER' | 'VENDOR';
      const waited = f.waitingSince ? Math.max(1, Math.round((now.getTime() - f.waitingSince.getTime()) / HOUR)) : 0;
      const what = f.pickup ? `${f.pickup.courier.name} pickup at ${f.pickup.warehouse.name}` : f.shipment ? `order #${f.shipment.order.orderNumber} (${f.shipment.awb})` : f.title;
      const body = f.promiseAt
        ? `You promised ${what} by ${timeLabel(f.promiseAt, now)}. That time has passed. Give a new time or the result.`
        : `Still waiting on ${what}, ${waitedLabel(waited)} now. Reply with a name and a time, or the result.`;
      try {
        await this.issues.act(f.id, { kind: 'ask', party, body }, me, now);
        asked.push({ label: what, sub: `${PARTY_LABEL[party]} · waited ${waitedLabel(waited)}`, tone: f.promiseAt ? 'red' : 'amber', href: `/issues/${f.id}` });
      } catch (e) {
        this.log.warn(`Chase ${f.id}: ${(e as Error).message}`);
      }
    }
    const actions = opened + asked.length;
    if (!actions) return { body: `Nobody to chase${courier ? ` at ${courier.name}` : ''}. Everyone has answered or has a promise still in time.` };
    return {
      body: `Done. ${opened ? `Opened ${plural(opened, 'pickup issue')} and messaged the courier. ` : ''}${asked.length ? `Asked ${plural(asked.length, 'person', 'people')} again. ` : ''}I'll check back on the clock and escalate to their manager if they stay quiet.`,
      items: asked.slice(0, 12),
      actions,
    };
  }

  private async status(brandId: string, now: Date, refs: string[]): Promise<Reply> {
    const list = await this.prisma.shipment.findMany({
      where: { brandId, status: { not: 'CANCELLED' }, OR: [{ awb: { in: refs } }, { order: { orderNumber: { in: refs } } }] },
      include: { order: true, courier: true, pickup: true, redFlags: { where: { resolvedAt: null } }, events: { orderBy: { occurredAt: 'desc' }, take: 1 } },
      take: 10,
    });
    if (!list.length) {
      const orders = await this.prisma.order.findMany({ where: { brandId, orderNumber: { in: refs } } });
      if (orders.length) return { body: `${orders.map((o) => `#${o.orderNumber}`).join(', ')} ${orders.length === 1 ? 'is' : 'are'} not booked yet. Say "book ${orders.map((o) => o.orderNumber).join(' ')}".`, items: orders.map((o) => ({ label: `#${o.orderNumber}`, sub: `${o.customerName} · ${o.city}`, tone: 'grey', href: `/orders/${o.id}` })) };
      return { body: `I found nothing for ${refs.join(', ')}. Check the order number or AWB.` };
    }
    return {
      body: list.length === 1 ? this.oneStatus(list[0], now) : `${list.length} shipments:`,
      items: list.map((s) => ({
        label: `#${s.order.orderNumber} · ${s.courier.name} · ${s.status.replace(/_/g, ' ').toLowerCase()}`,
        sub: `${s.awb} · ${s.events[0] ? `${s.events[0].location ?? ''} ${s.events[0].occurredAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`.trim() : 'no scan yet'}${s.redFlags.length ? ` · ${plural(s.redFlags.length, 'open issue')}` : ''}`,
        tone: s.status === 'DELIVERED' ? 'green' : s.redFlags.length ? 'red' : 'blue',
        href: `/orders/${s.orderId}`,
      })),
    };
  }

  private oneStatus(s: { status: string; courier: { name: string }; order: { orderNumber: string; city: string }; expectedDelivery: Date | null; createdAt: Date; redFlags: unknown[] }, now: Date) {
    const st = s.status.replace(/_/g, ' ').toLowerCase();
    const due = s.expectedDelivery ? ` Delivery date ${s.expectedDelivery.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}${s.expectedDelivery < now && s.status !== 'DELIVERED' ? ', already passed' : ''}.` : '';
    const waiting = ['BOOKED', 'PICKUP_SCHEDULED'].includes(s.status) ? ` Booked ${plural(Math.floor((now.getTime() - s.createdAt.getTime()) / DAY), 'day')} ago.` : '';
    return `#${s.order.orderNumber} to ${s.order.city} is ${st} with ${s.courier.name}.${waiting}${due}${s.redFlags.length ? ` ${plural(s.redFlags.length, 'issue')} open.` : ''}`;
  }

  // ---------- Booking ----------

  private async book(brandId: string, now: Date, refs: string[], allNew: boolean): Promise<Reply> {
    if (!refs.length && !allNew) return { body: 'Which orders? Say "book all new orders" or give the order numbers.' };
    const orders = await this.prisma.order.findMany({
      where: { brandId, status: 'NEW', ...(refs.length ? { orderNumber: { in: refs } } : {}), shipments: { none: { status: { not: 'CANCELLED' } } } },
      include: { pickupWarehouse: true },
      orderBy: { createdAt: 'asc' },
      take: BOOK_CAP,
    });
    if (!orders.length) return { body: refs.length ? `${refs.join(', ')}: nothing to book. They are booked already or not in Orders.` : 'No new orders to book.' };
    const rows = orders.map((o) => {
      const items = (Array.isArray(o.items) ? o.items : []) as Array<{ name?: string }>;
      return {
        orderNumber: o.orderNumber,
        productBrand: o.productBrand ?? undefined,
        productName: items[0]?.name?.slice(0, 120),
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        addressLine: o.addressLine,
        city: o.city || undefined,
        state: o.state || undefined,
        pincode: o.pincode,
        warehouseCode: o.pickupWarehouse.code,
        paymentMode: o.paymentMode,
        orderValue: Number(o.orderValue),
        codAdvance: Number(o.codAdvance) || undefined,
        weightGrams: o.weightGrams,
        lengthCm: o.lengthCm,
        breadthCm: o.breadthCm,
        heightCm: o.heightCm,
      };
    });
    const r = await this.shipments.bulk({ batchKey: `agent-${now.getTime().toString(36)}`, rows }, now);
    const ok = r.results.filter((x) => x.ok);
    const bad = r.results.filter((x) => !x.ok);
    return {
      body: `Booked ${plural(ok.length, 'order')}${bad.length ? `, ${bad.length} could not be booked` : ''}. Each went with the recommended courier and the earliest pickup slot.`,
      items: [
        ...ok.slice(0, 12).map((x) => ({ label: `#${x.orderNumber} · ${x.courier}`, sub: x.awb, tone: 'green' as const })),
        ...bad.map((x) => ({ label: `#${x.orderNumber}`, sub: x.error, tone: 'red' as const })),
      ],
      actions: ok.length,
    };
  }

  // ---------- Asks before acting: switching courier ----------

  private async proposeSwitch(brandId: string, actor: Actor, now: Date, courierWord?: string, vendorWord?: string): Promise<Reply> {
    const courier = await this.findCourier(courierWord);
    const vendor = await this.findVendor(brandId, vendorWord);
    if (!courier && !vendor) return { body: 'Which pickup? Say for example "switch Ekart at Star India".' };
    const p = await this.prisma.pickup.findFirst({
      where: { brandId, status: { in: ['SCHEDULED', 'CONFIRMED', 'MISSED'] }, parcelCount: { gt: 0 }, ...(courier ? { courierCode: courier.code } : {}), ...(vendor ? { warehouseId: vendor.id } : {}) },
      include: { courier: true, warehouse: true, _count: { select: { shipments: { where: { status: { in: ['BOOKED', 'PICKUP_SCHEDULED'] } } } } } },
      orderBy: { slotStart: 'asc' },
    });
    if (!p || !p._count.shipments) return { body: `No open pickup${courier ? ` with ${courier.name}` : ''}${vendor ? ` at ${vendor.name}` : ''} to switch.` };
    const summary = `Move ${plural(p._count.shipments, 'parcel')} at ${p.warehouse.name} from ${p.courier.name} to the most reliable courier for each address, and cancel the ${p.courier.name} booking.`;
    const a = await this.prisma.agentApproval.create({ data: { brandId, kind: 'SWITCH_COURIER', params: { pickupId: p.id }, summary, requestedBy: actor.id, createdAt: now } });
    return { body: `This changes bookings, so I need your OK. ${summary}`, approvalId: a.id };
  }

  async decide(id: string, confirm: boolean, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const a = await this.prisma.agentApproval.findFirst({ where: { id, brandId } });
    if (!a) throw new NotFoundException('Request not found');
    if (a.status !== 'PENDING') throw new BadRequestException('This was already decided');
    if (!confirm) {
      await this.prisma.agentApproval.update({ where: { id }, data: { status: 'CANCELLED', decidedBy: actor.id, decidedAt: now } });
      return this.say(brandId, { body: `Cancelled by ${actor.name}. Nothing was changed.` }, now);
    }
    // Claim it first, so a double click cannot switch twice.
    const claimed = await this.prisma.agentApproval.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'RUNNING', decidedBy: actor.id, decidedAt: now } });
    if (!claimed.count) throw new BadRequestException('This was already decided');
    try {
      const params = a.params as { pickupId: string };
      const r = await this.pickups.switchCourier(params.pickupId, `Approved by ${actor.name} via ${AGENT_NAME}`, { id: actor.id, name: actor.name }, now);
      const result = `Moved from ${r.from} to ${r.to}, pickup ${r.slot}. The old booking was cancelled.`;
      await this.prisma.agentApproval.update({ where: { id }, data: { status: 'DONE', result } });
      return this.say(brandId, { body: `${actor.name} approved. ${result}`, actions: 1 }, now);
    } catch (e) {
      await this.prisma.agentApproval.update({ where: { id }, data: { status: 'FAILED', result: (e as Error).message } });
      return this.say(brandId, { body: `The switch failed: ${(e as Error).message}. Nothing else was changed.` }, now);
    }
  }

  // ---------- Money cases ----------

  private async credit(brandId: string, actor: Actor, now: Date, i: Extract<Intent, { kind: 'credit' }>): Promise<Reply> {
    const courier = await this.findCourier(i.courier);
    if (!courier) return { body: `Which courier owes the ${money(i.amount)}? Say for example "credit ${money(i.amount)} from Delhivery by Friday".` };
    const by = i.by && i.by > now ? i.by : null;
    const d = await this.issues.raise(
      { type: 'CREDIT_NOTE_PENDING', title: `${money(i.amount)} credit pending from ${courier.name}`, courierCode: courier.code, body: `${courier.name} owes us ${money(i.amount)}. ${i.note}`.slice(0, 2000), promiseAt: by ?? undefined },
      { id: actor.id, name: AGENT_NAME, role: actor.role },
      now,
    );
    return {
      body: `Opened a money case: ${money(i.amount)} from ${courier.name}${by ? `, due ${timeLabel(by, now)}` : ''}. I messaged their account manager and will chase until the credit note reference is in. It closes only with that reference.`,
      items: [{ label: `${money(i.amount)} · ${courier.name}`, sub: 'Credit note pending', tone: 'blue', href: `/issues/${(d as { id: string }).id}` }],
      actions: 1,
    };
  }

  // ---------- Routines: 9 am and 6 pm pending lists ----------

  /** Runs every minute from the job loop; sends each list once, inside its hour. */
  async routines(now = new Date()) {
    const h = Math.floor(istHour(now));
    if (h === SUMMARY_HOUR) return this.daySummary(now);
    if (!(ROUTINE_HOURS as readonly number[]).includes(h) || closedReason(now)) return null;
    const brandId = await this.brands.currentBrandId();
    const key = `lists:${istDateKey(now)}:${h}`;
    const done = await this.prisma.agentMessage.findFirst({ where: { brandId, role: 'AGENT', data: { path: ['routine'], equals: key } } });
    if (done) return null;
    return this.sendLists(brandId, now, false, key);
  }

  /**
   * 7 pm: who answered today, who stayed silent, and the money still held up,
   * so the founder knows where to push tomorrow without reading every issue.
   */
  async daySummary(now = new Date(), force = false) {
    const brandId = await this.brands.currentBrandId();
    const key = `summary:${istDateKey(now)}`;
    if (!force && (await this.prisma.agentMessage.findFirst({ where: { brandId, role: 'AGENT', data: { path: ['routine'], equals: key } } }))) return null;
    const since = new Date(now.getTime() - istHour(now) * HOUR);
    const [replies, silent, unpicked, late, closed] = await Promise.all([
      this.prisma.issueEvent.findMany({ where: { flag: { brandId }, kind: 'PARTNER_REPLY', createdAt: { gte: since } }, select: { actorName: true } }),
      this.prisma.redFlag.findMany({
        where: { brandId, resolvedAt: null, waitingOn: { in: ['COURIER', 'VENDOR'] }, reminderCount: { gt: 0 } },
        include: { courierContact: true, pickup: { include: { courier: true, warehouse: true } }, shipment: { include: { courier: true } } },
      }),
      this.unpicked(brandId, now),
      this.lateInTransit(brandId, now),
      this.prisma.redFlag.count({ where: { brandId, resolvedAt: { gte: since } } }),
    ]);
    const who = new Map<string, number>();
    for (const r of replies) who.set(r.actorName, (who.get(r.actorName) ?? 0) + 1);
    const quiet = new Map<string, number>();
    const couriers = new Map((await this.prisma.courier.findMany()).map((c) => [c.code, c.name]));
    for (const f of silent) {
      const code = f.pickup?.courierCode ?? f.shipment?.courierCode ?? f.courierCode ?? f.courierContact?.courierCode;
      const name = f.waitingOn === 'VENDOR' ? (f.pickup?.warehouse.name ?? 'Vendors') : ((code && couriers.get(code)) ?? 'Courier not set');
      quiet.set(name, (quiet.get(name) ?? 0) + 1);
    }
    const held = [...unpicked, ...late].reduce((n, s) => n + Number(s.order.orderValue), 0);
    const reply: Reply = {
      body: `Today: ${plural(closed, 'issue')} solved, ${plural(replies.length, 'reply', 'replies')} from partners, ${plural(silent.length, 'issue')} still ignored. ${money(held)} of orders held up (${unpicked.length} not picked up, ${late.length} late).`,
      groups: [
        ...(quiet.size ? [{ title: 'Still silent after reminders', items: [...quiet].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ label: n, sub: plural(c, 'issue'), tone: 'red' as const, href: '/issues?waiting=COURIER' })) }] : []),
        ...(who.size ? [{ title: 'Answered today', items: [...who].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => ({ label: n, sub: plural(c, 'reply', 'replies'), tone: 'green' as const })) }] : []),
      ],
    };
    // Asked for by a person, it is not the 7 pm run: the 7 pm summary still goes out.
    return this.say(brandId, reply, now, force ? { intent: 'summary' } : { routine: key, intent: 'summary' });
  }

  /** The Chase button on an issue: ask whoever owes the answer, right now. */
  async chaseIssue(id: string, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const f = await this.prisma.redFlag.findFirst({ where: { id, brandId, resolvedAt: null }, include: { pickup: { include: { courier: true, warehouse: true } }, shipment: { include: { order: true } } } });
    if (!f) throw new NotFoundException('Open issue not found');
    if (f.waitingOn !== 'COURIER' && f.waitingOn !== 'VENDOR') throw new BadRequestException('This issue is waiting on us, not on a partner');
    const what = f.pickup ? `the ${f.pickup.courier.name} pickup at ${f.pickup.warehouse.name}` : f.shipment ? `order #${f.shipment.order.orderNumber} (${f.shipment.awb})` : f.title;
    const body = f.promiseAt && f.promiseAt < now ? `You promised ${what} by ${timeLabel(f.promiseAt, now)}. That time has passed. Give a new time or the result.` : `Following up on ${what}. Reply with a name and a time, or the result.`;
    await this.issues.act(id, { kind: 'ask', party: f.waitingOn, body }, { id: actor.id, name: AGENT_NAME, role: actor.role }, now);
    return this.say(brandId, { body: `${actor.name} asked me to chase ${what}. Message sent; I'll check back on the clock.`, items: [{ label: f.title, sub: PARTY_LABEL[f.waitingOn as Party], tone: 'amber', href: `/issues/${id}` }], actions: 1 }, now);
  }

  /**
   * One pending list per courier, to their pickup lead: every parcel waiting at
   * every vendor, with days, so they cannot say "nobody told us". Vendors get the
   * pickups due today.
   */
  private async sendLists(brandId: string, now: Date, manual: boolean, routine?: string): Promise<Reply> {
    const slot = istHour(now) < 14 ? '9 am' : '6 pm';
    const [unpicked, due] = await Promise.all([
      this.unpicked(brandId, now),
      this.prisma.pickup.findMany({
        where: { brandId, status: { in: ['SCHEDULED', 'MISSED'] }, parcelCount: { gt: 0 }, slotStart: { lte: new Date(now.getTime() + DAY) } },
        include: { courier: true, warehouse: true },
      }),
    ]);
    const byCourier = new Map<string, { name: string; lines: string[]; parcels: number }>();
    for (const s of unpicked) {
      const c = byCourier.get(s.courierCode) ?? { name: s.courier.name, lines: [], parcels: 0 };
      c.parcels++;
      byCourier.set(s.courierCode, c);
    }
    for (const [code, c] of byCourier) {
      const here = unpicked.filter((s) => s.courierCode === code);
      c.lines = this.byCourierVendor(here, now).map((i) => `${i.label.split(' at ')[1]}: ${i.sub?.split(' · ')[0]}, waiting ${plural(i.days ?? 0, 'day')}`);
    }
    for (const p of due) {
      const c = byCourier.get(p.courierCode) ?? { name: p.courier.name, lines: [], parcels: 0 };
      if (!c.lines.some((l) => l.startsWith(p.warehouse.name))) c.lines.push(`${p.warehouse.name}: ${plural(p.parcelCount, 'parcel')}, pickup ${slotLabel(p.slotStart)}`);
      c.parcels += unpicked.some((s) => s.pickupId === p.id) ? 0 : p.parcelCount;
      byCourier.set(p.courierCode, c);
    }
    const sent: Item[] = [];
    for (const [code, c] of byCourier) {
      const contacts = await this.prisma.courierContact.findMany({ where: { brandId, courierCode: code, active: true } });
      const to = contacts.find((x) => x.role === 'PICKUP_LEAD') ?? contacts.find((x) => x.role === 'ACCOUNT_MANAGER') ?? contacts[0];
      if (!to) {
        sent.push({ label: c.name, sub: 'No contact added: add one in Settings', tone: 'red', href: '/settings' });
        continue;
      }
      await this.alerts.notify({
        brandId,
        phone: to.phone,
        name: to.name,
        kind: 'AGENT_LIST',
        title: `${slot} pending list: ${plural(c.parcels, 'parcel')} to pick up`,
        body: `${c.lines.join('\n')}\nConfirm each pickup with a name and a time in the app.`,
        link: '/p',
        dedupeKey: `agent-list:${code}:${routine ?? now.getTime()}`,
        now,
      });
      sent.push({ label: `${c.name} → ${to.name}`, sub: `${plural(c.parcels, 'parcel')} · ${plural(c.lines.length, 'vendor')}`, tone: 'blue' });
    }
    const reply: Reply = sent.length
      ? { body: `${manual ? 'Sent' : `${slot} round: sent`} the pending list to ${plural(sent.filter((s) => s.tone !== 'red').length, 'courier')}. Each one sees every parcel waiting, with days.`, items: sent, actions: sent.filter((s) => s.tone !== 'red').length }
      : { body: `${manual ? '' : `${slot} round: `}nothing pending, so no lists were needed.` };
    if (routine) await this.say(brandId, reply, now, { routine, intent: 'lists' });
    return reply;
  }

  // ---------- Inbound: a courier or vendor replies (WhatsApp Business webhook seam) ----------

  /**
   * A reply from a courier or vendor's phone: matched to the issue waiting on
   * them, read for "done", a time, or a message, and logged in the issue room.
   * Returns the text to send back to them.
   */
  async inbound(phoneRaw: string, text: string, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const phone = phoneRaw.replace(/\D/g, '').slice(-10);
    const done = /^\s*(1|done|ok done|picked|picked up|delivered|ho gaya|hogaya|completed|ready)\b/i.test(text);
    const at = done ? null : parseWhen(text, now);
    const contact = await this.prisma.courierContact.findFirst({ where: { brandId, phone, active: true } });
    if (contact) {
      const courier = await this.prisma.courier.findUnique({ where: { code: contact.courierCode } });
      const f = await this.prisma.redFlag.findFirst({
        where: { brandId, resolvedAt: null, waitingOn: 'COURIER', OR: [{ courierContactId: contact.id }, { courierCode: contact.courierCode }, { shipment: { courierCode: contact.courierCode } }, { pickup: { courierCode: contact.courierCode } }] },
        orderBy: [{ lastReminderAt: { sort: 'desc', nulls: 'last' } }, { waitingSince: 'asc' }],
      });
      if (!f) return this.noIssue(brandId, `${contact.name} (${courier?.name})`, text, now);
      const user = await this.prisma.user.findFirst({ where: { brandId, phone, active: true } });
      const kind = done ? 'DONE' : at ? 'PROMISE' : 'MESSAGE';
      await this.issues.courierAnswer(f.id, { kind, body: text.length >= 2 ? text : `Done (${text})`, promiseAt: at ?? undefined }, { id: user?.id ?? contact.id, name: contact.name, courierCode: contact.courierCode }, now);
      return this.logged(brandId, f.id, f.title, `${contact.name} (${courier?.name})`, kind, text, at, now);
    }
    const vendor = await this.prisma.warehouse.findFirst({ where: { brandId, contactPhone: phone } });
    if (vendor) {
      const f = await this.prisma.redFlag.findFirst({
        where: { brandId, resolvedAt: null, waitingOn: 'VENDOR', OR: [{ pickup: { warehouseId: vendor.id } }, { shipment: { order: { pickupWarehouseId: vendor.id } } }] },
        orderBy: { waitingSince: 'asc' },
      });
      if (!f) return this.noIssue(brandId, `${vendor.contactName} (${vendor.name})`, text, now);
      const kind = done ? 'READY' : at ? 'NOT_READY' : 'MESSAGE';
      await this.issues.vendorReply(f.id, { kind, body: text, promiseAt: at ?? undefined }, { id: `vendor:${vendor.id}`, name: vendor.contactName, role: 'VENDOR', warehouseId: vendor.id }, now);
      return this.logged(brandId, f.id, f.title, `${vendor.contactName} (${vendor.name})`, kind === 'READY' ? 'DONE' : kind === 'NOT_READY' ? 'PROMISE' : 'MESSAGE', text, at, now);
    }
    return { known: false, reply: 'This number is not on our list. Please ask our team to add you.' };
  }

  private async noIssue(brandId: string, who: string, text: string, now: Date) {
    await this.say(brandId, { body: `${who} wrote: "${text.slice(0, 300)}". Nothing is waiting on them, so I kept it here for the team.` }, now, { inbound: true });
    return { known: true, reply: 'Thank you. Nothing is pending with you right now; our team has your message.' };
  }

  private async logged(brandId: string, flagId: string, title: string, who: string, kind: 'DONE' | 'PROMISE' | 'MESSAGE', text: string, at: Date | null, now: Date) {
    const what = kind === 'DONE' ? 'says it is done. I will close it when the scan shows it' : kind === 'PROMISE' ? `promised ${timeLabel(at!, now)}. No reminders until then; I check at that time` : 'replied. Your turn to answer';
    await this.say(brandId, { body: `${who} ${what}.`, items: [{ label: title, sub: `"${text.slice(0, 140)}"`, tone: kind === 'MESSAGE' ? 'blue' : kind === 'DONE' ? 'green' : 'amber', href: `/issues/${flagId}` }], actions: 1 }, now, { inbound: true });
    return {
      known: true,
      flagId,
      kind,
      reply: kind === 'DONE' ? 'Noted as done. Thank you.' : kind === 'PROMISE' ? `Noted: ${timeLabel(at!, now)}. Thank you.` : 'Noted. Our team will answer here.',
    };
  }

  // ---------- What the agent did today ----------

  async stats(now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const since = new Date(now.getTime() - (istHour(now) * HOUR));
    const [msgs, nudges, promises, approvals] = await Promise.all([
      this.prisma.agentMessage.findMany({ where: { brandId, role: 'AGENT', createdAt: { gte: since } }, select: { data: true } }),
      // Reminders and asks the engine sent by itself today count as agent work too.
      this.prisma.issueEvent.count({ where: { flag: { brandId }, kind: { in: ['REMINDER', 'ESCALATED'] }, createdAt: { gte: since } } }),
      this.prisma.redFlag.count({ where: { brandId, resolvedAt: null, promiseAt: { gt: now } } }),
      this.prisma.agentApproval.count({ where: { brandId, status: 'PENDING' } }),
    ]);
    const actions = msgs.reduce((n, m) => n + Number((m.data as { actions?: number } | null)?.actions ?? 0), 0) + nudges;
    return { actions, minutesSaved: actions * MINUTES_PER_ACTION, promisesWatched: promises, approvalsWaiting: approvals };
  }
}
