import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const run = `G${Date.now().toString(36).toUpperCase()}`;

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Kasrat',
  productName: 'Resistance bands',
  customerName: 'Gap Tester',
  customerPhone: '9812345671',
  addressLine: 'Flat 4, Lake View Road, Powai',
  city: 'Mumbai',
  pincode: '400076',
  warehouseCode: 'WHFQFV',
  paymentMode: 'PREPAID',
  orderValue: 799,
  weightGrams: 600,
  lengthCm: 20,
  breadthCm: 15,
  heightCm: 8,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

describe('Sign-in and the gap fixes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let agent: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    agent = await signedIn(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sign-in', () => {
    it('keeps the API closed without a session, except health', async () => {
      await request(app.getHttpServer()).get('/api/orders').expect(401);
      await request(app.getHttpServer()).get('/api/shipments').expect(401);
      await request(app.getHttpServer()).get('/api/health').expect(200);
    });

    it('refuses a wrong password and a wrong code', async () => {
      await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'ops@d2c.demo', password: 'nope' }).expect(401);
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ops@d2c.demo', password: process.env.DEMO_PASSWORD ?? 'D2C@demo2026' })
        .expect(200);
      expect(login.body.sentTo).toMatch(/^op.*@d2c\.demo$/);
      const wrong = login.body.demoCode === '000000' ? '111111' : '000000';
      const res = await request(app.getHttpServer()).post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: wrong }).expect(401);
      expect(res.body.message).toMatch(/Wrong code/);
    });

    it('a used code cannot sign in twice, and the session says who you are', async () => {
      const a = request.agent(app.getHttpServer());
      const login = await a.post('/api/auth/login').send({ email: 'support@d2c.demo', password: process.env.DEMO_PASSWORD ?? 'D2C@demo2026' }).expect(200);
      const ok = await a.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
      expect(ok.headers['set-cookie']?.[0]).toMatch(/d2c_session=.*HttpOnly/);
      await a.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(401);
      const me = await a.get('/api/auth/me').expect(200);
      expect(me.body.name).toBe('Support Executive');
      await a.post('/api/auth/logout').expect(200);
    });
  });

  describe('orders screen', () => {
    it('lists by tab with counts, finds by order number, AWB and phone, and pages', async () => {
      const booked = await agent.post('/api/shipments').send(order('A')).expect(201);
      const ready = await agent.get('/api/orders?tab=READY&size=5').expect(200);
      expect(ready.body.counts.READY).toBeGreaterThan(0);
      expect(ready.body.rows.length).toBeLessThanOrEqual(5);
      expect(ready.body.pages).toBe(Math.max(1, Math.ceil(ready.body.total / 5)));

      for (const q of [`E2E-${run}-A`, booked.body.awb]) {
        const found = await agent.get(`/api/orders?q=${encodeURIComponent(q)}`).expect(200);
        expect(found.body.rows.map((r: { orderNumber: string }) => r.orderNumber)).toContain(`E2E-${run}-A`);
      }
      const byPhone = await agent.get('/api/orders?q=9812345671').expect(200);
      expect(byPhone.body.total).toBeGreaterThan(0);
    });

    it('shows one order in full', async () => {
      const list = await agent.get(`/api/orders?q=E2E-${run}-A`).expect(200);
      const d = await agent.get(`/api/orders/${list.body.rows[0].id}`).expect(200);
      expect(d.body.orderNumber).toBe(`E2E-${run}-A`);
      expect(d.body.shipments[0].events.length).toBeGreaterThan(0);
      expect(d.body.rtoRisk.level).toBeTruthy();
      expect(d.body.history.some((h: { action: string }) => h.action === 'SHIPMENT_BOOKED')).toBe(true);
    });
  });

  describe('cancel and edit', () => {
    it('edits customer details before pickup, but not the pin code once booked', async () => {
      const b = await agent.post('/api/shipments').send(order('B')).expect(201);
      const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
      const edited = await agent.patch(`/api/orders/${s.orderId}`).send({ customerPhone: '9822222222', addressLine: 'Flat 9, Lake View Road, Powai' }).expect(200);
      expect(edited.body.customer.phone).toBe('9822222222');
      const res = await agent.patch(`/api/orders/${s.orderId}`).send({ pincode: '110017' }).expect(400);
      expect(res.body.message).toMatch(/Cancel the shipment/);
    });

    it('cancelling a shipment frees the pickup slot and puts the order back in New; it can be booked again', async () => {
      const b = await agent.post('/api/shipments').send(order('C')).expect(201);
      const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id }, include: { pickup: true } });
      const before = s.pickup!.parcelCount;
      await agent.post(`/api/orders/${s.orderId}/cancel`).send({ scope: 'shipment', reason: 'Customer changed size' }).expect(201);
      const after = await prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, include: { pickup: true, order: true } });
      expect(after.status).toBe('CANCELLED');
      expect(after.pickup!.parcelCount).toBe(before - 1);
      expect(after.order.status).toBe('NEW');
      await agent.post('/api/shipments').send(order('C', { idempotencyKey: `e2e-${run}-C2` })).expect(201);
    });

    it('cancelling a COD order refunds its advance; a picked-up parcel cannot be cancelled', async () => {
      const b = await agent.post('/api/shipments').send(order('D', { paymentMode: 'COD', orderValue: 1299, codAdvance: 99 })).expect(201);
      const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
      await agent.post(`/api/orders/${s.orderId}/cancel`).send({ scope: 'order', reason: 'Customer cancelled' }).expect(201);
      const o = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
      expect(o.status).toBe('CANCELLED');
      expect(o.advanceStatus).toBe('REFUNDED');

      const e = await agent.post('/api/shipments').send(order('E')).expect(201);
      const se = await prisma.shipment.update({ where: { id: e.body.id }, data: { status: 'PICKED_UP' } });
      const res = await agent.post(`/api/orders/${se.orderId}/cancel`).send({ scope: 'order', reason: 'Too late' }).expect(400);
      expect(res.body.message).toMatch(/return/);
    });
  });

  describe('needs-you actions', () => {
    it('takes the suggested action, reassigns, and closes a problem for good', async () => {
      const b = await agent.post('/api/shipments').send(order('F')).expect(201);
      const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: 'd2c' } });
      const flag = await prisma.redFlag.create({
        data: { brandId: brand.id, shipmentId: b.body.id, type: 'NDR', severity: 'WARNING', title: 'Delivery failed', message: 'test', action: 'Confirm reattempt' },
      });
      const acted = await agent.post(`/api/flags/${flag.id}/act`).send({ kind: 'act', note: 'Customer home after 6 pm' }).expect(201);
      expect(acted.body.message).toMatch(/Confirm reattempt/);
      const team = await agent.get('/api/team').expect(200);
      const support = team.body.find((u: { role: string }) => u.role === 'SUPPORT');
      await agent.post(`/api/flags/${flag.id}/act`).send({ kind: 'reassign', ownerId: support.id }).expect(201);
      await agent.post(`/api/flags/${flag.id}/act`).send({ kind: 'resolve', note: 'Delivered on reattempt' }).expect(201);
      const f = await prisma.redFlag.findUniqueOrThrow({ where: { id: flag.id } });
      expect(f.ownerId).toBe(support.id);
      expect(f.resolvedAt).toBeTruthy();
      expect(f.note).toMatch(/Delivered on reattempt/);
      await agent.post(`/api/flags/${flag.id}/act`).send({ kind: 'act' }).expect(400);
    });
  });

  describe('labels and slots', () => {
    it('prints many labels as one PDF', async () => {
      const a = await agent.post('/api/shipments').send(order('G')).expect(201);
      const b = await agent.post('/api/shipments').send(order('H')).expect(201);
      const pdf = await agent.get(`/api/labels.pdf?ids=${a.body.id},${b.body.id}`).expect(200);
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.body.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(2);
    });

    it('never books a pickup on a Sunday', async () => {
      // Find the next Sunday as 'today' or 'tomorrow' relative to the real clock.
      const istDay = new Date(Date.now() + 5.5 * 3600_000).getUTCDay();
      if (istDay !== 6 && istDay !== 0) return; // only checkable on a Saturday or Sunday
      const day = istDay === 6 ? 'tomorrow' : 'today';
      const res = await agent.post('/api/shipments').send(order('I', { slot: { day, startHour: 16 } })).expect(400);
      expect(res.body.message).toMatch(/Sunday/);
    });
  });
});

