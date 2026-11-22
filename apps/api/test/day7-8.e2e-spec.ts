import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AlertsService } from './../src/alerts/alerts.service.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const run = `H${Date.now().toString(36).toUpperCase()}`;
const DEMO = process.env.DEMO_PASSWORD ?? 'D2C@demo2026';
const HOUR = 3600_000;

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Bagssy',
  productName: `Test tote ${run}`,
  customerName: 'Alert Tester',
  customerPhone: '9812345672',
  addressLine: 'Flat 7, Hill Road, Bandra West',
  city: 'Mumbai',
  pincode: '400050',
  warehouseCode: 'WHFQFV', // Star India, vendor phone 9800000011
  paymentMode: 'PREPAID',
  orderValue: 999,
  weightGrams: 700,
  lengthCm: 30,
  breadthCm: 20,
  heightCm: 10,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

// A 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function teamAgent(app: INestApplication<App>, email: string) {
  const a = request.agent(app.getHttpServer());
  const login = await a.post('/api/auth/login').send({ email, password: DEMO }).expect(200);
  await a.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
  return a;
}

async function vendorAgent(app: INestApplication<App>, phone: string) {
  const a = request.agent(app.getHttpServer());
  const login = await a.post('/api/auth/vendor-login').send({ phone }).expect(200);
  expect(login.body.demoCode).toMatch(/^\d{6}$/);
  await a.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
  return a;
}

