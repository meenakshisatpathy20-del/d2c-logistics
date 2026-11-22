import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { IssuesService } from './../src/issues/issues.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const run = `I${Date.now().toString(36).toUpperCase()}`;
const HOUR = 3600_000;

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Swarg Homes',
  productName: 'Cushion covers',
  customerName: 'Issue Tester',
  customerPhone: '9812345674',
  addressLine: 'Flat 8, Lake Road, Kandivali',
  city: 'Mumbai',
  pincode: '400101',
  warehouseCode: 'WHUY73', // Laxmi Imitation, vendor 9800000012
  paymentMode: 'PREPAID',
  orderValue: 1199,
  weightGrams: 900,
  lengthCm: 30,
  breadthCm: 20,
  heightCm: 10,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

/** A weekday 11 am IST a few days ahead, inside reminder hours. */
function workingMorning(): Date {
  const d = new Date(Date.now() + 3 * 24 * HOUR);
  for (;;) {
    const ist = new Date(d.getTime() + 5.5 * HOUR);
    if (ist.getUTCDay() !== 0) break;
    d.setTime(d.getTime() + 24 * HOUR);
  }
  const ist = new Date(d.getTime() + 5.5 * HOUR);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 11) - 5.5 * HOUR);
}

describe('Day 9: issue rooms (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let founder: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    founder = await signedIn(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function pickupIssue(n: string) {
    const b = await founder.post('/api/shipments').send(order(n)).expect(201);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
    // Orders in a test share one pickup slot; close earlier claims so each test starts fresh.
    await prisma.redFlag.updateMany({ where: { pickupId: s.pickupId, type: 'PICKUP_CLAIM', resolvedAt: null }, data: { resolvedAt: new Date(), outcome: 'Order cancelled' } });
    const raised = await founder
      .post('/api/issues')
      .send({ type: 'PICKUP_CLAIM', pickupId: s.pickupId, body: 'Courier says the warehouse was closed at 3 pm' })
      .expect(201);
    return { shipment: s, issue: raised.body };
  }

  it('a raised issue names who is on each side and whose turn it is', async () => {
    const { issue } = await pickupIssue('A');
    expect(issue.waitingOn).toBe('COURIER');
    expect(issue.waitingPerson).toMatch(/\(demo\).*pickup lead/);
    const parties = issue.people.map((p: { party: string }) => p.party);
    expect(parties).toEqual(expect.arrayContaining(['OURS', 'COURIER', 'VENDOR']));
    expect(issue.events[0].body).toMatch(/Raised/);
    const inbox = await founder.get('/api/issues?group=PICKUPS&waiting=COURIER').expect(200);
    expect(inbox.body.rows.map((r: { id: string }) => r.id)).toContain(issue.id);
  });

  it('reminders go out by themselves, count as ignored, and reach the manager after two', async () => {
    const { issue } = await pickupIssue('B');
    const issues = app.get(IssuesService);
    const t0 = workingMorning();
    await prisma.redFlag.update({ where: { id: issue.id }, data: { waitingSince: t0 } });
    await issues.run(new Date(t0.getTime() + 2 * HOUR + 60_000));
    await issues.run(new Date(t0.getTime() + 2 * HOUR + 120_000)); // not again so soon
    const f = await prisma.redFlag.findUniqueOrThrow({ where: { id: issue.id }, include: { courierContact: true } });
    expect(f.reminderCount).toBe(1);
    const firstContact = f.courierContact!.name;
    await issues.run(new Date(t0.getTime() + 4 * HOUR + 120_000));
    const g = await prisma.redFlag.findUniqueOrThrow({ where: { id: issue.id }, include: { courierContact: true, events: true } });
    expect(g.reminderCount).toBe(2);
    expect(g.courierContact!.name).not.toBe(firstContact); // handed to the regional manager
    expect(g.events.some((e) => e.kind === 'ESCALATED')).toBe(true);
    expect(await prisma.notification.count({ where: { channel: 'SMS', dedupeKey: { startsWith: `remind:${issue.id}:` } } })).toBe(2);

    // Still silent after the manager was told: we stop waiting and move the parcels.
    const before = await prisma.shipment.findFirstOrThrow({ where: { pickupId: f.pickupId! } });
    await issues.run(new Date(t0.getTime() + 6 * HOUR + 180_000));
    const h = await prisma.redFlag.findUniqueOrThrow({ where: { id: issue.id }, include: { events: true } });
    expect(h.waitingOn).toBe('OURS');
    expect(h.events.some((e) => /stopped waiting/.test(e.body))).toBe(true);
    const after = await prisma.shipment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.courierCode).not.toBe(before.courierCode);
  });

  it('a logged call reply with a time becomes a promise; missing it is counted', async () => {
    const { issue } = await pickupIssue('C');
    const promise = new Date(Date.now() + HOUR);
    const r = await founder
      .post(`/api/issues/${issue.id}/act`)
      .send({ kind: 'partner_reply', party: 'COURIER', via: 'CALL', body: 'Executive Ramesh will come by 4 pm', promiseAt: promise.toISOString() })
      .expect(200);
    expect(r.body.promiseText).toMatch(/Ramesh/);
    expect(r.body.events.at(-1).party).toBe('COURIER');
    await app.get(IssuesService).run(new Date(promise.getTime() + 60_000));
    const f = await prisma.redFlag.findUniqueOrThrow({ where: { id: issue.id }, include: { events: true } });
    expect(f.promisesBroken).toBe(1);
    expect(f.promiseAt).toBeNull();
    expect(f.events.some((e) => e.kind === 'PROMISE_BROKEN')).toBe(true);
  });

  it('call notes, asking the vendor, and the vendor answering from their own login', async () => {
    const { issue } = await pickupIssue('D');
    await founder
      .post(`/api/issues/${issue.id}/act`)
      .send({ kind: 'call_note', party: 'COURIER', agreed: 'They will send an executive today', nextBy: 'COURIER', deadline: new Date(Date.now() + 3 * HOUR).toISOString() })
      .expect(200);
    const asked = await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'ask', party: 'VENDOR', body: 'Were you open at 3 pm?' }).expect(200);
    expect(asked.body.waitingOn).toBe('VENDOR');

    const vendor = request.agent(app.getHttpServer());
    const login = await vendor.post('/api/auth/vendor-login').send({ phone: '9800000012' }).expect(200);
    await vendor.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
    const mine = await vendor.get('/api/vendor/issues').expect(200);
    const row = mine.body.find((x: { id: string }) => x.id === issue.id);
    expect(row.yourTurn).toBe(true);
    await vendor.post(`/api/vendor/issues/${issue.id}/reply`).send({ kind: 'READY', body: 'Shop open since 10 am' }).expect(200);
    const after = await founder.get(`/api/issues/${issue.id}`).expect(200);
    expect(after.body.waitingOn).toBe('COURIER');
    expect(after.body.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['CALL_NOTE', 'ASK', 'PARTNER_REPLY']));

    // Another vendor cannot see or answer it.
    const other = request.agent(app.getHttpServer());
    const l2 = await other.post('/api/auth/vendor-login').send({ phone: '9800000011' }).expect(200);
    await other.post('/api/auth/verify').send({ challengeId: l2.body.challengeId, code: l2.body.demoCode }).expect(200);
    expect((await other.get('/api/vendor/issues').expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(issue.id);
    await other.post(`/api/vendor/issues/${issue.id}/reply`).send({ kind: 'MESSAGE', body: 'hi' }).expect(404);
  });

  it('switching courier from the issue moves the parcels and cancels the old booking', async () => {
    const { shipment, issue } = await pickupIssue('E');
    const r = await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'switch_courier', reason: 'Warehouse closed claim, no proof' }).expect(200);
    expect(r.body.events.at(-1).body).toMatch(/moved from .* to /i);
    const moved = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(moved.courierCode).not.toBe(shipment.courierCode);
    expect(moved.awb).not.toBe(shipment.awb);
  });

  it('closes only on a real outcome, with who was at fault', async () => {
    const { issue } = await pickupIssue('F');
    await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'resolve', outcome: 'Done', faultParty: 'COURIER' }).expect(400);
    // "Picked up" must be in the courier's scans; saying so is not enough.
    const noScan = await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'resolve', outcome: 'Picked up', faultParty: 'COURIER' }).expect(400);
    expect(noScan.body.message).toMatch(/No pickup scan yet/);
    const done = await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'resolve', outcome: 'Moved to another courier', faultParty: 'COURIER', note: 'Switched after no reply' }).expect(200);
    expect(done.body.open).toBe(false);
    expect(done.body.faultParty).toBe('COURIER');
    await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'message', body: 'late note' }).expect(400);
    const closed = await founder.get('/api/issues?status=closed').expect(200);
    expect(closed.body.rows.map((r: { id: string }) => r.id)).toContain(issue.id);
  });

  it('a money issue can be raised on a courier without an order', async () => {
    const r = await founder
      .post('/api/issues')
      .send({ type: 'PAYMENT_NOT_CREDITED', courierCode: 'XPRESSBEES', body: 'Paid Rs 1,788 on 17 Nov (UTR INFT0467), not credited' })
      .expect(201);
    expect(r.body.group).toBe('MONEY');
    expect(r.body.waitingPerson).toMatch(/Haritha/);
    expect(r.body.outcomes).toContain('Credited');
    // Money is solved only with its reference.
    await founder.post(`/api/issues/${r.body.id}/act`).send({ kind: 'resolve', outcome: 'Credited', faultParty: 'COURIER' }).expect(400);
    await founder.post(`/api/issues/${r.body.id}/act`).send({ kind: 'resolve', outcome: 'Credited', faultParty: 'COURIER', note: 'Credit ref CN-2211' }).expect(200);
  });

  it('asking the customer messages the customer, not the courier', async () => {
    const b = await founder.post('/api/shipments').send(order('K')).expect(201);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id }, include: { order: true } });
    const r = await founder.post('/api/issues').send({ type: 'ADDRESS_CHANGE', orderId: s.order.orderNumber, body: 'Customer wants delivery on Monday' }).expect(201);
    await founder.post(`/api/issues/${r.body.id}/act`).send({ kind: 'ask', party: 'CUSTOMER', body: 'Please confirm Monday works' }).expect(200);
    const sent = await prisma.notification.findFirst({ where: { dedupeKey: { startsWith: `ask:${r.body.id}:` } } });
    expect(sent?.to).toBe('+91 9812345674');
  });

  it('raising the same problem twice opens the existing issue', async () => {
    const { shipment, issue } = await pickupIssue('G');
    const again = await founder.post('/api/issues').send({ type: 'PICKUP_CLAIM', pickupId: shipment.pickupId, body: 'Same again from the vendor group' }).expect(201);
    expect(again.body.id).toBe(issue.id);
    expect(again.body.events.at(-1).body).toMatch(/Raised again/);
  });

  it('messages to couriers only carry a link to their partner app, never our team pages', async () => {
    const { issue } = await pickupIssue('H');
    await founder.post(`/api/issues/${issue.id}/act`).send({ kind: 'ask', party: 'COURIER', body: 'Please assign an executive' }).expect(200);
    const sent = await prisma.notification.findFirst({ where: { channel: 'SMS', dedupeKey: { startsWith: `ask:${issue.id}:` } } });
    expect(sent?.body).toMatch(/Open: .*\/p$/);
    expect(sent?.body).not.toMatch(/\/issues\//);
  });
});
