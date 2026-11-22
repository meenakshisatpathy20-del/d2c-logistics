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
const run = `P${Date.now().toString(36).toUpperCase()}`;
const HOUR = 3600_000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Swarg Homes',
  productName: 'Cushion covers',
  customerName: 'Partner Tester',
  customerPhone: '9812345677',
  addressLine: 'Flat 8, Lake Road, Kandivali',
  city: 'Mumbai',
  pincode: '400101',
  warehouseCode: 'WHUY73',
  paymentMode: 'PREPAID',
  orderValue: 999,
  weightGrams: 900,
  lengthCm: 30,
  breadthCm: 20,
  heightCm: 10,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

describe('Day 11: courier partner app, no WhatsApp (e2e)', () => {
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

  /** Signs in as the courier's pickup lead from Settings → Courier contacts. */
  async function courierLogin(courierCode: string) {
    const contact = await prisma.courierContact.findFirstOrThrow({ where: { courierCode, role: 'PICKUP_LEAD', active: true } });
    const agent = request.agent(app.getHttpServer());
    const l = await agent.post('/api/auth/partner-login').send({ phone: contact.phone }).expect(200);
    await agent.post('/api/auth/verify').send({ challengeId: l.body.challengeId, code: l.body.demoCode }).expect(200);
    return { agent, contact };
  }

  async function bookWith(n: string, courierCode: string) {
    const r = await founder.post('/api/shipments').send(order(n, { courierCode })).expect(201);
    return prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id } });
  }

  it('a number not on the courier contact list cannot sign in', async () => {
    await request(app.getHttpServer()).post('/api/auth/partner-login').send({ phone: '9700099999' }).expect(401);
  });

  it('courier staff see only their own pickups and confirm one with the executive', async () => {
    const s = await bookWith('C1', 'DELHIVERY');
    const { agent } = await courierLogin('DELHIVERY');
    const home = await agent.get('/api/partner/home').expect(200);
    expect(home.body.courier.code).toBe('DELHIVERY');
    const mine = home.body.pickups.find((p: { id: string }) => p.id === s.pickupId);
    expect(mine).toBeTruthy();
    expect(home.body.issues.every((i: { about: string }) => typeof i.about === 'string')).toBe(true);

    await agent.post(`/api/partner/pickups/${s.pickupId}/confirm`).send({ executiveName: 'Ramesh K', executivePhone: '9811122233' }).expect(200);
    const p = await prisma.pickup.findUniqueOrThrow({ where: { id: s.pickupId! } });
    expect(p).toMatchObject({ status: 'CONFIRMED', executiveName: 'Ramesh K', executivePhone: '9811122233' });
    // The vendor is told who is coming, in its own app with an SMS link, never WhatsApp.
    const told = await prisma.notification.findMany({ where: { kind: 'PICKUP_CONFIRMED', dedupeKey: { startsWith: `confirmed:${s.pickupId}` } } });
    expect(told.map((n) => n.channel).sort()).toEqual(['APP', 'SMS']);
    expect(told.find((n) => n.channel === 'SMS')!.body).toMatch(/Open: .*\/v$/);

    // Another courier cannot touch it.
    const other = await courierLogin('EKART');
    await other.agent.post(`/api/partner/pickups/${s.pickupId}/confirm`).send({ executiveName: 'X Y', executivePhone: '9811122234' }).expect(404);
    // And a courier login cannot open our team screens.
    await agent.get('/api/issues').expect(403);
  });

  it('"warehouse closed" is reported with a photo, checked against the vendor hours, and goes to the vendor', async () => {
    const s = await bookWith('C2', 'XPRESSBEES');
    const { agent } = await courierLogin('XPRESSBEES');
    const r = await agent.post(`/api/partner/pickups/${s.pickupId}/problem`).send({ reason: 'CLOSED', note: 'Shutter down at 3:10 pm', dataUrl: PNG, lat: 19.18, lng: 72.84 }).expect(201);
    const room = await founder.get(`/api/issues/${r.body.issueId}`).expect(200);
    expect(room.body.waitingOn).toBe('VENDOR');
    const bodies = room.body.events.map((e: { body: string }) => e.body).join(' | ');
    expect(bodies).toMatch(/Warehouse was closed: Shutter down/);
    expect(bodies).toMatch(/declared hours/);
    const photoEvent = room.body.events.find((e: { photoId: string | null }) => e.photoId);
    expect(photoEvent.body).toMatch(/19\.1800, 72\.8400/);
    await founder.get(`/api/issues/photos/${photoEvent.photoId}`).expect(200).expect('content-type', /image\/png/);
    await agent.get(`/api/partner/photos/${photoEvent.photoId}`).expect(200);
    // Reported twice: one room, not two.
    const again = await agent.post(`/api/partner/pickups/${s.pickupId}/problem`).send({ reason: 'CLOSED', note: 'Still closed' }).expect(201);
    expect(again.body.issueId).toBe(r.body.issueId);
    await prisma.redFlag.update({ where: { id: r.body.issueId }, data: { resolvedAt: new Date(), outcome: 'Order cancelled' } });
  });

  it('a courier answers an issue in the app: a promise stops reminders, a message hands the turn back', async () => {
    const s = await bookWith('C3', 'EKART');
    const raised = await founder.post('/api/issues').send({ type: 'PICKUP_PENDING', pickupId: s.pickupId, body: 'Pickup pending since morning' }).expect(201);
    const { agent } = await courierLogin('EKART');
    const home = await agent.get('/api/partner/home').expect(200);
    expect(home.body.issues.find((i: { id: string }) => i.id === raised.body.id).yourTurn).toBe(true);

    await agent.post(`/api/partner/issues/${raised.body.id}/answer`).send({ kind: 'PROMISE', body: 'Executive Suresh by 4 pm' }).expect(400);
    const at = new Date(Date.now() + 5 * HOUR);
    const promised = await agent.post(`/api/partner/issues/${raised.body.id}/answer`).send({ kind: 'PROMISE', body: 'Executive Suresh by 4 pm', promiseAt: at.toISOString() }).expect(200);
    expect(promised.body.yourTurn).toBe(true);
    let f = await prisma.redFlag.findUniqueOrThrow({ where: { id: raised.body.id } });
    expect(f.promiseAt?.getTime()).toBe(at.getTime());
    expect(f.reminderCount).toBe(0);

    await agent.post(`/api/partner/issues/${raised.body.id}/answer`).send({ kind: 'DONE', body: 'Picked up 6 parcels' }).expect(200);
    f = await prisma.redFlag.findUniqueOrThrow({ where: { id: raised.body.id } });
    expect(f.waitingOn).toBe('OURS');
    // Our owner hears about it in the app.
    expect(await prisma.notification.count({ where: { kind: 'ISSUE_ANSWERED', link: `/issues/${raised.body.id}` } })).toBeGreaterThan(0);
    // "Done" from the courier is not a scan: closing still needs proof.
    await founder.post(`/api/issues/${raised.body.id}/act`).send({ kind: 'resolve', outcome: 'Picked up', faultParty: 'NONE' }).expect(400);
    await prisma.redFlag.update({ where: { id: raised.body.id }, data: { resolvedAt: new Date(), outcome: 'Order cancelled' } });
  });

  it('reminders reach the partner app and an SMS link, never WhatsApp', async () => {
    const s = await bookWith('C4', 'SHADOWFAX');
    let t = new Date(Date.now() + 2 * 24 * HOUR);
    while (new Date(t.getTime() + 5.5 * HOUR).getUTCDay() === 0) t = new Date(t.getTime() + 24 * HOUR);
    const ist = new Date(t.getTime() + 5.5 * HOUR);
    const morning = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 11) - 5.5 * HOUR);
    const f = await prisma.redFlag.create({
      data: { brandId: s.brandId, pickupId: s.pickupId, type: 'PICKUP_PENDING', severity: 'WARNING', title: 'Pickup pending', message: 'test', createdAt: morning },
    });
    const issues = app.get(IssuesService);
    await issues.run(morning);
    await issues.run(new Date(morning.getTime() + 2 * HOUR + 60_000));
    const sent = await prisma.notification.findMany({ where: { OR: [{ dedupeKey: { startsWith: `opened:${f.id}` } }, { dedupeKey: { startsWith: `remind:${f.id}` } }] } });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((n) => n.channel === 'SMS' || n.channel === 'APP')).toBe(true);
    expect(sent.filter((n) => n.channel === 'SMS').every((n) => /Open: .*\/p$/.test(n.body))).toBe(true);
    expect(await prisma.notification.count({ where: { channel: 'WHATSAPP' as never, createdAt: { gte: new Date(Date.now() - HOUR) } } }).catch(() => 0)).toBe(0);
    await prisma.redFlag.update({ where: { id: f.id }, data: { resolvedAt: new Date(), outcome: 'Order cancelled' } });
  });
});
