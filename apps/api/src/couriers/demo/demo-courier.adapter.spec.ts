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
  it('within one metro area is LOCAL', () => {
    expect(zoneFor('201309', '110017')).toBe('LOCAL'); // Noida to Delhi
    expect(zoneFor('122001', '110017')).toBe('LOCAL'); // Gurgaon to Delhi
    expect(zoneFor('400097', '401107')).toBe('LOCAL'); // Mumbai to Mira-Bhayandar
  });
  it('Noida to Mumbai is METRO, not NATIONAL', () => expect(zoneFor('201309', '400097')).toBe('METRO'));
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
    expect(q).toMatchObject({
      zone: 'LOCAL',
      chargedWeightGrams: 500,
      freight: 40,
      codCharge: 0,
      total: 40,
      etaDays: 1,
      pickupOnTimePct: 96,
    });
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

  it('every parcel reaches an end state: delivered, failed then delivered, returned, or stuck', async () => {
    const outcomes = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      for (const eta of [1, 3, 6]) {
        const scans = await delhivery.track(`AWB-${i}`, bookedAt, eta, new Date('2026-12-31T00:00:00Z'));
        const lastStatus = scans.at(-1)!.status;
        expect(['DELIVERED', 'RTO_DELIVERED', 'IN_TRANSIT']).toContain(lastStatus);
        if (lastStatus === 'IN_TRANSIT') {
          // Only a stuck parcel stops in transit, and it never reaches the destination hub.
          expect(scans.some((s) => s.remark === 'Arrived at destination hub')).toBe(false);
        }
        outcomes.set(lastStatus, (outcomes.get(lastStatus) ?? 0) + 1);
        for (let k = 1; k < scans.length; k++) {
          expect(scans[k].occurredAt.getTime()).toBeGreaterThan(scans[k - 1].occurredAt.getTime());
          // A moving parcel is scanned at least every 24 hours, so the 48-hour
          // "no scan" flag only fires for parcels that are really stuck.
          if (scans[k].status === 'IN_TRANSIT' && scans[k - 1].status === 'IN_TRANSIT') {
            expect(scans[k].occurredAt.getTime() - scans[k - 1].occurredAt.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
          }
        }
      }
    }
    // Most parcels are delivered; a few get stuck or returned.
    expect(outcomes.get('DELIVERED')!).toBeGreaterThan(400);
    expect(outcomes.get('RTO_DELIVERED')!).toBeGreaterThan(0);
    expect(outcomes.get('IN_TRANSIT')!).toBeGreaterThan(0);
  });

  it('delivers on the expected day', async () => {
    const scans = await delhivery.track('AWB-ON-TIME', bookedAt, 3, new Date('2026-12-31T00:00:00Z'));
    const delivered = scans.find((s) => s.status === 'DELIVERED' || s.status === 'NDR')!;
    const days = (delivered.occurredAt.getTime() - bookedAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(3);
    expect(days).toBeLessThan(4);
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

  it('never recommends a courier with unreliable pickups when a reliable one is available', async () => {
    const { CouriersService, RELIABLE_PICKUP_PCT } = await import('../couriers.service.js');
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
    const recommended = quotes.filter((q) => q.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].serviceable).toBe(true);
    expect(recommended[0].pickupOnTimePct).toBeGreaterThanOrEqual(RELIABLE_PICKUP_PCT);
    // Xpressbees is cheapest here but misses pickups (72%), so it is not the recommendation.
    expect(recommended[0].courierCode).not.toBe('XPRESSBEES');
    const cheaperReliable = quotes.filter(
      (q) => q.serviceable && q.pickupOnTimePct >= RELIABLE_PICKUP_PCT && q.total < recommended[0].total,
    );
    expect(cheaperReliable).toHaveLength(0);
  });
});
