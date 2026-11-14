import { codAdvanceFor, settleAdvance } from './cod-advance.js';

describe('advance COD (same rule as D2C Mall)', () => {
  it('Rs 49 below Rs 1,000 and Rs 99 from Rs 1,000', () => {
    expect(codAdvanceFor(999)).toBe(49);
    expect(codAdvanceFor(1000)).toBe(99);
    expect(codAdvanceFor(1299)).toBe(99);
  });
  it('no advance when the order is too small to split', () => {
    expect(codAdvanceFor(49)).toBe(0);
    expect(codAdvanceFor(30)).toBe(0);
  });
  it('adjusted on delivery, kept on return to origin, refunded on cancel', () => {
    expect(settleAdvance('DELIVERED')).toBe('ADJUSTED');
    expect(settleAdvance('RTO_DELIVERED')).toBe('FORFEITED');
    expect(settleAdvance('CANCELLED')).toBe('REFUNDED');
    expect(settleAdvance('IN_TRANSIT')).toBeNull();
  });
});
