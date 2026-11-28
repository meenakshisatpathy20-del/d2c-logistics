import { chatRefs, parseChat, read } from './triage.js';

// Thu 27 Nov 2026, 3 pm IST
const now = new Date('2026-11-27T09:30:00Z');

describe('Triage: reading a courier WhatsApp chat', () => {
  it('splits an Android export into messages, joining wrapped lines', () => {
    const chat = [
      '26/11/26, 2:34 pm - Sakshi Shaw D2c: @~Isha ~ @~Haritha',
      ' 1. kindly update on status of pickup',
      'Shipment is ready(AWB-375683391562)',
      ' 2. RTO OF AWB - 80200394713',
      '26/11/26, 5:46 pm - ~ Isha ~: 80200394713 - is it not yet marked rto getting it update soon',
      '26/11/26, 5:47 pm - Sakshi Shaw D2c: Kindly get this done and update tomorrow',
      '26/11/26, 5:48 pm - Sakshi Shaw D2c: <Media omitted>',
    ].join('\n');
    const lines = parseChat(chat, now, 'Me');
    expect(lines).toHaveLength(3);
    expect(lines[0].sender).toBe('Sakshi Shaw D2c');
    expect(lines[0].body).toContain('375683391562');
    expect(lines[1].sender).toBe('Isha');
    expect(lines[1].sentAt.toISOString()).toBe('2026-11-26T12:16:00.000Z');
  });

  it('reads iOS exports and WhatsApp Web copies', () => {
    expect(parseChat('[27/11/2026, 7:04:10 PM] Sakshi Shaw D2c: Aligned for tomorrow.', now, 'Me')[0]).toMatchObject({ sender: 'Sakshi Shaw D2c', body: 'Aligned for tomorrow.' });
    expect(parseChat('[11:41 am, 27/11/2026] Sakshi Shaw D2c: 375723939877 RSM', now, 'Me')[0].sentAt.toISOString()).toBe('2026-11-27T06:11:00.000Z');
  });

  it('plain pasted text is one message from the person pasting it', () => {
    expect(parseChat('375731260024\n375731164629\nAligned for tomorrow.', now, 'Meenakshi')).toEqual([{ sender: 'Meenakshi', sentAt: now, body: '375731260024\n375731164629\nAligned for tomorrow.' }]);
  });

  it('finds AWBs, not phone numbers or pin codes', () => {
    expect(chatRefs('Isha +91 90710 42287: 80200394713, Noida 201307, AWB-375683391562, call 9071042287')).toEqual(['80200394713', '375683391562']);
  });

  it('knows an ask, a promise with a time, an excuse, a done and money', () => {
    expect(read('kindly update on status of pickup 375683391562', now)).toMatchObject({ kind: 'ASK', type: 'PICKUP_PENDING' });
    expect(read('what is the status of this RTO shipment?', now)).toMatchObject({ kind: 'ASK', type: 'RTO_STATUS' });
    const aligned = read('Aligned for tomorrow.', now);
    expect(aligned.kind).toBe('PROMISE');
    expect(aligned.promiseAt?.toISOString()).toBe('2026-11-28T06:30:00.000Z'); // tomorrow, midday IST
    expect(read('pickup attempted, warehouse closed', now)).toMatchObject({ kind: 'CLAIM', type: 'PICKUP_CLAIM' });
    expect(read('375731164629 picked up', now).kind).toBe('DONE');
    expect(read('is it not yet marked rto getting it update soon', now)).toMatchObject({ kind: 'PROMISE', promiseAt: null });
    expect(read('₹1,788 will be adjusted in next cycle', now)).toMatchObject({ kind: 'MONEY', type: 'CREDIT_NOTE_PENDING', amount: 1788 });
    expect(read('business with velocity is on hold until these AWBs are picked', now)).toMatchObject({ kind: 'BLOCKED', type: 'BOOKING_BLOCKED' });
  });
});
