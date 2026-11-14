import type { RateRequest } from '../courier.types.js';
import { chargedWeightGrams, DemoCourierAdapter } from './demo-courier.adapter.js';
import { DEMO_COURIERS } from './profiles.js';
import { zoneFor } from './zones.js';

const delhivery = new DemoCourierAdapter(DEMO_COURIERS.find((c) => c.code === 'DELHIVERY')!);
const blitz = new DemoCourierAdapter(DEMO_COURIERS.find((c) => c.code === 'BLITZ')!);

const base: RateRequest = {
  originPincode: '400097', // Malad East, Mumbai
  destinationPincode: '400064', // Malad West, Mumbai
  weightGrams: 400,
  lengthCm: 10,
  breadthCm: 10,
  heightCm: 10,
  paymentMode: 'PREPAID',
  codAmount: 0,
};

describe('zoneFor', () => {
  it('same first 3 digits is LOCAL', () => expect(zoneFor('400097', '400064')).toBe('LOCAL'));
  it('two metros is METRO', () => expect(zoneFor('400097', '110001')).toBe('METRO'));
  it('same postal region is REGIONAL', () => expect(zoneFor('400097', '431001')).toBe('REGIONAL'));
  it('different regions is NATIONAL', () => expect(zoneFor('400097', '751001')).toBe('NATIONAL'));
  it('North East is SPECIAL', () => {
    expect(zoneFor('400097', '781001')).toBe('SPECIAL');
    expect(zoneFor('400097', '793001')).toBe('SPECIAL');
  });
});

describe('chargedWeightGrams', () => {
  it('rounds actual weight up to the next 500 g', () => {
    expect(chargedWeightGrams({ ...base, weightGrams: 501 })).toBe(1000);
  });
  it('uses volumetric weight when the box is light but large', () => {
    // 40x30x20 / 5000 = 4.8 kg -> 5000 g
    expect(chargedWeightGrams({ ...base, weightGrams: 300, lengthCm: 40, breadthCm: 30, heightCm: 20 })).toBe(5000);
  });
});

describe('DemoCourierAdapter.quote', () => {
  it('prices a local 500 g prepaid parcel at the base freight', () => {
    const q = delhivery.quote(base);
    expect(q).toMatchObject({ zone: 'LOCAL', chargedWeightGrams: 500, freight: 40, codCharge: 0, total: 40, etaDays: 1 });
  });

  it('charges the higher of fixed or percentage COD fee', () => {
    expect(delhivery.quote({ ...base, paymentMode: 'COD', codAmount: 500 }).codCharge).toBe(30);
    expect(delhivery.quote({ ...base, paymentMode: 'COD', codAmount: 4000 }).codCharge).toBe(70);
  });

  it('marks hyperlocal couriers unserviceable outside their city', () => {
    expect(blitz.quote(base).serviceable).toBe(true);
    expect(blitz.quote({ ...base, destinationPincode: '110001' }).serviceable).toBe(false);
  });
});

describe('DemoCourierAdapter.book', () => {
  const req = { ...base, idempotencyKey: 'order-18909', orderNumber: '18909' };
  const now = new Date('2026-11-14T10:00:00Z');

  it('returns the same AWB for the same idempotency key', async () => {
    const a = await delhivery.book(req, now);
    const b = await delhivery.book(req, now);
    expect(a.awb).toBe(b.awb);
    expect(a.awb).toHaveLength(14);
    expect(a.awb.startsWith('1490')).toBe(true);
  });

  it('refuses to book where the courier does not deliver', async () => {
    await expect(blitz.book({ ...req, destinationPincode: '110001' }, now)).rejects.toThrow('does not deliver');
  });
});

describe('DemoCourierAdapter.track', () => {
  const bookedAt = new Date('2026-11-10T10:00:00Z');

  it('shows only the scans that have happened by now', async () => {
    const early = await delhivery.track('ANY-AWB', bookedAt, 3, new Date(bookedAt.getTime() + 2 * 60 * 60 * 1000));
    expect(early.map((s) => s.status)).toEqual(['BOOKED', 'PICKUP_SCHEDULED']);
  });

  it('always starts with BOOKED and lists scans in time order', async () => {
    const all = await delhivery.track('ANY-AWB', bookedAt, 3, new Date('2026-12-31T00:00:00Z'));
    expect(all[0].status).toBe('BOOKED');
    for (let i = 1; i < all.length; i++) {
      expect(all[i].occurredAt.getTime()).toBeGreaterThanOrEqual(all[i - 1].occurredAt.getTime());
    }
  });
});

describe('CouriersService.compareRates', () => {
  it('puts the faster courier first when two cost the same', async () => {
    const { CouriersService } = await import('../couriers.service.js');
    const quotes = new CouriersService().compareRates({
      originPincode: '400097',
      destinationPincode: '110017',
      weightGrams: 900,
      lengthCm: 20,
      breadthCm: 15,
      heightCm: 8,
      paymentMode: 'COD',
      codAmount: 1499,
    });
    const serviceable = quotes.filter((q) => q.serviceable);
    for (let i = 1; i < serviceable.length; i++) {
      const [prev, cur] = [serviceable[i - 1], serviceable[i]];
      expect(cur.total).toBeGreaterThanOrEqual(prev.total);
      if (cur.total === prev.total) expect(cur.etaDays).toBeGreaterThanOrEqual(prev.etaDays);
    }
    expect(serviceable[0].courierCode).toBe('XPRESSBEES');
  });
});
