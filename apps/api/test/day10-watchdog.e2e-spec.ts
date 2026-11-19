import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { IssuesService } from './../src/issues/issues.service.js';
import { WatchdogService } from './../src/jobs/watchdog.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const run = `W${Date.now().toString(36).toUpperCase()}`;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const order = (n: string, extra: object = {}) => ({
  orderNumber: `E2E-${run}-${n}`,
  productBrand: 'Swarg Homes',
  productName: 'Cushion covers',
  customerName: 'Deadline Tester',
  customerPhone: '9812345675',
  addressLine: 'Flat 8, Lake Road, Kandivali',
  city: 'Mumbai',
  pincode: '400101',
  warehouseCode: 'WHUY73',
  paymentMode: 'COD',
  orderValue: 1500,
  weightGrams: 900,
  lengthCm: 30,
  breadthCm: 20,
  heightCm: 10,
  idempotencyKey: `e2e-${run}-${n}`,
  ...extra,
});

describe('Day 10: nothing goes quiet (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let watchdog: WatchdogService;
  let founder: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    watchdog = app.get(WatchdogService);
    founder = await signedIn(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  const book = async (n: string, extra: object = {}) => {
    const r = await founder.post('/api/shipments').send(order(n, extra)).expect(201);
    return prisma.shipment.findUniqueOrThrow({ where: { id: r.body.id }, include: { order: true } });
  };
  const flagOf = (type: string, where: object) => prisma.redFlag.findFirst({ where: { type, ...where }, orderBy: { createdAt: 'desc' } });

  it('health reports the job loop', async () => {
    const r = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(r.body.jobs.status).toBe('off');
  });

  describe('warehouse working hours', () => {
    afterAll(async () => {
      await founder.patch('/api/settings/warehouses/WHUY73').send({ opensAt: 10, closesAt: 19, saturdayClosesAt: 16 });
    });

    it('rejects hours with no pickup slot in them', async () => {
      await founder.patch('/api/settings/warehouses/WHUY73').send({ opensAt: 17, closesAt: 18 }).expect(400);
      await founder.patch('/api/settings/warehouses/WHUY73').send({ closesAt: 15, saturdayClosesAt: 11 }).expect(400);
    });

    it('never books a pickup outside the declared hours', async () => {
      const w = await founder.patch('/api/settings/warehouses/WHUY73').send({ closesAt: 14, saturdayClosesAt: null }).expect(200);
      expect(w.body.hours).toBe('10 am–2 pm, closed Saturday');
      const late = await founder.post('/api/shipments').send(order('H1', { slot: { day: 'next', startHour: 16 } })).expect(400);
      expect(late.body.message).toMatch(/closed at 4 pm–6 pm/);
      const s = await book('H2');
      const p = await prisma.pickup.findUniqueOrThrow({ where: { id: s.pickupId! } });
      const ist = new Date(p.slotStart.getTime() + 5.5 * HOUR);
      expect(ist.getUTCHours()).toBeLessThan(14);
      expect(ist.getUTCDay()).not.toBe(6);
    });

    it('checks a "warehouse closed" claim against the declared hours', async () => {
      const s = await book('H3');
      const raised = await founder.post('/api/issues').send({ type: 'PICKUP_CLAIM', pickupId: s.pickupId, body: 'Executive says shutter was down' }).expect(201);
      expect(raised.body.events.map((e: { body: string }) => e.body).join(' ')).toMatch(/inside .* declared hours/);
      expect(raised.body.pickup.slotInHours).toBe(true);
      await prisma.redFlag.update({ where: { id: raised.body.id }, data: { resolvedAt: new Date(), outcome: 'Order cancelled' } });
    });
  });

  describe('failed booking', () => {
    let failing = '';
    afterAll(async () => {
      if (failing) await founder.post(`/api/couriers/${failing}/simulate-failure`).send({});
    });

    it('tries the next courier at once and raises one issue on the failing one', async () => {
      const rates = await founder
        .post('/api/couriers/rates')
        .send({ originPincode: '400067', destinationPincode: '400101', weightGrams: 900, lengthCm: 30, breadthCm: 20, heightCm: 10, paymentMode: 'COD', codAmount: 1500 })
        .expect(201);
      failing = rates.body.find((q: { recommended: boolean }) => q.recommended).courierCode;
      await founder.post(`/api/couriers/${failing}/simulate-failure`).send({ message: 'Courier authentication failed' }).expect(201);

      const first = await founder.post('/api/shipments').send(order('F1')).expect(201);
      expect(first.body.courierCode).not.toBe(failing);
      expect(first.body.failedOver[0]).toMatchObject({ courierCode: failing, reason: 'Courier authentication failed' });
      // Failing now: shown, but no longer recommended, so the next order does not wait on it.
      const after = await founder
        .post('/api/couriers/rates')
        .send({ originPincode: '400067', destinationPincode: '400101', weightGrams: 900, lengthCm: 30, breadthCm: 20, heightCm: 10, paymentMode: 'COD', codAmount: 1500 })
        .expect(201);
      const q = after.body.find((x: { courierCode: string }) => x.courierCode === failing);
      expect(q).toMatchObject({ failingNow: true, recommended: false });
      const second = await founder.post('/api/shipments').send(order('F2')).expect(201);
      expect(second.body.failedOver).toEqual([]);

      const flags = await prisma.redFlag.findMany({ where: { type: 'BOOKING_FAILED', courierCode: failing, resolvedAt: null }, include: { events: true } });
      expect(flags).toHaveLength(1);

      const health = await founder.get('/api/couriers/health').expect(200);
      expect(health.body.find((c: { code: string }) => c.code === failing)).toMatchObject({ health: 'failing', lastError: 'Courier authentication failed' });

      const issue = await founder.get(`/api/issues/${flags[0].id}`).expect(200);
      expect(issue.body.about).toMatchObject({ kind: 'courier', id: failing });
    });

    it('a courier picked by hand is not swapped silently', async () => {
      const r = await founder.post('/api/shipments').send(order('F3', { courierCode: failing })).expect(400);
      expect(r.body.message).toMatch(/failed \(Courier authentication failed\).*instead/);
      // The repeat failure is added to the same issue, not a new one.
      const flags = await prisma.redFlag.findMany({ where: { type: 'BOOKING_FAILED', courierCode: failing, resolvedAt: null }, include: { events: true } });
      expect(flags).toHaveLength(1);
      expect(flags[0].events.some((e) => e.body.includes(`#E2E-${run}-F3`))).toBe(true);
    });
  });

  describe('deadline check', () => {
    it('an order not booked in 24 hours is raised, and closes once booked', async () => {
      const w = await prisma.warehouse.findFirstOrThrow({ where: { code: 'WHUY73' } });
      const o = await prisma.order.create({
        data: {
          brandId: w.brandId, orderNumber: `E2E-${run}-NB`, pickupWarehouseId: w.id, customerName: 'Late Order', customerPhone: '9812345676',
          addressLine: 'Lake Road', city: 'Mumbai', state: 'MH', pincode: '400101', paymentMode: 'PREPAID', orderValue: 999,
          weightGrams: 500, lengthCm: 10, breadthCm: 10, heightCm: 10, items: [], createdAt: new Date(Date.now() - 30 * HOUR),
        },
      });
      await watchdog.run(new Date());
      const f = await flagOf('NOT_BOOKED', { orderId: o.id });
      expect(f?.resolvedAt).toBeNull();
      const row = await founder.get(`/api/issues/${f!.id}`).expect(200);
      expect(row.body.about).toMatchObject({ kind: 'order', label: `#E2E-${run}-NB` });
      expect(row.body.cost).toMatchObject({ value: 999 });

      await book('NB-book', { orderNumber: `E2E-${run}-NB` });
      await watchdog.run(new Date());
      expect((await prisma.redFlag.findUniqueOrThrow({ where: { id: f!.id } })).outcome).toBe('Booked');
    });

    it('a delivery date that passed is raised with the days late and COD stuck, and closes on delivery', async () => {
      const s = await book('D1');
      await prisma.shipment.update({ where: { id: s.id }, data: { status: 'IN_TRANSIT', expectedDelivery: new Date(Date.now() - 3 * DAY) } });
      await watchdog.run(new Date());
      const f = await flagOf('DELAYED', { shipmentId: s.id });
      expect(f?.resolvedAt).toBeNull();
      const row = await founder.get(`/api/issues/${f!.id}`).expect(200);
      expect(row.body.cost.daysLate).toBeGreaterThanOrEqual(2);
      expect(row.body.cost.cod).toBe(1500);
      expect(row.body.waitingOn).toBe('COURIER');

      await prisma.shipment.update({ where: { id: s.id }, data: { status: 'DELIVERED' } });
      await watchdog.run(new Date());
      expect((await prisma.redFlag.findUniqueOrThrow({ where: { id: f!.id } })).outcome).toBe('Delivered');
    });

    it('one parcel, one issue: a late parcel already in an issue gets a note, not a second issue', async () => {
      const s = await book('D3');
      await prisma.shipment.update({ where: { id: s.id }, data: { status: 'IN_TRANSIT', expectedDelivery: new Date(Date.now() - 2 * DAY) } });
      const silent = await prisma.redFlag.create({
        data: { brandId: s.brandId, shipmentId: s.id, type: 'NO_SCAN_48H', severity: 'WARNING', title: 'No scan for 60 hours', message: 'test', createdAt: new Date() },
      });
      await watchdog.run(new Date());
      await watchdog.run(new Date());
      expect(await prisma.redFlag.count({ where: { type: 'DELAYED', shipmentId: s.id } })).toBe(0);
      const notes = await prisma.issueEvent.findMany({ where: { flagId: silent.id, body: { startsWith: 'Also: Delivery date passed' } } });
      expect(notes).toHaveLength(1);
    });

    it('a hand-closed problem stays closed', async () => {
      const s = await book('D2');
      await prisma.shipment.update({ where: { id: s.id }, data: { status: 'IN_TRANSIT', expectedDelivery: new Date(Date.now() - 2 * DAY) } });
      await watchdog.run(new Date());
      const f = await flagOf('DELAYED', { shipmentId: s.id });
      await founder.post(`/api/issues/${f!.id}/act`).send({ kind: 'resolve', outcome: 'Moving again', faultParty: 'COURIER' }).expect(200);
      await watchdog.run(new Date());
      expect(await prisma.redFlag.count({ where: { type: 'DELAYED', shipmentId: s.id, resolvedAt: null } })).toBe(0);
    });

    it('parcels at a vendor past 1 working day alert the founder', async () => {
      const s = await book('P1');
      await prisma.shipment.update({ where: { id: s.id }, data: { createdAt: new Date(Date.now() - 5 * DAY) } });
      await watchdog.run(new Date());
      const f = await prisma.redFlag.findFirst({ where: { type: 'PARCELS_WAITING', resolvedAt: null, pickup: { warehouse: { code: 'WHUY73' } } } });
      expect(f?.severity).toBe('CRITICAL');
      expect(f?.title).toMatch(/parcels stuck at/);
      expect(await prisma.notification.count({ where: { kind: 'FOUNDER_ALERT', link: `/issues/${f!.id}` } })).toBeGreaterThan(0);
      await prisma.shipment.update({ where: { id: s.id }, data: { createdAt: new Date() } });
    });

    it('out for delivery with no result by 9 pm, 3 failed attempts, and a return stuck 10 days', async () => {
      const ofd = await book('O1');
      await prisma.shipment.update({ where: { id: ofd.id }, data: { status: 'OUT_FOR_DELIVERY', lastScanAt: new Date(Date.now() - 2 * DAY) } });
      const ndr = await book('O2');
      await prisma.shipment.update({ where: { id: ndr.id }, data: { status: 'NDR' } });
      await prisma.trackingEvent.createMany({
        data: [1, 2, 3].map((i) => ({ shipmentId: ndr.id, status: 'NDR' as const, location: 'Mumbai', remark: `Attempt ${i}: customer not available`, occurredAt: new Date(Date.now() - i * DAY) })),
      });
      const rto = await book('O3');
      await prisma.shipment.update({ where: { id: rto.id }, data: { status: 'RTO_INITIATED' } });
      await prisma.trackingEvent.create({ data: { shipmentId: rto.id, status: 'RTO_INITIATED', location: 'Mumbai', remark: 'Return started', occurredAt: new Date(Date.now() - 11 * DAY) } });

      await watchdog.run(new Date());
      expect((await flagOf('OFD_NO_RESULT', { shipmentId: ofd.id }))?.resolvedAt).toBeNull();
      expect((await flagOf('ATTEMPTS_3', { shipmentId: ndr.id }))?.title).toBe('3 failed delivery attempts');
      expect((await flagOf('RETURN_STUCK', { shipmentId: rto.id }))?.title).toMatch(/Return not back after 11 days/);
    });

    it('parcels not packed an hour before the slot go to the vendor, and close when packed', async () => {
      const s = await book('K1');
      const start = new Date(Date.now() + 30 * 60_000);
      await prisma.pickup.update({ where: { id: s.pickupId! }, data: { slotStart: start, slotEnd: new Date(start.getTime() + 2 * HOUR) } });
      await watchdog.run(new Date());
      const f = await flagOf('NOT_PACKED', { pickupId: s.pickupId });
      expect(f?.resolvedAt).toBeNull();
      const vendorTurn = await founder.get(`/api/issues/${f!.id}`).expect(200);
      expect(vendorTurn.body.waitingOn).toBe('VENDOR');

      await prisma.shipment.updateMany({ where: { pickupId: s.pickupId }, data: { packedAt: new Date() } });
      await watchdog.run(new Date());
      expect((await prisma.redFlag.findUniqueOrThrow({ where: { id: f!.id } })).outcome).toBe('Packed and ready');
    });

    it('the courier is messaged the moment an issue opens, not at the first reminder', async () => {
      const s = await book('M1');
      // A weekday 11 am IST in the future.
      let t = new Date(Date.now() + 2 * DAY);
      while (new Date(t.getTime() + 5.5 * HOUR).getUTCDay() === 0) t = new Date(t.getTime() + DAY);
      const ist = new Date(t.getTime() + 5.5 * HOUR);
      const morning = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 11) - 5.5 * HOUR);
      const f = await prisma.redFlag.create({
        data: { brandId: s.brandId, shipmentId: s.id, type: 'DELAYED', severity: 'WARNING', title: '1 day past the delivery date', message: 'test', createdAt: morning },
      });
      await app.get(IssuesService).run(morning);
      const sent = await prisma.notification.findFirst({ where: { kind: 'ISSUE_OPENED', link: `/issues/${f.id}` } });
      expect(sent?.channel).toBe('WHATSAPP');
      const room = await prisma.redFlag.findUniqueOrThrow({ where: { id: f.id }, include: { events: true } });
      expect(room.events.some((e) => e.body.startsWith('Sent to'))).toBe(true);
      expect(room.reminderCount).toBe(0);
    });

    it('shows what open problems cost per courier', async () => {
      const r = await founder.get('/api/issues/delay-cost').expect(200);
      expect(r.body.rows.length).toBeGreaterThan(0);
      expect(r.body.rows[0]).toHaveProperty('value');
      expect(r.body.total.value).toBeGreaterThan(0);
    });
  });
});