describe('Day 7-8: roles, alerts, escalation, summary, vendor view (e2e)', () => {
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

  it('roles: support cannot book or cancel, finance cannot book; everyone can read orders', async () => {
    const support = await teamAgent(app, 'support@d2c.demo');
    await support.get('/api/orders').expect(200);
    await support.post('/api/shipments').send(order('R1')).expect(403);
    const b = await founder.post('/api/shipments').send(order('R2')).expect(201);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
    await support.post(`/api/orders/${s.orderId}/cancel`).send({ scope: 'order', reason: 'not allowed' }).expect(403);
    await support.get('/api/payments/summary').expect(403);
    const finance = await teamAgent(app, 'finance@d2c.demo');
    await finance.post('/api/shipments').send(order('R3')).expect(403);
    await finance.get('/api/payments/summary').expect(200);
  });

  it('the owner of a new problem is alerted once, on the bell and an SMS link, with a link to it', async () => {
    const b = await founder.post('/api/shipments').send(order('A1')).expect(201);
    const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: 'd2c' } });
    const ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@d2c.demo' } });
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
    const flag = await prisma.redFlag.create({
      data: { brandId: brand.id, shipmentId: s.id, type: 'NO_SCAN_48H', severity: 'CRITICAL', title: 'No scan for 50 hours', message: 'test', action: 'Send RCA to courier', ownerId: ops.id, dueAt: new Date(Date.now() + HOUR) },
    });
    const alerts = app.get(AlertsService);
    await alerts.run(new Date());
    await alerts.run(new Date());
    const sent = await prisma.notification.findMany({ where: { dedupeKey: { startsWith: `flag:${flag.id}:` } } });
    expect(sent.map((n) => n.channel).sort()).toEqual(['APP', 'SMS']);
    expect(sent.find((n) => n.channel === 'SMS')?.status).toBe('DEMO');
    expect(sent[0].link).toBe(`/issues/${flag.id}`);

    const opsAgent = await teamAgent(app, 'ops@d2c.demo');
    const bell = await opsAgent.get('/api/notifications/mine').expect(200);
    expect(bell.body.unread).toBeGreaterThan(0);
    expect(sent.find((n) => n.channel === 'APP')?.userId).toBe(ops.id);
    await opsAgent.post('/api/notifications/read').expect(200);
    expect((await opsAgent.get('/api/notifications/mine').expect(200)).body.unread).toBe(0);
  });

  it('an overdue problem climbs the ladder: manager, courier account manager, founder, each once', async () => {
    const b = await founder.post('/api/shipments').send(order('E1')).expect(201);
    const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: 'd2c' } });
    const ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@d2c.demo' }, include: { manager: true } });
    const due = new Date();
    const flag = await prisma.redFlag.create({
      data: { brandId: brand.id, shipmentId: b.body.id, type: 'NDR', severity: 'WARNING', title: 'Delivery failed', message: 'test', action: 'Confirm reattempt', ownerId: ops.id, dueAt: due },
    });
    const alerts = app.get(AlertsService);
    await alerts.run(new Date(due.getTime() + 10 * 60_000));
    let f = await prisma.redFlag.findUniqueOrThrow({ where: { id: flag.id } });
    expect(f.escalationLevel).toBe(1);
    const toManager = await prisma.notification.findFirst({ where: { dedupeKey: { startsWith: `esc:${flag.id}:1:` }, channel: 'APP' } });
    expect(toManager?.userId).toBe(ops.managerId);

    await alerts.run(new Date(due.getTime() + 5 * HOUR));
    f = await prisma.redFlag.findUniqueOrThrow({ where: { id: flag.id } });
    expect(f.escalationLevel).toBe(3);
    expect(await prisma.notification.count({ where: { channel: 'SMS', dedupeKey: { startsWith: `esc:${flag.id}:2:` } } })).toBe(1); // courier: SMS link (plus their partner app, when they have a login)
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `esc:${flag.id}:3:` }, channel: 'APP' } })).toBe(1);
    await alerts.run(new Date(due.getTime() + 9 * HOUR));
    expect(await prisma.notification.count({ where: { channel: 'SMS', dedupeKey: { startsWith: `esc:${flag.id}:` } } })).toBe(3);

    // Acting on a problem stops the ladder.
    const flag2 = await prisma.redFlag.create({
      data: { brandId: brand.id, shipmentId: b.body.id, type: 'RTO', severity: 'CRITICAL', title: 'Returning', message: 'test', action: 'Call customer', ownerId: ops.id, dueAt: due },
    });
    await founder.post(`/api/flags/${flag2.id}/act`).send({ kind: 'act' }).expect(201);
    await alerts.run(new Date(Date.now() + HOUR));
    expect((await prisma.redFlag.findUniqueOrThrow({ where: { id: flag2.id } })).escalationLevel).toBe(0);
    // ...but an action is not a fix: no result 4 h later (RTO follow-up) and the ladder starts again.
    await alerts.run(new Date(Date.now() + 5 * HOUR));
    const again = await prisma.redFlag.findUniqueOrThrow({ where: { id: flag2.id } });
    expect(again.escalationLevel).toBeGreaterThanOrEqual(1);
    const msg = await prisma.notification.findFirst({ where: { dedupeKey: { startsWith: `esc:${flag2.id}:1:` }, channel: 'APP' } });
    expect(msg?.body).toMatch(/no result after/);
  });

  it('builds and sends the daily summary to admins, and shows it', async () => {
    const res = await founder.post('/api/summary/send-now').expect(200);
    expect(res.body.text).toMatch(/Booked \d+ · picked up \d+/);
    expect(res.body.data).toHaveProperty('codPending');
    const latest = await founder.get('/api/summary/latest').expect(200);
    expect(latest.body.day).toBe(res.body.day);
    const support = await teamAgent(app, 'support@d2c.demo');
    await support.post('/api/summary/send-now').expect(403);
    await founder.get('/api/messages').expect(200);
    const founderUser = await prisma.user.findUniqueOrThrow({ where: { email: 'founder@d2c.demo' } });
    const email = await prisma.notification.findFirst({ where: { kind: 'DAILY_SUMMARY', channel: 'EMAIL', userId: founderUser.id }, orderBy: { id: 'desc' } });
    expect(email?.to).toBe('founder@d2c.demo');
  });

  it('vendor: signs in by phone, sees only its own warehouse, packs, adds a photo, and is kept out of team screens', async () => {
    const b = await founder.post('/api/shipments').send(order('V1')).expect(201);
    const star = await vendorAgent(app, '9800000011');
    await star.get('/api/orders').expect(403);
    await star.get('/api/today').expect(403);
    const me = await star.get('/api/auth/me').expect(200);
    expect(me.body.role).toBe('VENDOR');

    const today = await star.get('/api/vendor/today').expect(200);
    expect(today.body.warehouse.name).toBe('Star India');
    const parcels = today.body.days.flatMap((d: { pickups: { parcels: { id: string }[] }[] }) => d.pickups.flatMap((p) => p.parcels));
    expect(parcels.map((p: { id: string }) => p.id)).toContain(b.body.id);

    await star.post('/api/vendor/packed').send({ shipmentIds: [b.body.id] }).expect(200);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } })).packedAt).toBeTruthy();
    const photo = await star.post(`/api/vendor/shipments/${b.body.id}/photos`).send({ dataUrl: PNG }).expect(201);
    await star.post(`/api/vendor/shipments/${b.body.id}/photos`).send({ dataUrl: 'data:text/html;base64,PGI+' }).expect(400);
    const img = await star.get(`/api/photos/${photo.body.id}`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');

    // Our team sees the photo on the order; another vendor cannot see or touch the parcel.
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
    const d = await founder.get(`/api/orders/${s.orderId}`).expect(200);
    expect(d.body.shipments[0].photos).toHaveLength(1);
    await founder.get(`/api/photos/${photo.body.id}`).expect(200);
    const laxmi = await vendorAgent(app, '9800000012');
    await laxmi.get(`/api/photos/${photo.body.id}`).expect(404);
    await laxmi.post('/api/vendor/packed').send({ shipmentIds: [b.body.id] }).expect(404);
    await laxmi.post(`/api/pickups/${s.pickupId}/postpone`).send({ reason: 'not mine' }).expect(404);

    const labels = await star.get(`/api/vendor/pickups/${s.pickupId}/labels.pdf`).expect(200);
    expect(labels.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('postpone moves every parcel to a later slot, logs why, and tells the vendor', async () => {
    const b = await founder.post('/api/shipments').send(order('P1')).expect(201);
    const before = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id }, include: { pickup: true } });
    const res = await founder.post(`/api/pickups/${before.pickupId}/postpone`).send({ reason: 'Vendor stock arriving late' });
    expect(res.body.message ?? '').toBe('');
    expect(res.status).toBe(200);
    expect(res.body.movedTo).toMatch(/am|pm/);
    const after = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id }, include: { pickup: true } });
    expect(after.pickupId).not.toBe(before.pickupId);
    expect(after.pickup!.slotStart.getTime()).toBeGreaterThan(before.pickup!.slotStart.getTime());
    const old = await prisma.pickup.findUniqueOrThrow({ where: { id: before.pickupId! } });
    expect(old.status).toBe('POSTPONED');
    expect(old.postponeReason).toBe('Vendor stock arriving late');
    expect(await prisma.notification.count({ where: { dedupeKey: `postpone:${before.pickupId}:vendor:sms` } })).toBe(1);
    // The vendor's own login gets it too (the vendor has an account).
    expect(await prisma.notification.count({ where: { dedupeKey: `postpone:${before.pickupId}:vendor:app` } })).toBe(1);
    await founder.post(`/api/pickups/${before.pickupId}/postpone`).send({ reason: 'again' }).expect(400);
  });

  it('weight hint: the usual weight of a product from past orders', async () => {
    await founder.post('/api/shipments').send(order('W1', { productName: `Hint bag ${run}`, weightGrams: 500 })).expect(201);
    await founder.post('/api/shipments').send(order('W2', { productName: `Hint bag ${run}`, weightGrams: 520 })).expect(201);
    const h = await founder.get(`/api/weight-hint?product=${encodeURIComponent(`Hint bag ${run}`)}`).expect(200);
    expect(h.body.samples).toBe(2);
    expect(h.body.typicalGrams).toBe(520);
  });
});
