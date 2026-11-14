/**
 * Partial advance for Cash on Delivery, the same rule as D2C Mall's checkout
 * (d2c-mall: src/data/codAdvance.js), so both compute the same amounts.
 *
 *   Order value  < Rs 1,000  ->  Rs 49 advance paid online
 *   Order value >= Rs 1,000  ->  Rs 99 advance paid online
 *   The courier collects only the balance at the door.
 *
 * Refunded:  cancelled before it ships, or returned after delivery.
 * Kept:      refused at the door / returned to origin (covers two-way shipping).
 * Adjusted:  delivered, the advance counts towards the order total.
 */
export const COD_ADVANCE_POLICY = { threshold: 1000, below: 49, above: 99 } as const;

export function codAdvanceFor(orderValue: number): number {
  const v = Math.max(0, Math.round(orderValue || 0));
  const advance = v >= COD_ADVANCE_POLICY.threshold ? COD_ADVANCE_POLICY.above : COD_ADVANCE_POLICY.below;
  return v > advance ? advance : 0;
}

export type AdvanceStatus = 'PAID' | 'ADJUSTED' | 'FORFEITED' | 'REFUNDED';

/** What happens to a paid advance when a shipment reaches an end state. */
export function settleAdvance(shipmentStatus: string): AdvanceStatus | null {
  if (shipmentStatus === 'DELIVERED') return 'ADJUSTED';
  if (shipmentStatus === 'RTO_DELIVERED') return 'FORFEITED';
  if (shipmentStatus === 'CANCELLED') return 'REFUNDED';
  return null;
}
