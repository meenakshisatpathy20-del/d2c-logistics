import { createHash } from 'node:crypto';
import type {
  BookingRequest,
  BookingResult,
  CourierAdapter,
  RateQuote,
  RateRequest,
  ScanStatus,
  TrackingScan,
} from '../courier.types.js';
import type { DemoCourierProfile } from './profiles.js';
import { ZONE_BASE_ETA_DAYS, ZONE_MULTIPLIER, zoneFor } from './zones.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stable number derived from text, so demo results repeat exactly. */
function hashNumber(text: string): bigint {
  return BigInt('0x' + createHash('sha256').update(text).digest('hex').slice(0, 15));
}

/** Charged weight = max(actual, volumetric L×B×H/5000), rounded up to 500 g. */
export function chargedWeightGrams(req: RateRequest): number {
  const volumetric = (req.lengthCm * req.breadthCm * req.heightCm) / 5; // grams
  const heavier = Math.max(req.weightGrams, volumetric);
  return Math.ceil(heavier / 500) * 500;
}

/**
 * A demo courier: realistic rates, AWB numbers and tracking, with no
 * outside calls. Results are deterministic so screens and tests repeat.
 */
export class DemoCourierAdapter implements CourierAdapter {
  readonly mode = 'DEMO' as const;

  constructor(private readonly profile: DemoCourierProfile) {}

  get code() {
    return this.profile.code;
  }

  get name() {
    return this.profile.name;
  }

  quote(req: RateRequest): RateQuote {
    const p = this.profile;
    const zone = zoneFor(req.originPincode, req.destinationPincode);
    const weight = chargedWeightGrams(req);
    const extraSlabs = weight / 500 - 1;
    const freight = round2((p.baseFreight + extraSlabs * p.additionalPer500g) * ZONE_MULTIPLIER[zone]);
    const codCharge =
      req.paymentMode === 'COD'
        ? round2(Math.max(p.codFixed, (req.codAmount * p.codPercent) / 100))
        : 0;
    const etaDays = Math.max(1, ZONE_BASE_ETA_DAYS[zone] + p.speedAdjustDays);

    return {
      courierCode: p.code,
      courierName: p.name,
      mode: this.mode,
      serviceable: p.zones.includes(zone),
      zone,
      chargedWeightGrams: weight,
      freight,
      codCharge,
      total: round2(freight + codCharge),
      etaDays,
      pickupOnTimePct: p.pickupOnTimePct,
      recommended: false,
    };
  }

  async book(req: BookingRequest, now: Date = new Date()): Promise<BookingResult> {
    const q = this.quote(req);
    if (!q.serviceable) {
      throw new Error(`${this.name} does not deliver to pin code ${req.destinationPincode}`);
    }
    const digits = hashNumber(`${this.code}:${req.idempotencyKey}`).toString().padStart(18, '0');
    const awb = (this.profile.awbPrefix + digits).slice(0, this.profile.awbLength);
    return {
      awb,
      chargedAmount: q.total,
      chargedWeightGrams: q.chargedWeightGrams,
      // One day for pickup, then the zone's delivery days.
      expectedDelivery: new Date(now.getTime() + (q.etaDays + 1) * DAY),
      labelUrl: null,
    };
  }

  /**
   * Simulated journey. The AWB decides the outcome, so a demo shipment
   * always tells the same story:
   *   0-74 delivered on time, 75-82 one failed attempt then delivered,
   *   83-89 stuck in transit (feeds the 48-hour red flag), 90-99 returned (RTO).
   */
  async track(
    awb: string,
    bookedAt: Date,
    etaDays = 3,
    now: Date = new Date(),
  ): Promise<TrackingScan[]> {
    const roll = Number(hashNumber(awb) % 100n);
    const t0 = bookedAt.getTime();
    // All plan times are offsets from t0 (booking time).
    const deliverAt = (etaDays + 1) * DAY - 4 * HOUR;
    // The parcel reaches the destination hub half a day before delivery
    // (never before it has left the origin hub).
    const destHubAt = Math.max(31 * HOUR, deliverAt - 12 * HOUR);
    const origin = 'Origin hub';
    const dest = 'Destination hub';

    const plan: Array<[number, ScanStatus, string, string]> = [
      [0, 'BOOKED', 'Platform', 'Shipment booked'],
      [1 * HOUR, 'PICKUP_SCHEDULED', origin, 'Pickup scheduled'],
      [20 * HOUR, 'PICKED_UP', origin, 'Picked up from seller'],
      [30 * HOUR, 'IN_TRANSIT', origin, 'Departed origin hub'],
    ];

    if (roll >= 83 && roll < 90) {
      // Stuck: no further scans after leaving the origin hub.
    } else {
      // Long journeys get a scan at each transit hub, about every 20 hours.
      for (let t = 30 * HOUR + 20 * HOUR; t < destHubAt - 4 * HOUR; t += 20 * HOUR) {
        plan.push([t, 'IN_TRANSIT', 'Transit hub', 'In transit']);
      }
      plan.push([destHubAt, 'IN_TRANSIT', dest, 'Arrived at destination hub']);
      plan.push([deliverAt - 6 * HOUR, 'OUT_FOR_DELIVERY', dest, 'Out for delivery']);
      if (roll < 75) {
        plan.push([deliverAt, 'DELIVERED', dest, 'Delivered to customer']);
      } else if (roll < 83) {
        plan.push([deliverAt, 'NDR', dest, 'Customer not available']);
        plan.push([deliverAt + 18 * HOUR, 'OUT_FOR_DELIVERY', dest, 'Re-attempt: out for delivery']);
        plan.push([deliverAt + 24 * HOUR, 'DELIVERED', dest, 'Delivered to customer']);
      } else {
        plan.push([deliverAt, 'NDR', dest, 'Customer refused delivery']);
        plan.push([deliverAt + 2 * DAY, 'RTO_INITIATED', dest, 'Return to origin started']);
        plan.push([deliverAt + 6 * DAY, 'RTO_DELIVERED', origin, 'Returned to seller']);
      }
    }

    return plan
      .filter(([offset]) => t0 + offset <= now.getTime())
      .map(([offset, status, location, remark]) => ({
        status,
        location,
        remark,
        occurredAt: new Date(t0 + offset),
      }));
  }
}

