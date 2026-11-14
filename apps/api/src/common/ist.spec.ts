import { istAt, istHour, nextBookableSlot, slotAfter, slotLabel } from './ist.js';

describe('India time slots', () => {
  const now = new Date('2026-11-14T08:00:00Z'); // 1:30 pm IST

  it('reads the hour in IST', () => expect(istHour(now)).toBe(13.5));
  it('builds a slot start in IST', () => expect(istAt(now, 16).toISOString()).toBe('2026-11-14T10:30:00.000Z'));
  it('the next bookable slot is at least 2 hours away', () => {
    // 2 pm is only 30 minutes away, so 4 pm is the first slot a courier can confirm.
    expect(slotLabel(nextBookableSlot(now).slotStart)).toBe('4 pm–6 pm');
  });
  it('after the last slot of the day, the next slot is tomorrow morning', () => {
    const last = istAt(now, 16);
    const next = slotAfter(last).slotStart;
    expect(slotLabel(next)).toBe('10 am–12 pm');
    expect(next.getTime() - last.getTime()).toBe(18 * 60 * 60 * 1000);
  });
});
