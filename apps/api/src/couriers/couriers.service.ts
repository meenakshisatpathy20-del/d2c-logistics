import { Injectable, NotFoundException, type OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BookingRequest, BookingResult, CourierAdapter, RateQuote, RateRequest } from './courier.types.js';
import { DemoCourierAdapter } from './demo/demo-courier.adapter.js';
import { DEMO_COURIERS } from './demo/profiles.js';

/**
 * Registry of courier adapters. Today every courier is in DEMO mode;
 * when a live account is ready, its live adapter replaces the demo one here.
 */
/** Couriers below this pickup on-time % are never recommended while a reliable one is available. */
export const RELIABLE_PICKUP_PCT = 85;

/** A courier's booking connection failed; carries which courier, for failover and the issue. */
export class BookingError extends Error {
  constructor(
    readonly courierCode: string,
    readonly courierName: string,
    readonly reason: string,
  ) {
    super(`${courierName}: ${reason}`);
  }
}

@Injectable()
export class CouriersService implements OnModuleInit {
  private readonly adapters = new Map<string, CourierAdapter>(
    DEMO_COURIERS.map((p) => [p.code, new DemoCourierAdapter(p)]),
  );
  /** Couriers switched off by our team (account on hold, too many misses): never offered or used. */
  private readonly off = new Set<string>();
  /** Demo only: couriers set to fail every booking, to show failover and connection health. */
  private readonly failing = new Map<string, string>();
  /** Last booking result per courier, so a courier failing right now is not recommended. */
  private readonly lastResult = new Map<string, { ok: boolean; at: number }>();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async onModuleInit() {
    if (!this.prisma) return;
    const rows = await this.prisma.courier.findMany({ select: { code: true, active: true, simulateError: true, lastBookedAt: true, lastFailedAt: true } });
    for (const r of rows) {
      if (!r.active) this.off.add(r.code);
      if (r.lastFailedAt && (!r.lastBookedAt || r.lastFailedAt > r.lastBookedAt)) this.lastResult.set(r.code, { ok: false, at: r.lastFailedAt.getTime() });
      if (r.simulateError) this.failing.set(r.code, r.simulateError);
    }
  }

  /**
   * Books through the courier's connection and records its health: when it last
   * worked, when it last failed and why, and how many failures in 24 hours.
   */
  async bookWith(code: string, req: BookingRequest, now: Date = new Date()): Promise<BookingResult> {
    const adapter = this.get(code);
    try {
      const simulated = this.failing.get(code);
      if (simulated) throw new Error(simulated);
      const result = await adapter.book(req, now);
      this.lastResult.set(code, { ok: true, at: now.getTime() });
      if (this.prisma) await this.prisma.courier.update({ where: { code }, data: { lastBookedAt: now } });
      return result;
    } catch (e) {
      const message = (e as Error).message || 'Booking failed';
      this.lastResult.set(code, { ok: false, at: now.getTime() });
      if (this.prisma) {
        const c = await this.prisma.courier.findUnique({ where: { code } });
        const recent = c?.lastFailedAt && now.getTime() - c.lastFailedAt.getTime() < 24 * 3600_000;
        await this.prisma.courier.update({
          where: { code },
          data: { lastFailedAt: now, lastError: message.slice(0, 300), failures24h: recent ? { increment: 1 } : 1 },
        });
      }
      throw new BookingError(code, adapter.name, message);
    }
  }

  /** Demo switch: make a courier's bookings fail (e.g. "Courier authentication failed"), or clear it. */
  async simulateFailure(code: string, message: string | null) {
    this.get(code);
    if (this.prisma) await this.prisma.courier.update({ where: { code }, data: { simulateError: message } });
    if (message) this.failing.set(code, message);
    else this.failing.delete(code);
  }

  /** Connection health per courier, for Settings. */
  async health(now: Date = new Date()) {
    const rows = this.prisma ? await this.prisma.courier.findMany() : [];
    return this.list().map((c) => {
      const r = rows.find((x) => x.code === c.code);
      const failedRecently = !!r?.lastFailedAt && now.getTime() - r.lastFailedAt.getTime() < 24 * 3600_000;
      const okAfterFailure = !!r?.lastBookedAt && !!r?.lastFailedAt && r.lastBookedAt > r.lastFailedAt;
      return {
        ...c,
        lastBookedAt: r?.lastBookedAt ?? null,
        lastFailedAt: r?.lastFailedAt ?? null,
        lastError: r?.lastError ?? null,
        failures24h: failedRecently ? (r?.failures24h ?? 0) : 0,
        health: !c.active ? 'off' : failedRecently && !okAfterFailure ? 'failing' : 'ok',
        simulated: this.failing.get(c.code) ?? null,
      };
    });
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

  /** Earned pickup on-time %, from the scorecards (refreshed with the job loop). */
  private earned: Record<string, number> = {};

  setEarnedPickupPct(byCode: Record<string, number>) {
    this.earned = byCode;
  }

  /** The figure in the contract, used until we have enough history of our own. */
  contractPickupPct(code: string): number {
    return DEMO_COURIERS.find((p) => p.code === code)?.pickupOnTimePct ?? 90;
  }

  /** Pickup on-time %: earned from our own pickups when there is enough history, else the contract figure. */
  pickupOnTimePct(code: string): number {
    return this.earned[code] ?? this.contractPickupPct(code);
  }

  pickupPctSource(code: string): 'earned' | 'contract' {
    return code in this.earned ? 'earned' : 'contract';
  }

  /** The courier a missed or unconfirmed pickup moves to: the most reliable one. */
  backupFor(code: string): string {
    const ranked = [...DEMO_COURIERS]
      .filter((p) => p.code !== code && p.zones.length > 1)
      .sort((a, b) => this.pickupOnTimePct(b.code) - this.pickupOnTimePct(a.code));
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
        const q = { ...a.quote(req), pickupOnTimePct: this.pickupOnTimePct(a.code), pickupPctSource: this.pickupPctSource(a.code) };
        return this.isActive(a.code) ? q : { ...q, serviceable: false, switchedOff: true };
      })
      .sort(
        (a, b) =>
          Number(b.serviceable) - Number(a.serviceable) || a.total - b.total || a.etaDays - b.etaDays,
      );
    // A courier whose last booking failed in the past 30 minutes is shown, but not recommended.
    const failingNow = (code: string) => {
      const r = this.lastResult.get(code);
      return !!r && !r.ok && Date.now() - r.at < 30 * 60_000;
    };
    const serviceable = quotes.filter((q) => q.serviceable);
    const healthy = serviceable.filter((q) => !failingNow(q.courierCode));
    const pick =
      healthy.find((q) => q.pickupOnTimePct >= RELIABLE_PICKUP_PCT) ?? healthy[0] ?? serviceable[0];
    return quotes.map((q) => ({ ...q, recommended: q === pick, ...(failingNow(q.courierCode) ? { failingNow: true } : {}) }));
  }
}
