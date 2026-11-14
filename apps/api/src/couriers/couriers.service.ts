import { Injectable, NotFoundException } from '@nestjs/common';
import type { CourierAdapter, RateQuote, RateRequest } from './courier.types.js';
import { DemoCourierAdapter } from './demo/demo-courier.adapter.js';
import { DEMO_COURIERS } from './demo/profiles.js';

/**
 * Registry of courier adapters. Today every courier is in DEMO mode;
 * when a live account is ready, its live adapter replaces the demo one here.
 */
@Injectable()
export class CouriersService {
  private readonly adapters = new Map<string, CourierAdapter>(
    DEMO_COURIERS.map((p) => [p.code, new DemoCourierAdapter(p)]),
  );

  list() {
    return [...this.adapters.values()].map((a) => ({
      code: a.code,
      name: a.name,
      mode: a.mode,
    }));
  }

  get(code: string): CourierAdapter {
    const adapter = this.adapters.get(code);
    if (!adapter) throw new NotFoundException(`Unknown courier ${code}`);
    return adapter;
  }

  /** Quotes from every courier: serviceable first, then cheapest, then fastest on a price tie. */
  compareRates(req: RateRequest): RateQuote[] {
    return [...this.adapters.values()]
      .map((a) => a.quote(req))
      .sort(
        (a, b) =>
          Number(b.serviceable) - Number(a.serviceable) || a.total - b.total || a.etaDays - b.etaDays,
      );
  }
}
