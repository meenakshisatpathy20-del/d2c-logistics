import { Injectable, NotFoundException } from '@nestjs/common';
import type { CourierAdapter, RateQuote, RateRequest } from './courier.types.js';
import { DemoCourierAdapter } from './demo/demo-courier.adapter.js';
import { DEMO_COURIERS } from './demo/profiles.js';

/**
 * Registry of courier adapters. Today every courier is in DEMO mode;
 * when a live account is ready, its live adapter replaces the demo one here.
 */
/** Couriers below this pickup on-time % are never recommended while a reliable one is available. */
export const RELIABLE_PICKUP_PCT = 85;

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

  /**
   * Quotes from every courier: serviceable first, then cheapest, then fastest on a price tie.
   * One quote is marked recommended: the cheapest courier whose pickups are reliable,
   * so a courier that keeps missing pickups is not suggested just because it is cheap.
   */
  compareRates(req: RateRequest): RateQuote[] {
    const quotes = [...this.adapters.values()]
      .map((a) => a.quote(req))
      .sort(
        (a, b) =>
          Number(b.serviceable) - Number(a.serviceable) || a.total - b.total || a.etaDays - b.etaDays,
      );
    const serviceable = quotes.filter((q) => q.serviceable);
    const pick =
      serviceable.find((q) => q.pickupOnTimePct >= RELIABLE_PICKUP_PCT) ?? serviceable[0];
    return quotes.map((q) => ({ ...q, recommended: q === pick }));
  }
}
