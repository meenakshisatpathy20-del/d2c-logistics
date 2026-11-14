import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { JobsService } from './../src/jobs/jobs.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

process.env.JOBS_ENABLED = 'false';
const run = Date.now().toString(36).toUpperCase();

const order = (n: string) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'AccessHer',
  productName: 'Kada bangle set',
  customerName: 'Test Customer',
  customerPhone: '9812345670',
  addressLine: 'House 12, Main Road, Saket',
  city: 'New Delhi',
  pincode: '110017',
  warehouseCode: 'D2CNOI',
  paymentMode: 'COD',
  orderValue: 1499,
  codAmount: 1499,
  weightGrams: 900,
  lengthCm: 20,
  breadthCm: 15,
  heightCm: 8,
  slot: { day: 'tomorrow', startHour: 10 },
});

describe('Day 3-4: bookings, documents, pickups, today (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('books an order, saves it, and the same key returns the same booking', async () => {
    const body = { ...order('A'), idempotencyKey: `e2e-${run}-A` };
    const first = await request(app.getHttpServer()).post('/api/shipments').send(body).expect(201);
    expect(first.body).toMatchObject({ orderNumber: body.orderNumber, mode: 'DEMO' });
    expect(first.body.awb).toBeTruthy();
    expect(first.body.pickupSlot.label).toBe('10 am–12 pm');

    const again = await request(app.getHttpServer()).post('/api/shipments').send(body).expect(201);
    expect(again.body.id).toBe(first.body.id);

    const saved = await prisma.shipment.findUniqueOrThrow({ where: { id: first.body.id }, include: { events: true, pickup: true } });
    expect(saved.events.map((e) => e.status)).toContain('BOOKED');
    expect(saved.pickup?.parcelCount).toBeGreaterThanOrEqual(1);
    const audit = await prisma.auditLog.count({ where: { entityId: first.body.id, action: 'SHIPMENT_BOOKED' } });
    expect(audit).toBe(1);
  });

  it('refuses to book an order that is already booked under a different key', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/shipments')
      .send({ ...order('A'), idempotencyKey: `e2e-${run}-A-again` })
      .expect(409);
    expect(res.body.message).toMatch(/already booked/);
  });

  it('refuses a bad mobile number and an unknown warehouse', async () => {
    await request(app.getHttpServer())
      .post('/api/shipments')
      .send({ ...order('B'), customerPhone: '12345', idempotencyKey: `e2e-${run}-B` })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/shipments')
      .send({ ...order('C'), warehouseCode: 'NOPE', idempotencyKey: `e2e-${run}-C` })
      .expect(400);
  });

  it('shows the booking on the board and serves label and manifest PDFs', async () => {
    const board = await request(app.getHttpServer()).get('/api/shipments').expect(200);
    const card = board.body.find((c: { orderNumber: string }) => c.orderNumber === `E2E-${run}-A`);
    expect(card).toMatchObject({ brand: 'AccessHer', lane: 'TO_PACK', payment: 'COD' });

    const label = await request(app.getHttpServer()).get(card.labelUrl).expect(200);
    expect(label.headers['content-type']).toMatch(/application\/pdf/);
    expect(label.body.subarray(0, 4).toString()).toBe('%PDF');

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: card.id } });
    const manifest = await request(app.getHttpServer()).get(`/api/pickups/${shipment.pickupId}/manifest.pdf`).expect(200);
    expect(manifest.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('books a bulk file row by row, keeping bad rows out', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/shipments/bulk')
      .send({
        batchKey: `e2e-batch-${run}`,
        rows: [order('D'), order('E'), { ...order('F'), pincode: '781006', warehouseCode: 'NOPE' }],
      })
      .expect(201);
    expect(res.body.booked).toBe(2);
    expect(res.body.failed).toBe(1);
    expect(res.body.results.find((r: { ok: boolean }) => !r.ok).error).toMatch(/Unknown pickup warehouse/);
  });

  it('pickup rules: a courier that never confirms gets its parcels moved and a red flag raised', async () => {
    const booked = await request(app.getHttpServer())
      .post('/api/shipments')
      .send({ ...order('G'), courierCode: 'XPRESSBEES', idempotencyKey: `e2e-${run}-G` })
      .expect(201);
    const before = await prisma.shipment.findUniqueOrThrow({ where: { id: booked.body.id }, include: { pickup: true } });

    // Run the rules from inside the confirmation window up to well after the slot.
    const jobs = app.get(JobsService);
    const slotStart = before.pickup!.slotStart.getTime();
    for (let t = slotStart - 90 * 60 * 1000; t <= slotStart + 30 * 60 * 60 * 1000; t += 30 * 60 * 1000) {
      await jobs.runOnce(new Date(t));
    }

    const after = await prisma.shipment.findUniqueOrThrow({ where: { id: booked.body.id }, include: { pickup: true, events: true } });
    const oldPickup = await prisma.pickup.findUniqueOrThrow({ where: { id: before.pickupId! } });
    // Either Xpressbees confirmed and collected, or the parcel was moved and the move was flagged.
    if (oldPickup.status === 'PICKED_UP') {
      expect(after.status).not.toBe('BOOKED');
    } else {
      expect(['REASSIGNED', 'MISSED']).toContain(oldPickup.status);
      expect(after.pickupId).not.toBe(before.pickupId);
      const flag = await prisma.redFlag.findFirst({ where: { pickupId: oldPickup.id } });
      expect(flag?.ownerId).toBeTruthy();
    }
    expect(after.events.length).toBeGreaterThan(1);
  });

  it('advance COD: the courier collects only the balance, and the label says so', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/shipments')
      .send({ ...order('H'), orderValue: 1299, codAmount: 1299, codAdvance: 99, idempotencyKey: `e2e-${run}-H` })
      .expect(201);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: res.body.id }, include: { order: true } });
    expect(Number(s.order.codAmount)).toBe(1200);
    expect(Number(s.order.codAdvance)).toBe(99);
    expect(s.order.advanceStatus).toBe('PAID');

    const policy = await request(app.getHttpServer()).get('/api/cod-advance?orderValue=1299').expect(200);
    expect(policy.body.advance).toBe(99);

    await request(app.getHttpServer())
      .post('/api/shipments')
      .send({ ...order('I'), orderValue: 40, codAdvance: 49, idempotencyKey: `e2e-${run}-I` })
      .expect(400);
  });

  it('today returns needs-you items, pickups, pulse and brands', async () => {
    const res = await request(app.getHttpServer()).get('/api/today').expect(200);
    expect(res.body).toHaveProperty('summary.pickupsDue');
    expect(Array.isArray(res.body.needsYou)).toBe(true);
    expect(Array.isArray(res.body.pickups)).toBe(true);
    expect(res.body.pulse).toHaveProperty('codToCollect');
    expect(res.body.pulse).toHaveProperty('advancesHeld');
    for (const n of res.body.needsYou) expect(n.owner).toBeTruthy();
  });
});
