import { riskLevel, rtoRisk } from './rto-risk.js';

const base = { paymentMode: 'PREPAID' as const, orderValue: 999, codAdvance: 0, pincode: '110017', addressLine: 'House 12, Main Road, Saket', pastReturns: 0 };

describe('RTO risk', () => {
  it('prepaid with a full address is low risk', () => {
    expect(riskLevel(rtoRisk(base).score)).toBe('LOW');
  });
  it('COD with an advance is lower than COD without one', () => {
    const paid = rtoRisk({ ...base, paymentMode: 'COD', codAdvance: 49 });
    const unpaid = rtoRisk({ ...base, paymentMode: 'COD' });
    expect(paid.score).toBeLessThan(unpaid.score);
    expect(unpaid.reasons).toContain('COD with no advance');
  });
  it('a customer who refused before, on high-value COD, is high risk', () => {
    const r = rtoRisk({ ...base, paymentMode: 'COD', orderValue: 3499, pastReturns: 1, addressLine: 'Near temple' });
    expect(riskLevel(r.score)).toBe('HIGH');
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
