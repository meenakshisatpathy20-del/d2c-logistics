/**
 * Partial advance for COD: the same rule as D2C Mall's checkout and our API.
 * Rs 49 on orders below Rs 1,000, Rs 99 from Rs 1,000; the courier collects the rest.
 */
export const COD_ADVANCE_POLICY = { threshold: 1000, below: 49, above: 99 } as const;

export function codAdvanceFor(orderValue: number): number {
  const v = Math.max(0, Math.round(orderValue || 0));
  const advance = v >= COD_ADVANCE_POLICY.threshold ? COD_ADVANCE_POLICY.above : COD_ADVANCE_POLICY.below;
  return v > advance ? advance : 0;
}

export const ADVANCE_LABEL: Record<string, string> = {
  PAID: "Advance paid",
  ADJUSTED: "Advance adjusted",
  FORFEITED: "Advance kept (RTO)",
  REFUNDED: "Advance refunded",
};
