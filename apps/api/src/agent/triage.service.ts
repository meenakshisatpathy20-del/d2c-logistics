import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BrandService } from '../common/brand.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { groupOf, RAISED } from '../issues/issue-rules.js';
import { IssuesService } from '../issues/issues.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AGENT_NAME } from './agent.service.js';
import { llmTriage } from './llm.js';
import { type ChatLine, cleanName, looksLikeAwb, parseChat, type Party, read, type Reading, typeForStatus } from './triage.js';
import { timeLabel } from './when.js';

const HOUR = 3600_000;
const MAX_MESSAGES = 600;

export const TriageSchema = z.object({
  text: z.string().trim().min(2, 'Paste the chat or a message').max(500_000),
  courierCode: z.string().trim().toUpperCase().optional(),
  /** Names of our own people in this chat, if the app does not know them (e.g. "Sakshi, Meenakshi"). */
  ourNames: z.string().trim().max(400).optional(),
  source: z.enum(['PASTE', 'WHATSAPP_EXPORT']).optional(),
});
export const GroupMessageSchema = z.object({
  courierCode: z.string().trim().toUpperCase().optional(),
  sender: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(4000),
  at: z.coerce.date().optional(),
});

type Actor = { id: string; name: string; role: string };
type Ship = Prisma.ShipmentGetPayload<{ include: { order: true; courier: true } }>;
type Line = ChatLine & { party: Party };
export type TriageItem = { at: Date; sender: string; party: Party; text: string; kind: string; did: string[]; tone: 'red' | 'amber' | 'green' | 'blue' | 'grey'; href?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Agent 1 of the Resolve Hub: reads every message in a courier's WhatsApp
 * group (a chat export, a paste, or live from the WhatsApp bridge), finds the
 * AWBs, works out what is being asked, promised, claimed or owed, and files it
 * on the right case. Nobody has to retype a chat into the platform, and a
 * "by tomorrow" in a chat becomes a promise the chaser holds them to.
 */
@Injectable()
export class TriageService {
  private readonly log = new Logger(TriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
    private readonly issues: IssuesService,
  ) {}

  async triage(input: z.infer<typeof TriageSchema>, actor: Actor, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const courier = input.courierCode ? await this.prisma.courier.findUnique({ where: { code: input.courierCode } }) : null;
    if (input.courierCode && !courier) throw new BadRequestException(`No courier ${input.courierCode}`);
    const lines = parseChat(input.text, now, actor.name);
    if (!lines.length) throw new BadRequestException('No messages found in that text');
    if (lines.length > MAX_MESSAGES) throw new BadRequestException(`That is ${lines.length} messages. Export a shorter part of the chat (up to ${MAX_MESSAGES}).`);
    const source = input.source ?? (lines.length > 1 || lines[0].sender !== actor.name ? 'WHATSAPP_EXPORT' : 'PASTE');
    const ours = (input.ourNames ?? '').split(/[,\n]/).map((s) => cleanName(s).toLowerCase()).filter(Boolean);
    const who = await this.people(brandId, courier?.code ?? null, [...ours, actor.name.toLowerCase()]);
    return this.process(brandId, lines.map((l) => ({ ...l, party: who(l.sender) })), courier, source, actor, now);
  }

  /** One live message from the WhatsApp (or Telegram) bridge. */
  async groupMessage(m: z.infer<typeof GroupMessageSchema>, now = new Date()) {
    const brandId = await this.brands.currentBrandId();
    const courier = m.courierCode ? await this.prisma.courier.findUnique({ where: { code: m.courierCode } }) : null;
    const who = await this.people(brandId, courier?.code ?? null, []);
    const sender = cleanName(m.sender);
    // Cases it opens belong to the ops owner, as if they had filed them.
    const owner = await this.brands.ownerFor('OPS');
    if (!owner) throw new BadRequestException('No active ops team member to own the cases');
    return this.process(brandId, [{ sender, sentAt: m.at ?? now, body: m.text, party: who(sender) }], courier, 'WEBHOOK', { id: owner.id, name: owner.name, role: 'OPS' }, now);
  }

  /**
   * Who is who in the chat: our team (by name, or "D2C" in the name), the
   * courier's people (by the names in Settings), vendors. Anyone else in a
   * courier's group is taken to be the courier's side.
   */
  private async people(brandId: string, courierCode: string | null, ourNames: string[]) {
    const [team, contacts, vendors] = await Promise.all([
      this.prisma.user.findMany({ where: { brandId, active: true, role: { notIn: ['VENDOR', 'COURIER'] } }, select: { name: true } }),
      this.prisma.courierContact.findMany({ where: { brandId, active: true }, select: { name: true, phone: true } }),
      this.prisma.warehouse.findMany({ where: { brandId }, select: { contactName: true, contactPhone: true, name: true } }),
    ]);
    const first = (s: string) => cleanName(s).replace(/\(.*?\)/g, '').trim().split(' ')[0]?.toLowerCase() ?? '';
    const teamFirst = new Set([...team.map((u) => first(u.name)), ...ourNames.map(first)].filter((n) => n.length > 2 && !['ops', 'founder', 'support', 'finance'].includes(n)));
    const ourFull = new Set(ourNames);
    const courierFirst = new Set(contacts.map((c) => first(c.name)));
    const phones = new Map<string, Party>([...contacts.map((c) => [c.phone, 'COURIER'] as const), ...vendors.map((v) => [v.contactPhone, 'VENDOR'] as const)]);
    return (sender: string): Party => {
      const s = sender.toLowerCase();
      const digits = sender.replace(/\D/g, '').slice(-10);
      if (digits.length === 10 && phones.has(digits)) return phones.get(digits)!;
      if (ourFull.has(s) || /\bd2c\b|ecomnext|d2c ?mall/i.test(sender) || teamFirst.has(first(sender))) return 'OURS';
      if (vendors.some((v) => s.includes(v.name.toLowerCase()))) return 'VENDOR';
      if (courierFirst.has(first(sender))) return 'COURIER';
      return courierCode ? 'COURIER' : 'UNKNOWN';
    };
  }

  private async process(brandId: string, lines: Line[], courier: { code: string; name: string } | null, source: string, actor: Actor | null, now: Date) {
    const me = { id: actor?.id ?? 'agent', name: AGENT_NAME, role: actor?.role ?? 'OPS' };
    const items: TriageItem[] = [];
    const opened = new Set<string>();
    const updated = new Set<string>();
    const unmatchedAll = new Set<string>();
    let promises = 0;
    let skipped = 0;
    // A reply like "Aligned for tomorrow" names no AWB: it answers the last list in the chat.
    let context: { refs: string[]; at: Date } | null = await this.lastContext(brandId, courier?.code ?? null, lines[0]?.sentAt ?? now);

    for (const l of lines) {
      const hash = createHash('sha256').update(`${courier?.code ?? ''}|${l.sender}|${l.sentAt.toISOString()}|${l.body}`).digest('hex');
      if (await this.prisma.chatMessage.findUnique({ where: { brandId_hash: { brandId, hash } } })) {
        skipped++;
        const r0 = read(l.body, l.sentAt);
        if (r0.refs.length) context = { refs: r0.refs, at: l.sentAt };
        continue;
      }
      let r: Reading = read(l.body, l.sentAt);
      let readBy = 'RULES';
      if (r.kind === 'INFO' && l.body.length >= 12) {
        const ai = await llmTriage(l.body, l.sentAt).catch((e) => (this.log.warn(`AI triage failed: ${(e as Error).message}`), null));
        if (ai) {
          r = { ...r, ...ai, refs: r.refs };
          readBy = 'AI';
        }
      }
      const own = r.refs.length > 0;
      const refs = own ? r.refs : context && l.sentAt.getTime() - context.at.getTime() < 24 * HOUR && ['PROMISE', 'DONE', 'CLAIM', 'REPLY'].includes(r.kind) ? context.refs : [];
      if (own) context = { refs: r.refs, at: l.sentAt };

      const did: string[] = [];
      const flagIds: string[] = [];
      const unmatched: string[] = [];
      let href: string | undefined;
      const party = l.party === 'UNKNOWN' ? 'COURIER' : l.party;

      if (refs.length) {
        const ships = await this.prisma.shipment.findMany({
          where: { brandId, status: { not: 'CANCELLED' }, OR: [{ awb: { in: refs } }, { order: { orderNumber: { in: refs } } }] },
          include: { order: true, courier: true },
        });
        const known = new Set(ships.flatMap((s) => [s.awb, s.order.orderNumber]));
        for (const ref of refs) if (!known.has(ref) && looksLikeAwb(ref)) unmatched.push(ref);
        // One case per pickup for pickup problems (a list of 8 AWBs at one vendor is one chase), else per parcel.
        const done = new Set<string>();
        for (const s of ships) {
          const type = r.type && RAISED[r.type] ? r.type : typeForStatus(s.status);
          const key = groupOf(type) === 'PICKUPS' && s.pickupId ? `p:${s.pickupId}` : `s:${s.id}`;
          if (done.has(key)) continue;
          done.add(key);
          const res = await this.fileOnShipment(brandId, s, type, l, r, party, me, now);
          if (!res) continue;
          (res.created ? opened : updated).add(res.id);
          flagIds.push(res.id);
          href = `/issues/${res.id}`;
          did.push(`${res.created ? 'Opened' : 'Updated'} ${RAISED[type]?.label.toLowerCase() ?? 'case'} for #${s.order.orderNumber} (${s.courier.name})`);
        }
        if (unmatched.length && courier && (party === 'OURS' || r.kind !== 'INFO')) {
          // AWBs still booked outside EcomNext (Velocity, the courier's own panel): one case per courier and problem, with the list.
          const res = await this.fileOnCourier(brandId, courier, r.type && RAISED[r.type] ? r.type : 'PICKUP_PENDING', l, r, party, unmatched, me, now);
          if (res) {
            (res.created ? opened : updated).add(res.id);
            flagIds.push(res.id);
            href ??= `/issues/${res.id}`;
            did.push(`${plural(unmatched.length, 'AWB')} not on EcomNext: ${res.created ? 'opened' : 'added to'} the ${courier.name} case`);
          }
        } else if (unmatched.length) {
          did.push(`${plural(unmatched.length, 'AWB')} not on EcomNext${courier ? '' : '. Pick the courier for this chat to open a case for them'}`);
        }
        unmatched.forEach((u) => unmatchedAll.add(u));
      } else if ((r.kind === 'MONEY' || r.kind === 'BLOCKED') && courier && r.type) {
        const res = await this.fileOnCourier(brandId, courier, r.type, l, r, party, [], me, now);
        if (res) {
          (res.created ? opened : updated).add(res.id);
          flagIds.push(res.id);
          href = `/issues/${res.id}`;
          did.push(`${res.created ? 'Opened' : 'Updated'} ${RAISED[r.type].label.toLowerCase()} with ${courier.name}`);
        }
      }
      const promiseAt = r.promiseAt && r.promiseAt > now ? r.promiseAt : null;
      if (promiseAt && flagIds.length) {
        promises++;
        did.push(`Promise logged: ${timeLabel(promiseAt, now)}. The chaser checks back then`);
      } else if (r.kind === 'PROMISE' && !promiseAt && flagIds.length) {
        did.push('Says it will be done, but gave no time. Reminders continue until a time is given');
      }
      if (!did.length) did.push(refs.length ? 'Nothing to file' : 'Noted (no AWB or case in it)');

      await this.prisma.chatMessage.create({
        data: {
          brandId,
          source,
          courierCode: courier?.code ?? null,
          sender: l.sender,
          party: l.party,
          sentAt: l.sentAt,
          body: l.body.slice(0, 4000),
          refs,
          kind: r.kind,
          issueType: r.type,
          promiseAt,
          flagIds,
          unmatched,
          readBy,
          hash,
          createdAt: now,
        },
      });
      items.push({
        at: l.sentAt,
        sender: l.sender,
        party: l.party,
        text: l.body.slice(0, 280),
        kind: r.kind,
        did,
        tone: flagIds.length ? (r.kind === 'PROMISE' || r.kind === 'DONE' ? 'green' : r.kind === 'CLAIM' || r.kind === 'BLOCKED' ? 'red' : 'amber') : 'grey',
        href,
      });
    }

    const fresh = lines.length - skipped;
    const summary = `Read ${plural(fresh, 'message')}${skipped ? ` (${skipped} already read before)` : ''}${courier ? ` from the ${courier.name} chat` : ''}: opened ${plural(opened.size, 'case')}, updated ${updated.size}, logged ${plural(promises, 'promise')}.${unmatchedAll.size ? ` ${plural(unmatchedAll.size, 'AWB')} are not on EcomNext yet.` : ''}`;
    if (fresh) {
      await this.prisma.agentMessage.create({
        data: {
          brandId,
          role: 'AGENT',
          body: summary,
          data: { intent: 'triage', actions: opened.size + updated.size + promises, items: items.filter((i) => i.href).slice(0, 10).map((i) => ({ label: `${i.sender}: ${i.text.slice(0, 80)}`, sub: i.did[0], tone: i.tone, href: i.href })) } as Prisma.InputJsonValue,
          createdAt: new Date(now.getTime() + 1),
        },
      });
    }
    return { summary, read: fresh, skipped, opened: opened.size, updated: updated.size, promises, unmatched: [...unmatchedAll], items };
  }

  /** The AWBs last talked about in this courier's chat, so a later "done" or "tomorrow" knows what it is about. */
  private async lastContext(brandId: string, courierCode: string | null, before: Date) {
    const m = await this.prisma.chatMessage.findFirst({
      where: { brandId, courierCode, sentAt: { lte: before, gte: new Date(before.getTime() - 24 * HOUR) }, NOT: { refs: { isEmpty: true } } },
      orderBy: { sentAt: 'desc' },
    });
    return m ? { refs: m.refs, at: m.sentAt } : null;
  }

  /** Files a message on the parcel's case: the open one if there is one, else a new one. */
  private async fileOnShipment(brandId: string, s: Ship, type: string, l: Line, r: Reading, party: Exclude<Party, 'UNKNOWN'>, me: Actor, now: Date) {
    const pickupCase = groupOf(type) === 'PICKUPS' && s.pickupId;
    const open = await this.prisma.redFlag.findFirst({
      where: { brandId, resolvedAt: null, OR: [{ shipmentId: s.id }, ...(pickupCase ? [{ pickupId: s.pickupId }] : [])] },
      orderBy: { createdAt: 'asc' },
    });
    if (open) {
      await this.issues.logChat(open.id, { party, who: l.sender, body: l.body, kind: r.kind, promiseAt: r.promiseAt, at: l.sentAt }, now);
      if (r.kind === 'CLAIM' && open.pickupId) await this.issues.hoursCheck(open.id, open.pickupId, l.sentAt);
      return { id: open.id, created: false };
    }
    // Nothing to open for a parcel that is done, unless someone says it is not.
    if (s.status === 'DELIVERED' && type !== 'NOT_RECEIVED' && type !== 'DAMAGED') return null;
    if (r.kind === 'DONE') return null;
    const raised = (await this.issues.raise(
      {
        type: r.kind === 'CLAIM' ? 'PICKUP_CLAIM' : type,
        body: `From the ${s.courier.name} WhatsApp group, ${l.sender}: ${l.body}`.slice(0, 2000),
        ...(pickupCase ? { pickupId: s.pickupId! } : { orderId: s.order.orderNumber }),
        waitingOn: party === 'OURS' ? 'COURIER' : 'OURS',
      },
      me,
      now,
    )) as { id: string };
    if (party !== 'OURS' && r.promiseAt) await this.issues.logChat(raised.id, { party, who: l.sender, body: l.body, kind: r.kind, promiseAt: r.promiseAt, at: l.sentAt }, now);
    return { id: raised.id, created: true };
  }

  /** A courier-level case: money owed, bookings blocked, or AWBs we do not hold here. */
  private async fileOnCourier(brandId: string, courier: { code: string; name: string }, type: string, l: Line, r: Reading, party: Exclude<Party, 'UNKNOWN'>, awbs: string[], me: Actor, now: Date) {
    const open = await this.prisma.redFlag.findFirst({ where: { brandId, type, courierCode: courier.code, shipmentId: null, pickupId: null, resolvedAt: null } });
    const list = awbs.length ? ` AWBs: ${awbs.join(', ')}.` : '';
    if (open) {
      await this.issues.logChat(open.id, { party, who: l.sender, body: `${l.body}${list}`.slice(0, 2000), kind: r.kind, promiseAt: r.promiseAt, at: l.sentAt }, now);
      if (awbs.length) {
        // The case title always names every AWB on it, so the courier sees which parcels without opening it.
        const known = [...new Set([...(/AWBs?: ([\d,\s A-Z-]+)/.exec(open.message)?.[1] ?? '').split(/[,\s]+/).filter((x) => x.length >= 8), ...awbs])];
        await this.prisma.redFlag.update({ where: { id: open.id }, data: { title: this.awbTitle(courier.name, type, known), message: `${open.message.replace(/ AWBs?: [\d,\s A-Z-]+\.?$/, '')} AWBs: ${known.join(', ')}.`.slice(0, 2000) } });
      }
      return { id: open.id, created: false };
    }
    if (r.kind === 'DONE') return null;
    const raised = (await this.issues.raise(
      {
        type,
        title: awbs.length ? this.awbTitle(courier.name, type, awbs) : undefined,
        body: `From the ${courier.name} WhatsApp group, ${l.sender}: ${l.body}${list}`.slice(0, 2000),
        courierCode: courier.code,
        waitingOn: party === 'OURS' ? 'COURIER' : 'OURS',
      },
      me,
      now,
    )) as { id: string };
    if (party !== 'OURS' && r.promiseAt) await this.issues.logChat(raised.id, { party, who: l.sender, body: l.body, kind: r.kind, promiseAt: r.promiseAt, at: l.sentAt }, now);
    return { id: raised.id, created: true };
  }

  /** "Xpressbees: pickup pending · 375731260024, 375731164629 +1" */
  private awbTitle(courier: string, type: string, awbs: string[]) {
    const shown = awbs.slice(0, 2).join(', ');
    return `${courier}: ${RAISED[type].label.toLowerCase()} · ${shown}${awbs.length > 2 ? ` +${awbs.length - 2}` : ''}`.slice(0, 120);
  }

  /** The Resolve Hub ledger: what was read, newest first. */
  async ledger(courierCode?: string) {
    const brandId = await this.brands.currentBrandId();
    const rows = await this.prisma.chatMessage.findMany({ where: { brandId, ...(courierCode ? { courierCode } : {}) }, orderBy: { sentAt: 'desc' }, take: 100 });
    const [total, filed, promised] = await Promise.all([
      this.prisma.chatMessage.count({ where: { brandId } }),
      this.prisma.chatMessage.count({ where: { brandId, NOT: { flagIds: { isEmpty: true } } } }),
      this.prisma.chatMessage.count({ where: { brandId, promiseAt: { not: null } } }),
    ]);
    return {
      stats: { total, filed, promised },
      rows: rows.map((m) => ({ id: m.id, at: m.sentAt, sender: m.sender, party: m.party, courierCode: m.courierCode, body: m.body, kind: m.kind, refs: m.refs, unmatched: m.unmatched, flagIds: m.flagIds, promiseAt: m.promiseAt, readBy: m.readBy })),
    };
  }
}
