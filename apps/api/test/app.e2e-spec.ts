import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
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
    const res = await request(app.getHttpServer()).get('/api/couriers').expect(200);
    expect(res.body).toHaveLength(8);
    expect(res.body.every((c: { mode: string }) => c.mode === 'DEMO')).toBe(true);
  });

  it('POST /api/couriers/rates rejects a bad pin code', () => {
    return request(app.getHttpServer())
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

  it('POST /api/couriers/rates returns quotes, cheapest serviceable first', async () => {
    const res = await request(app.getHttpServer())
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
