import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ScorecardsService } from './../src/couriers/scorecards.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { signedIn } from './sign-in.js';

process.env.JOBS_ENABLED = 'false';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const RATE = { originPincode: '400064', destinationPincode: '110017', weightGrams: 900, lengthCm: 30, breadthCm: 20, heightCm: 10, paymentMode: 'PREPAID', codAmount: 0 };

describe('Day 12: earned courier scorecards (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let founder: Awaited<ReturnType<typeof signedIn>>;
  const made: string[] = [];
  let worst = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    founder = await signedIn(app.getHttpServer());

    // The courier booking recommends today gets a bad fortnight: 2 on time, 1 late, 9 missed.
    const rates = await founder.post('/api/couriers/rates').send(RATE).expect(201);
    worst = rates.body.find((q: { recommended: boolean }) => q.recommended).courierCode;
    const w = await prisma.warehouse.findFirstOrThrow({ where: { code: 'WHUY73' } });
    const base = Date.UTC(2026, 10, 1, 4, 30) + Math.floor(Math.random() * 1000) * 60_000;
    for (let i = 0; i < 12; i++) {
      const slotStart = new Date(Date.now() - (2 + i) * DAY + (base % HOUR));
      const slotEnd = new Date(slotStart.getTime() + 2 * HOUR);
      const status = i < 3 ? 'PICKED_UP' : 'MISSED';
      const p = await prisma.pickup.create({
        data: {
          brandId: w.brandId, warehouseId: w.id, courierCode: worst, slotStart, slotEnd, status, parcelCount: 3,
          pickedUpAt: i < 2 ? new Date(slotStart.getTime() + HOUR) : i === 2 ? new Date(slotEnd.getTime() + 3 * HOUR) : null,
          missReason: i >= 3 ? 'Executive did not arrive' : null,
        },
      });
      made.push(p.id);
    }
  });

  afterAll(async () => {
    await prisma.pickup.deleteMany({ where: { id: { in: made } } });
    await app.close();
  });

  it('pickup on-time % is earned from our own pickups', async () => {
    const r = await founder.get('/api/scorecards').expect(200);
    const card = r.body.find((c: { code: string }) => c.code === worst);
    expect(card.pickups.due).toBeGreaterThanOrEqual(12);
    expect(card.pickups.missed).toBeGreaterThanOrEqual(9);
    expect(card.pickups.pct).toBe(Math.round((card.pickups.onTime / card.pickups.due) * 100));
    expect(card.pickups.pct).toBeLessThan(50);
    expect(card.usedSource).toBe('earned');
    // A courier with too little history shows the contract figure, marked as such.
    const thin = r.body.find((c: { pickups: { due: number } }) => c.pickups.due < 5);
    if (thin) expect(thin.usedSource).toBe('contract');
  });

  it('a courier that keeps missing pickups is no longer recommended, whatever its price', async () => {
    await app.get(ScorecardsService).refresh(new Date());
    const rates = await founder.post('/api/couriers/rates').send(RATE).expect(201);
    const q = rates.body.find((x: { courierCode: string }) => x.courierCode === worst);
    expect(q.pickupPctSource).toBe('earned');
    expect(q.pickupOnTimePct).toBeLessThan(50);
    expect(q.recommended).toBe(false);
  });

  it('the weekly review pack lists every missed pickup with when and why', async () => {
    const r = await founder.get(`/api/scorecards/${worst}/review?days=30`).expect(200);
    expect(r.body.courier.code).toBe(worst);
    expect(r.body.pickups.filter((p: { what: string }) => p.what.startsWith('Missed')).length).toBeGreaterThanOrEqual(4);
    expect(r.body.pickups.some((p: { what: string }) => p.what.startsWith('Picked up late'))).toBe(true);
    expect(r.body).toHaveProperty('brokenPromises');
    expect(r.body).toHaveProperty('ignored');
    expect(r.body).toHaveProperty('lateDeliveries');
  });

  it('answering in time is measured from the first ask to the courier\'s reply', async () => {
    const w = await prisma.warehouse.findFirstOrThrow({ where: { code: 'WHUY73' } });
    const t0 = new Date(Date.now() - 3 * DAY);
    const f = await prisma.redFlag.create({ data: { brandId: w.brandId, courierCode: 'PIKNDEL', type: 'OTHER', severity: 'WARNING', title: 'Test', message: 'test', createdAt: t0 } });
    await prisma.issueEvent.createMany({
      data: [
        { flagId: f.id, kind: 'ASK', actorName: 'Ops', actorParty: 'OURS', body: 'Please check', createdAt: t0 },
        { flagId: f.id, kind: 'PARTNER_REPLY', actorName: 'Meera', actorParty: 'COURIER', body: 'On it', createdAt: new Date(t0.getTime() + 30 * 60_000) },
      ],
    });
    const r = await founder.get('/api/scorecards').expect(200);
    const card = r.body.find((c: { code: string }) => c.code === 'PIKNDEL');
    expect(card.issues.askedOfThem).toBeGreaterThanOrEqual(1);
    expect(card.issues.answeredInTime).toBeGreaterThanOrEqual(1);
    await prisma.issueEvent.deleteMany({ where: { flagId: f.id } });
    await prisma.redFlag.delete({ where: { id: f.id } });
  });

  it('partners cannot see scorecards', async () => {
    const contact = await prisma.courierContact.findFirstOrThrow({ where: { courierCode: worst, active: true } });
    const request = (await import('supertest')).default;
    const agent = request.agent(app.getHttpServer());
    const l = await agent.post('/api/auth/partner-login').send({ phone: contact.phone }).expect(200);
    await agent.post('/api/auth/verify').send({ challengeId: l.body.challengeId, code: l.body.demoCode }).expect(200);
    await agent.get('/api/scorecards').expect(403);
  });
});
