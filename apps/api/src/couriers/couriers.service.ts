import { Injectable, NotFoundException, type OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
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
export class CouriersService implements OnModuleInit {
  private readonly adapters = new Map<string, CourierAdapter>(
    DEMO_COURIERS.map((p) => [p.code, new DemoCourierAdapter(p)]),
  );
  /** Couriers switched off by our team (account on hold, too many misses): never offered or used. */
  private readonly off = new Set<string>();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async onModuleInit() {
    if (!this.prisma) return;
    const rows = await this.prisma.courier.findMany({ where: { active: false }, select: { code: true } });
    for (const r of rows) this.off.add(r.code);
  }

  isActive(code: string) {
    return !this.off.has(code);
  }

  /** Switch a courier off or on; takes effect for every new booking and every pickup move at once. */
  async setActive(code: string, active: boolean) {
    this.get(code);
    if (this.prisma) await this.prisma.courier.update({ where: { code }, data: { active } });
    if (active) this.off.delete(code);
    else this.off.add(code);
  }

  list() {
    return [...this.adapters.values()].map((a) => ({
      code: a.code,
      name: a.name,
      mode: a.mode,
      active: this.isActive(a.code),
      pickupOnTimePct: this.pickupOnTimePct(a.code),
    }));
  }

  /** Pickup on-time % from the courier scorecard (demo values for now). */
  pickupOnTimePct(code: string): number {
    return DEMO_COURIERS.find((p) => p.code === code)?.pickupOnTimePct ?? 90;
  }

  /** The courier a missed or unconfirmed pickup moves to: the most reliable one. */
  backupFor(code: string): string {
    const ranked = [...DEMO_COURIERS]
      .filter((p) => p.code !== code && p.zones.length > 1)
      .sort((a, b) => b.pickupOnTimePct - a.pickupOnTimePct);
    return ranked[0].code;
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
      .map((a) => {
        const q = a.quote(req);
        return this.isActive(a.code) ? q : { ...q, serviceable: false, switchedOff: true };
      })
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
