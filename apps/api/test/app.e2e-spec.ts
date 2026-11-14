import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signedIn } from './sign-in.js';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    agent = await signedIn(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports the database up', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
  });

  it('GET /api/couriers lists all 8 demo couriers', async () => {
    const res = await agent.get('/api/couriers').expect(200);
    expect(res.body).toHaveLength(8);
    expect(res.body.every((c: { mode: string }) => c.mode === 'DEMO')).toBe(true);
  });

  it('POST /api/couriers/rates rejects a bad pin code', () => {
    return agent
      .post('/api/couriers/rates')
      .send({
        originPincode: '12',
        destinationPincode: '400097',
        weightGrams: 500,
        lengthCm: 10,
        breadthCm: 10,
        heightCm: 10,
        paymentMode: 'PREPAID',
      })
      .expect(400);
  });

  const booking = {
    originPincode: '400097',
    destinationPincode: '110017',
    weightGrams: 900,
    lengthCm: 20,
    breadthCm: 15,
    heightCm: 8,
    paymentMode: 'COD',
    codAmount: 1499,
    orderNumber: '18906',
    idempotencyKey: 'order-18906-attempt-1',
  };

  it('POST /api/couriers/:code/book returns an AWB, and the same key returns the same AWB', async () => {
    const first = await agent.post('/api/couriers/ekart/book').send(booking).expect(201);
    expect(first.body).toMatchObject({ courierCode: 'EKART', mode: 'DEMO' });
    expect(first.body.awb).toMatch(/^FMPC/);
    const again = await agent.post('/api/couriers/ekart/book').send(booking).expect(201);
    expect(again.body.awb).toBe(first.body.awb);
  });

  it('POST /api/couriers/:code/book refuses a courier that does not deliver there', () => {
    return agent.post('/api/couriers/blitz/book').send(booking).expect(400);
  });

  it('POST /api/couriers/:code/book refuses a missing order number', () => {
    return agent
      .post('/api/couriers/ekart/book')
      .send({ ...booking, orderNumber: '' })
      .expect(400);
  });

  it('POST /api/couriers/rates returns quotes, cheapest serviceable first', async () => {
    const res = await agent
      .post('/api/couriers/rates')
      .send({
        originPincode: '400097',
        destinationPincode: '110001',
        weightGrams: 1200,
        lengthCm: 20,
        breadthCm: 15,
        heightCm: 10,
        paymentMode: 'COD',
        codAmount: 999,
      })
      .expect(201);
    const serviceable = res.body.filter((q: { serviceable: boolean }) => q.serviceable);
    expect(serviceable.length).toBeGreaterThan(0);
    for (let i = 1; i < serviceable.length; i++) {
      expect(serviceable[i].total).toBeGreaterThanOrEqual(serviceable[i - 1].total);
    }
  });
});
