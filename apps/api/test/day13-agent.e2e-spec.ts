import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { readIntent } from './../src/agent/agent.service.js';
import { parseWhen } from './../src/agent/when.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
process.env.AGENT_INBOUND_TOKEN = 'test-inbound-token-123';
const run = `A${Date.now().toString(36).toUpperCase()}`;
const DAY = 24 * 3600_000;

const order = (n: string) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Kasrat',
  productName: 'Yoga mat',
  customerName: 'Agent Tester',
  customerPhone: '9812345611',
  addressLine: 'Flat 2, Hill Road, Bandra West',
  city: 'Mumbai',
  pincode: '400050',
  warehouseCode: 'WHUY73',
  paymentMode: 'PREPAID',
  orderValue: 1499,
  weightGrams: 900,
  lengthCm: 30,
  breadthCm: 20,
  heightCm: 10,
  idempotencyKey: `e2e-${run}-${n}`,
});

describe('Day 13: the ops agent does the chasing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let founder: Awaited<ReturnType<typeof signedIn>>;
  let shipment: { id: string; pickupId: string | null; courierCode: string; orderId: string };
  const ask = (text: string) => founder.post('/api/agent/ask').send({ text }).expect(200);

  beforeAll(async () => {
    const m: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    founder = await signedIn(app.getHttpServer());
    const r = await founder.post('/api/shipments').send(order('1')).expect(201);
    // Booked 3 days ago and never picked up: the ageing problem.
    shipment = await prisma.shipment.update({ where: { id: r.body.id }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
  });

  afterAll(async () => app.close());

  it('reads plain words and times', () => {
    const now = new Date('2026-11-23T05:00:00Z'); // 10:30 am IST
    expect(parseWhen('by 4 pm', now)?.toISOString()).toBe('2026-11-23T10:30:00.000Z');
    expect(parseWhen('kal 11am', now)?.toISOString()).toBe('2026-11-24T05:30:00.000Z');
    expect(parseWhen('in 2 hours', now)?.toISOString()).toBe('2026-11-23T07:00:00.000Z');
    expect(parseWhen('AWB 1234567', now)).toBeNull();
    expect(readIntent('chase delhivery', now)).toMatchObject({ kind: 'chase', courier: 'delhivery' });
    expect(readIntent('Credit ₹1,788 from Delhivery by 5 pm', now)).toMatchObject({ kind: 'credit', amount: 1788, courier: 'delhivery' });
    expect(readIntent('book all new orders', now)).toMatchObject({ kind: 'book', allNew: true });
    expect(readIntent('where is 1042', now)).toMatchObject({ kind: 'status', refs: ['1042'] });
  });

  it('shows ageing shipments with days, grouped by courier and vendor', async () => {
    const r = await ask('Show ageing shipments');
    const items = r.body.data.groups.flatMap((g: { items: { days?: number }[] }) => g.items);
    expect(items.some((i: { days?: number }) => (i.days ?? 0) >= 3)).toBe(true);
  });

  it('chase opens a pickup issue and messages the courier, on the record', async () => {
    const r = await ask('Chase all stuck pickups');
    expect(r.body.data.actions).toBeGreaterThan(0);
    const f = await prisma.redFlag.findFirst({ where: { pickupId: shipment.pickupId, resolvedAt: null } });
    expect(f).not.toBeNull();
    const feed = await founder.get('/api/agent/feed').expect(200);
    expect(feed.body.stats.actions).toBeGreaterThan(0);
  });

  it('a courier reply with a time becomes a promise (WhatsApp webhook seam)', async () => {
    const f = await prisma.redFlag.findFirstOrThrow({ where: { pickupId: shipment.pickupId, resolvedAt: null } });
    const contact = await prisma.courierContact.findFirst({ where: { courierCode: shipment.courierCode, active: true } });
    if (!contact) return; // no contact seeded for this courier
    await prisma.redFlag.update({ where: { id: f.id }, data: { waitingOn: 'COURIER', courierContactId: contact.id, lastReminderAt: new Date() } });
    await request(app.getHttpServer()).post('/api/agent/inbound').send({ phone: contact.phone, text: 'hi' }).expect(401);
    const r = await request(app.getHttpServer()).post('/api/agent/inbound').set('x-agent-token', 'test-inbound-token-123').send({ phone: `+91${contact.phone}`, text: 'Ramesh will reach in 2 hours' }).expect(200);
    expect(r.body.kind).toBe('PROMISE');
    const after = await prisma.redFlag.findUniqueOrThrow({ where: { id: r.body.flagId } });
    expect(after.promiseAt).not.toBeNull();
  });

  it('status by order number', async () => {
    const r = await ask(`where is E2E-${run}-1`);
    expect(r.body.body).toContain(`E2E-${run}-1`);
  });

  it('switching a courier waits for a person to confirm', async () => {
    const c = await prisma.courier.findUniqueOrThrow({ where: { code: shipment.courierCode } });
    const r = await ask(`switch ${c.name} at Laxmi Imitation`);
    expect(r.body.data.approvalId).toBeTruthy();
    const before = await prisma.agentApproval.findUniqueOrThrow({ where: { id: r.body.data.approvalId } });
    expect(before.status).toBe('PENDING');
    const done = await founder.post(`/api/agent/approvals/${before.id}/confirm`).expect(200);
    expect(done.body.body).toMatch(/approved|failed/);
    await founder.post(`/api/agent/approvals/${before.id}/confirm`).expect(400);
  });

  it('a money promise becomes a case that is chased', async () => {
    const r = await ask('Credit ₹1,788 from Delhivery by 5 pm');
    expect(r.body.body).toContain('₹1,788');
    const f = await prisma.redFlag.findFirst({ where: { type: 'CREDIT_NOTE_PENDING', courierCode: 'DELHIVERY', resolvedAt: null } });
    expect(f).not.toBeNull();
  });

  it('imports the courier contact sheet and reports bad lines', async () => {
    const r = await founder
      .post('/api/settings/courier-contacts/import')
      .send({ csv: 'courier,name,role,mobile\nDelhivery, Import Tester, pickup lead, 9800011122\nNobody Express, X Y, hub, 9800011123\nEkart, Bad Phone, hub, 12345' })
      .expect(200);
    expect(r.body.added + r.body.updated).toBe(1);
    expect(r.body.errors.map((e: { line: number }) => e.line)).toEqual([3, 4]);
    await prisma.courierContact.deleteMany({ where: { phone: '9800011122', name: 'Import Tester' } });
  });

  it('Chase now on an issue messages the partner, and the summary covers the day', async () => {
    const f = await prisma.redFlag.findFirstOrThrow({ where: { resolvedAt: null, waitingOn: { in: ['COURIER', 'VENDOR'] } } });
    const r = await founder.post(`/api/agent/issues/${f.id}/chase`).expect(200);
    expect(r.body.body).toContain('chase');
    const s = await ask("Today's summary");
    expect(s.body.body).toMatch(/^Today: /);
  });
});
