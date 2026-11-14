import { z } from 'zod';

/**
 * Every courier, demo or live, sits behind this one interface.
 * Switching a courier from DEMO to LIVE means swapping its adapter;
 * nothing else in the platform changes.
 */

export type CourierMode = 'DEMO' | 'LIVE';
export type Zone = 'LOCAL' | 'REGIONAL' | 'METRO' | 'NATIONAL' | 'SPECIAL';

export const RateRequestSchema = z.object({
  originPincode: z.string().regex(/^[1-9]\d{5}$/, 'Origin pin code must be 6 digits'),
  destinationPincode: z
    .string()
    .regex(/^[1-9]\d{5}$/, 'Destination pin code must be 6 digits'),
  weightGrams: z.number().int().positive().max(50_000),
  lengthCm: z.number().int().positive().max(200),
  breadthCm: z.number().int().positive().max(200),
  heightCm: z.number().int().positive().max(200),
  paymentMode: z.enum(['PREPAID', 'COD']),
  codAmount: z.number().nonnegative().default(0),
});
export type RateRequest = z.infer<typeof RateRequestSchema>;

export interface RateQuote {
  courierCode: string;
  courierName: string;
  mode: CourierMode;
  serviceable: boolean;
  zone: Zone;
  chargedWeightGrams: number;
  freight: number;
  codCharge: number;
  total: number;
  etaDays: number;
  /** Share of pickups done in the agreed slot, from the courier scorecard. */
  pickupOnTimePct: number;
  /** Set by the comparison: the cheapest reliable courier for this parcel. */
  recommended: boolean;
}

export interface BookingRequest extends RateRequest {
  idempotencyKey: string;
  orderNumber: string;
}

export const BookingRequestSchema = RateRequestSchema.extend({
  orderNumber: z.string().trim().min(1, 'Order number is required').max(40),
  // The same key always returns the same AWB, so a double-click never books twice.
  idempotencyKey: z.string().trim().min(8).max(100),
});

export interface BookingResult {
  awb: string;
  chargedAmount: number;
  chargedWeightGrams: number;
  expectedDelivery: Date;
  labelUrl: string | null;
}

export type ScanStatus =
  | 'BOOKED'
  | 'PICKUP_SCHEDULED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NDR'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED';

export interface TrackingScan {
  status: ScanStatus;
  location: string;
  remark: string;
  occurredAt: Date;
}

export interface CourierAdapter {
  readonly code: string;
  readonly name: string;
  readonly mode: CourierMode;
  quote(req: RateRequest): RateQuote;
  book(req: BookingRequest, now?: Date): Promise<BookingResult>;
  /** etaDays should be the quote's etaDays, so tracking matches the expected delivery date. */
  track(awb: string, bookedAt: Date, etaDays?: number, now?: Date): Promise<TrackingScan[]>;
}
