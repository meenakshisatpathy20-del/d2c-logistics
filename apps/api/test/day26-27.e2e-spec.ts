import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const TOKEN = 'test-payment-token-123';
const AGENT_TOKEN = 'test-agent-token-1234';
const run = `P${Date.now().toString(36).toUpperCase()}`;

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'AccessHer',
  productName: 'Pearl earrings',
  customerName: 'Guard Tester',
  customerPhone: '9812345675',
  addressLine: 'Flat 4, Park Street, Kolkata',
  city: 'Kolkata',
  pincode: '700016',
  warehouseCode: 'WHUY73',
  paymentMode: 'PREPAID',
  orderValue: 499,
  weightGrams: 300,
  lengthCm: 20,
  breadthCm: 15,
  heightCm: 8,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

/** "28/11/2026, 14:05" for a moment, in India time, as a WhatsApp export writes it. */
function stamp(d: Date) {
  const i = new Date(d.getTime() + 330 * 60_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(i.getUTCDate())}/${p(i.getUTCMonth() + 1)}/${i.getUTCFullYear()}, ${p(i.getUTCHours())}:${p(i.getUTCMinutes())}`;
}

describe('Days 26-27: triage agent and payment guard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let founder: Awaited<ReturnType<typeof signedIn>>;
  const before = { guard: process.env.PAYMENT_GUARD, pay: process.env.PAYMENT_WEBHOOK_TOKEN, agent: process.env.AGENT_INBOUND_TOKEN };

  beforeAll(async () => {
    process.env.PAYMENT_GUARD = 'enforce';
    process.env.PAYMENT_WEBHOOK_TOKEN = TOKEN;
    process.env.AGENT_INBOUND_TOKEN = AGENT_TOKEN;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    founder = await signedIn(app.getHttpServer());
  });

  afterAll(async () => {
    process.env.PAYMENT_GUARD = before.guard;
    process.env.PAYMENT_WEBHOOK_TOKEN = before.pay;
    process.env.AGENT_INBOUND_TOKEN = before.agent;
    await app.close();
  });

  const payEvent = (body: object) => request(app.getHttpServer()).post('/api/payments/events').set('x-payment-token', TOKEN).send(body);
  const orderOf = (n: string) => prisma.order.findFirstOrThrow({ where: { orderNumber: `E2E-${run}-${n}` }, include: { shipments: true, redFlags: { include: { events: true } } } });

  // ---------- Payment guard ----------

  it('a prepaid order with no money in our account is not booked; it books itself when the money arrives', async () => {
    const r = await founder.post('/api/shipments').send(order('A')).expect(400);
    expect(r.body.message).toMatch(/payment not verified/i);
    let o = await orderOf('A');
    expect(o.status).toBe('NEW');
    expect(o.paymentStatus).toBe('PENDING');
    expect(o.shipments).toHaveLength(0);
    const flag = o.redFlags.find((f) => f.type === 'PAYMENT_PENDING' && !f.resolvedAt);
    expect(flag?.waitingOn).toBe('CUSTOMER');
    expect(await prisma.notification.count({ where: { kind: 'PAYMENT_CUSTOMER', to: '+91 9812345675' } })).toBeGreaterThan(0);

    await request(app.getHttpServer()).post('/api/payments/events').send({}).expect(401);
    const p = await payEvent({ event: 'payment.captured', orderNumber: o.orderNumber, reference: `pay_${run}_A`, amount: 499 }).expect(200);
    expect(p.body.did).toMatch(/Booked with/);
    o = await orderOf('A');
    expect(o.paymentStatus).toBe('VERIFIED');
    expect(o.shipments.filter((s) => s.status !== 'CANCELLED')).toHaveLength(1);
    const closed = o.redFlags.find((f) => f.id === flag!.id)!;
    expect(closed.resolvedAt).not.toBeNull();
    expect(closed.outcome).toBe('Payment verified');
  });

  it('a refund before pickup cancels the booking: nothing leaves without the money', async () => {
    await payEvent({ event: 'payment.captured', orderNumber: `E2E-${run}-B`, reference: `pay_${run}_B`, amount: 499 }).expect(200);
    const b = await founder.post('/api/shipments').send(order('B')).expect(201);
    const r = await payEvent({ event: 'refund.processed', orderNumber: `E2E-${run}-B`, reference: `pay_${run}_B`, amount: 499 }).expect(200);
    expect(r.body.status).toBe('REFUNDED');
    expect(r.body.did).toMatch(/cancelled before pickup/);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
    expect(s.status).toBe('CANCELLED');
    const o = await orderOf('B');
    expect(o.paymentStatus).toBe('REFUNDED');
    expect(o.redFlags.some((f) => f.type === 'PAYMENT_REFUNDED' && !f.resolvedAt)).toBe(true);
  });

  it('a refund after the courier has it raises an urgent issue to get it back', async () => {
    await payEvent({ event: 'payment.captured', orderNumber: `E2E-${run}-C`, reference: `pay_${run}_C`, amount: 499 }).expect(200);
    const b = await founder.post('/api/shipments').send(order('C')).expect(201);
    await prisma.shipment.update({ where: { id: b.body.id }, data: { status: 'IN_TRANSIT' } });
    const r = await payEvent({ event: 'refund.processed', orderNumber: `E2E-${run}-C`, reference: `pay_${run}_C`, amount: 499 }).expect(200);
    expect(r.body.did).toMatch(/urgent/i);
    const f = (await orderOf('C')).redFlags.find((x) => x.type === 'PAYMENT_REFUNDED' && !x.resolvedAt)!;
    expect(f.severity).toBe('CRITICAL');
    expect(f.title).toMatch(/already shipped/);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } })).status).toBe('IN_TRANSIT');
  });

  it('a payment into someone else\'s QR blocks the order, and the screenshot check says so', async () => {
    const csv = `Order ID,UTR,Amount,Status,Paid To\nE2E-${run}-D,UTR${run}D,499,success,starindia.mumbai@ybl\n`;
    const imp = await founder.post('/api/payments/import').send({ csv }).expect(200);
    expect(imp.body.added).toBe(1);
    expect((await founder.post('/api/payments/import').send({ csv }).expect(200)).body.unchanged).toBe(1);
    const r = await founder.post('/api/shipments').send(order('D')).expect(400);
    expect(r.body.message).toMatch(/not our account/);
    const proof = await founder.post('/api/payments/proof').send({ orderNumber: `E2E-${run}-D`, utr: `UTR${run}D` }).expect(200);
    expect(proof.body.verdict).toBe('WRONG_ACCOUNT');
    const unknown = await founder.post('/api/payments/proof').send({ orderNumber: `E2E-${run}-D`, utr: '999988887777' }).expect(200);
    expect(unknown.body.verdict).toBe('NOT_FOUND');
    expect(unknown.body.findings.join(' ')).toMatch(/not reaching us/);
    const rows = (await founder.get(`/api/orders?q=E2E-${run}-D`).expect(200)).body.rows;
    expect(rows[0].paymentHold?.status).toBe('MISMATCH');
    expect(rows[0].flag?.title).toMatch(/wrong account/);
    const g = await founder.get('/api/payments/guard').expect(200);
    expect(g.body.held.find((h: { orderNumber: string }) => h.orderNumber === `E2E-${run}-D`)?.status).toBe('MISMATCH');
  });

  // ---------- Triage agent ----------

  it('reads a courier WhatsApp chat: opens cases, logs the promise, lists AWBs not on EcomNext, never reads twice', async () => {
    await payEvent({ event: 'payment.captured', orderNumber: `E2E-${run}-T`, reference: `pay_${run}_T`, amount: 499 }).expect(200);
    const b = await founder.post('/api/shipments').send(order('T', { courierCode: 'XPRESSBEES' })).expect(201);
    const awb = b.body.awb as string;
    const t = Date.now() - 50 * 60_000;
    const chat = [
      `${stamp(new Date(t))} - Sakshi Shaw D2c: 3757${run.length}1260024 (RSM)`,
      '3757311646299',
      `${stamp(new Date(t + 60_000))} - Sakshi Shaw D2c: @~Isha ~ @~Haritha`,
      ' 1. kindly update on status of pickup',
      `Shipment is ready(AWB-${awb})`,
      // A reply with no AWB answers the message above it.
      `${stamp(new Date(t + 2 * 60_000))} - ~ Isha ~: will be picked tomorrow 11 am`,
    ].join('\n');
    const r = await founder.post('/api/agent/triage').send({ text: chat, courierCode: 'XPRESSBEES' }).expect(200);
    expect(r.body.read).toBe(3);
    expect(r.body.opened).toBe(2); // the pickup case for our AWB, and one Xpressbees case for the AWBs we do not hold
    expect(r.body.promises).toBeGreaterThanOrEqual(1);
    expect(r.body.unmatched).toEqual(expect.arrayContaining(['3757311646299']));

    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: b.body.id } });
    const f = await prisma.redFlag.findFirstOrThrow({ where: { pickupId: s.pickupId, resolvedAt: null }, include: { events: true } });
    expect(f.type).toBe('PICKUP_PENDING');
    expect(f.promiseAt).not.toBeNull();
    expect(f.waitingOn).toBe('COURIER');
    expect(f.events.some((e) => e.via === 'WHATSAPP' && e.actorParty === 'COURIER')).toBe(true);
    const courierCase = await prisma.redFlag.findFirstOrThrow({ where: { courierCode: 'XPRESSBEES', shipmentId: null, pickupId: null, resolvedAt: null, message: { contains: 'AWBs:' } } });
    expect(courierCase.message).toContain('3757311646299');
    expect(courierCase.title).toContain('3757311646299');

    const again = await founder.post('/api/agent/triage').send({ text: chat, courierCode: 'XPRESSBEES' }).expect(200);
    expect(again.body).toMatchObject({ read: 0, skipped: 3, opened: 0 });

    const ledger = await founder.get('/api/agent/triage/ledger?courier=XPRESSBEES').expect(200);
    expect(ledger.body.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('live group messages from the WhatsApp bridge are filed the same way', async () => {
    await request(app.getHttpServer()).post('/api/agent/group-message').send({ sender: 'x', text: 'y' }).expect(401);
    const r = await request(app.getHttpServer())
      .post('/api/agent/group-message')
      .set('x-agent-token', AGENT_TOKEN)
      .send({ courierCode: 'DELHIVERY', sender: 'Sakshi Shaw D2c', text: '₹1,788 credit from Delhivery still not adjusted, kindly update' })
      .expect(200);
    expect(r.body.opened + r.body.updated).toBe(1);
    expect(await prisma.redFlag.count({ where: { courierCode: 'DELHIVERY', type: 'CREDIT_NOTE_PENDING', resolvedAt: null } })).toBeGreaterThan(0);
  });
});
