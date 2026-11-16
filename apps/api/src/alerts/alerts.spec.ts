import { fullLink } from './alerts.service.js';

describe('message links', () => {
  afterEach(() => {
    delete process.env.PUBLIC_URL;
    delete process.env.RENDER_EXTERNAL_URL;
  });
  it('uses the public address so links open from WhatsApp', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://d2c-logistics.onrender.com/';
    expect(fullLink('/v')).toBe('https://d2c-logistics.onrender.com/v');
    process.env.PUBLIC_URL = 'https://ship.d2cecommerce.in';
    expect(fullLink('/orders/1')).toBe('https://ship.d2cecommerce.in/orders/1');
  });
});