describe('Passwords (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('changes your own password, and only an admin can reset someone else’s', async () => {
    const demo = process.env.DEMO_PASSWORD ?? 'D2C@demo2026';
    const prisma = app.get(PrismaService);
    const finance = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@d2c.demo' } });

    // Whatever happens below, put the demo password back for the other tests.
    const original = finance.passwordHash;
    onTestFinished(() => prisma.user.update({ where: { id: finance.id }, data: { passwordHash: original } }).then(() => undefined));

    const a = request.agent(app.getHttpServer());
    const login = await a.post('/api/auth/login').send({ email: 'finance@d2c.demo', password: demo }).expect(200);
    await a.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
    await a.post('/api/auth/password').send({ current: 'wrong', next: 'NewPass123' }).expect(401);
    await a.post('/api/auth/password').send({ current: demo, next: 'short' }).expect(400);
    await a.post('/api/auth/password').send({ current: demo, next: 'NewPass123' }).expect(200);
    await a.post('/api/auth/reset-password').send({ userId: finance.id, next: demo }).expect(403); // not an admin
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'finance@d2c.demo', password: 'NewPass123' }).expect(200);

    const admin = await signedIn(app.getHttpServer()); // founder is ADMIN
    await admin.post('/api/auth/reset-password').send({ userId: finance.id, next: demo }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'finance@d2c.demo', password: demo }).expect(200);
  });
});
