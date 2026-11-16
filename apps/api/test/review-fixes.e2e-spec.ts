import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const run = `R${Date.now().toString(36).toUpperCase()}`;
const DEMO = process.env.DEMO_PASSWORD ?? 'D2C@demo2026';

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Kasrat',
  productName: 'Yoga mat',
  customerName: 'Review Tester',
  customerPhone: '9812345673',
  addressLine: 'Flat 2, Park Street, Salt Lake',
  city: 'Kolkata',
  pincode: '700091',
  warehouseCode: 'D2CNOI',
  paymentMode: 'PREPAID',
  orderValue: 999,
  weightGrams: 800,
  lengthCm: 30,
  breadthCm: 20,
  heightCm: 10,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

async function teamAgent(app: INestApplication<App>, email: string, password = DEMO) {
  const a = request.agent(app.getHttpServer());
  const login = await a.post('/api/auth/login').send({ email, password }).expect(200);
  await a.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
  return a;
}

describe('Review fixes before go-live (e2e)', () => {
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
    await founder.patch('/api/couriers/EKART').send({ active: true });
    await app.close();
  });

  it('a courier switched off is never offered or booked, and comes back when switched on', async () => {
    const ops = await teamAgent(app, 'ops@d2c.demo');
    await ops.patch('/api/couriers/EKART').send({ active: false }).expect(400); // reason needed
    await ops.patch('/api/couriers/EKART').send({ active: false, reason: 'Account on hold: payment not adjusted' }).expect(200);
    const rates = await founder
      .post('/api/couriers/rates')
      .send({ originPincode: '201309', destinationPincode: '700091', weightGrams: 800, lengthCm: 30, breadthCm: 20, heightCm: 10, paymentMode: 'PREPAID' })
      .expect(201);
    const ekart = rates.body.find((q: { courierCode: string }) => q.courierCode === 'EKART');
    expect(ekart.serviceable).toBe(false);
    expect(ekart.switchedOff).toBe(true);
    expect(rates.body.find((q: { recommended: boolean }) => q.recommended).courierCode).not.toBe('EKART');
    const res = await founder.post('/api/shipments').send(order('C1', { courierCode: 'EKART' })).expect(400);
    expect(res.body.message).toMatch(/switched off/);
    const booked = await founder.post('/api/shipments').send(order('C2')).expect(201);
    expect(booked.body.courierCode).not.toBe('EKART');
    const support = await teamAgent(app, 'support@d2c.demo');
    await support.patch('/api/couriers/EKART').send({ active: true }).expect(403);
    await ops.patch('/api/couriers/EKART').send({ active: true }).expect(200);
  });

  it('a password reset signs that person out everywhere', async () => {
    const before = await teamAgent(app, 'support@d2c.demo');
    await before.get('/api/auth/me').expect(200);
    const support = await prisma.user.findUniqueOrThrow({ where: { email: 'support@d2c.demo' } });
    const original = support.passwordHash;
    try {
      await founder.post('/api/auth/reset-password').send({ userId: support.id, next: 'Reset1234' }).expect(200);
      const res = await before.get('/api/auth/me').expect(401);
      expect(res.body.message).toMatch(/password was changed/);
      // Changing your own password keeps you signed in on this browser.
      const fresh = await teamAgent(app, 'support@d2c.demo', 'Reset1234');
      await fresh.post('/api/auth/password').send({ current: 'Reset1234', next: 'Again1234' }).expect(200);
      await fresh.get('/api/auth/me').expect(200);
    } finally {
      await prisma.user.update({ where: { id: support.id }, data: { passwordHash: original, passwordChangedAt: null } });
    }
  });

  it('on-screen vendor codes work only for demo numbers until SMS is connected', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: 'd2c' } });
    const w = await prisma.warehouse.findFirstOrThrow({ where: { brandId: brand.id, code: 'WHTO34' } });
    const real = `97${String(Date.now()).slice(-8)}`;
    const user = await prisma.user.create({ data: { brandId: brand.id, name: 'Real vendor', phone: real, role: 'VENDOR', warehouseId: w.id } });
    try {
      const res = await request(app.getHttpServer()).post('/api/auth/vendor-login').send({ phone: real }).expect(503);
      expect(res.body.message).toMatch(/SMS/);
      await request(app.getHttpServer()).post('/api/auth/vendor-login').send({ phone: '9800000014' }).expect(200);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('admins add team members and warehouses; a warehouse contact becomes its vendor sign-in', async () => {
    const email = `new.${run.toLowerCase()}@d2c.demo`;
    const phone = `91${String(Date.now()).slice(-8)}`;
    const added = await founder
      .post('/api/settings/team')
      .send({ name: 'New Ops', email, phone, role: 'OPS', password: 'Start1234' })
      .expect(201);
    await founder.post('/api/settings/team').send({ name: 'Dup', email, phone, role: 'OPS', password: 'Start1234' }).expect(409);
    const newbie = await teamAgent(app, email, 'Start1234');
    await newbie.get('/api/orders').expect(200);
    await founder.patch(`/api/settings/team/${added.body.id}`).send({ active: false }).expect(200);
    await newbie.get('/api/orders').expect(401);

    const ops = await teamAgent(app, 'ops@d2c.demo');
    await ops.post('/api/settings/team').send({ name: 'X', email: 'x@d2c.demo', phone: '9111111111', role: 'OPS', password: 'Start1234' }).expect(403);
    const code = `T${run.slice(-6)}`;
    const vendorPhone = `980000009${String(Date.now()).slice(-1)}`;
    const w = await ops
      .post('/api/settings/warehouses')
      .send({ code, name: 'Test Vendor', address: 'Shop 3, Market Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', contactName: 'Ravi', contactPhone: vendorPhone })
      .expect(201);
    expect(w.body.vendorLogin.active).toBe(true);
    const vendor = await prisma.user.findFirstOrThrow({ where: { phone: vendorPhone, role: 'VENDOR' } });
    expect(vendor.name).toBe('Test Vendor team');
    await ops.patch(`/api/settings/warehouses/${code}`).send({ contactName: 'Suresh' }).expect(200);
    const list = await ops.get('/api/settings/warehouses').expect(200);
    expect(list.body.find((x: { code: string }) => x.code === code).contactName).toBe('Suresh');
  });

  it('cannot deactivate someone who still owns open problems', async () => {
    const ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@d2c.demo' } });
    const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: 'd2c' } });
    const flag = await prisma.redFlag.create({
      data: { brandId: brand.id, type: `TEST_${run}`, severity: 'WARNING', title: 'Owned', message: 'x', ownerId: ops.id },
    });
    const res = await founder.patch(`/api/settings/team/${ops.id}`).send({ active: false }).expect(400);
    expect(res.body.message).toMatch(/Reassign/);
    await prisma.redFlag.update({ where: { id: flag.id }, data: { resolvedAt: new Date() } });
  });
});
