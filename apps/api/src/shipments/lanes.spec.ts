import { initials, laneFor } from './lanes.js';

describe('laneFor', () => {
  it('pins anything with an open red flag to "Needs a fix", with the flag as its note', () => {
    expect(laneFor({ status: 'IN_TRANSIT', openFlag: { title: 'No scan for 52 hours' } })).toEqual({
      lane: 'PROBLEM',
      note: 'No scan for 52 hours',
      tone: 'red',
    });
  });
  it('booked but not confirmed is "To pack"; confirmed is "Ready for pickup"', () => {
    expect(laneFor({ status: 'BOOKED', slotLabel: '2 pm–4 pm' }).lane).toBe('TO_PACK');
    expect(laneFor({ status: 'PICKUP_SCHEDULED', pickupStatus: 'CONFIRMED', slotLabel: '2 pm–4 pm' })).toMatchObject({
      lane: 'READY',
      note: 'Pickup 2 pm–4 pm · executive confirmed',
    });
  });
  it('keeps place names as written', () => {
    expect(laneFor({ status: 'IN_TRANSIT', lastScanPlace: 'Noida hub' }).note).toBe('At Noida hub');
  });
  it('failed deliveries and returns need a fix; finished returns are done', () => {
    expect(laneFor({ status: 'NDR' }).lane).toBe('PROBLEM');
    expect(laneFor({ status: 'RTO_INITIATED' }).lane).toBe('PROBLEM');
    expect(laneFor({ status: 'RTO_DELIVERED' }).lane).toBe('RETURNED');
    expect(laneFor({ status: 'DELIVERED' }).lane).toBe('DELIVERED');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Ops Executive')).toBe('OE');
    expect(initials('Support')).toBe('S');
  });
});
