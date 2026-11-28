import { isOurs, parseStatement, verdict } from './payment-guard.js';

const OURS = ['d2cecommerce@icici', 'D2C Ecommerce India'];
const prepaid = { paymentMode: 'PREPAID' as const, orderValue: 1499, codAdvance: 0 };
const pay = (over: Partial<{ reference: string; amount: number; refundedAmount: number; status: string; payee: string | null }> = {}) => ({
  reference: 'pay_1',
  amount: 1499,
  refundedAmount: 0,
  status: 'CAPTURED',
  payee: null,
  ...over,
});

describe('Payment guard', () => {
  it('ships a prepaid order only when the full amount is in our account', () => {
    expect(verdict(prepaid, [pay()], OURS).status).toBe('VERIFIED');
    expect(verdict(prepaid, [], OURS).status).toBe('PENDING');
    expect(verdict(prepaid, [pay({ amount: 999 })], OURS)).toMatchObject({ status: 'PENDING', received: 999 });
  });

  it('a payment to someone else\'s QR is not ours, however real the screenshot is', () => {
    const r = verdict(prepaid, [pay({ payee: 'starindia.mumbai@ybl', reference: '432918776120' })], OURS);
    expect(r.status).toBe('MISMATCH');
    expect(r.reason).toMatch(/starindia\.mumbai@ybl.*not our account/);
  });

  it('paid and refunded the same day is not paid: the order we shipped by mistake', () => {
    const r = verdict(prepaid, [pay({ refundedAmount: 1499, status: 'REFUNDED' })], OURS);
    expect(r.status).toBe('REFUNDED');
    expect(r.received).toBe(0);
  });

  it('a failed payment counts for nothing; a later good one verifies', () => {
    expect(verdict(prepaid, [pay({ status: 'FAILED' })], OURS).status).toBe('PENDING');
    expect(verdict(prepaid, [pay({ status: 'FAILED' }), pay({ reference: 'pay_2' })], OURS)).toMatchObject({ status: 'VERIFIED', reference: 'pay_2' });
  });

  it('a COD advance must be paid; COD with no advance needs nothing online', () => {
    const cod = { paymentMode: 'COD' as const, orderValue: 899, codAdvance: 49 };
    expect(verdict(cod, [], OURS).status).toBe('PENDING');
    expect(verdict(cod, [pay({ amount: 49 })], OURS).status).toBe('VERIFIED');
    expect(verdict({ ...cod, codAdvance: 0 }, [], OURS).status).toBe('NOT_NEEDED');
  });

  it('our account names match however they are spaced or cased', () => {
    expect(isOurs('D2CEcommerce@ICICI', OURS)).toBe(true);
    expect(isOurs('d2c ecommerce india', OURS)).toBe(true);
    expect(isOurs('someone@paytm', OURS)).toBe(false);
    expect(isOurs(null, OURS)).toBe(true); // our own gateway
  });

  it('reads gateway and bank statements with their own column names', () => {
    const { rows, errors } = parseStatement(
      'Order ID,UTR,Amount,Status,Paid To,Refunded,Date\n' +
        '18906,pay_abc,"₹1,499.00",captured,,0,2026-11-27 10:00\n' +
        '18911,pay_def,2224,refunded,,2224,2026-11-27 11:00\n' +
        '18910,432918776120,499,success,starindia.mumbai@ybl,,2026-11-27\n' +
        ',x,1,captured,,,\n',
    );
    expect(errors).toHaveLength(1);
    expect(rows.map((r) => [r.orderNumber, r.amount, r.status, r.payee])).toEqual([
      ['18906', 1499, 'CAPTURED', null],
      ['18911', 2224, 'REFUNDED', null],
      ['18910', 499, 'CAPTURED', 'starindia.mumbai@ybl'],
    ]);
  });

  it('says which columns are missing', () => {
    expect(parseStatement('name,phone\na,b').errors[0]).toMatch(/Columns not found/);
  });
});
