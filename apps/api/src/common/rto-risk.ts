/**
 * Rule-based RTO risk (0-100), shown before a parcel ships so the team can
 * call the customer or ask for an advance first. Rules come from our own
 * returns: COD with no advance, high-value COD, far-off zones, weak addresses
 * and customers who refused before.
 */
export type RtoRiskInput = {
  paymentMode: 'PREPAID' | 'COD';
  orderValue: number;
  codAdvance: number;
  pincode: string;
  addressLine: string;
  pastReturns: number;
};

const FAR_PREFIXES = ['78', '79', '737', '18', '19', '744'];

export function rtoRisk(o: RtoRiskInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 5;
  if (o.paymentMode === 'COD') {
    score += 25;
    if (o.codAdvance <= 0) {
      score += 15;
      reasons.push('COD with no advance');
    }
    if (o.orderValue >= 2000) {
      score += 15;
      reasons.push('High-value COD');
    }
  }
  if (FAR_PREFIXES.some((p) => o.pincode.startsWith(p))) {
    score += 10;
    reasons.push('Far-off pin code');
  }
  const addr = o.addressLine.trim();
  if (addr.length < 20 || !/\d/.test(addr)) {
    score += 15;
    reasons.push('Short address or no house number');
  }
  if (o.pastReturns > 0) {
    score += 30;
    reasons.push(`Refused ${o.pastReturns} order${o.pastReturns > 1 ? 's' : ''} before`);
  }
  return { score: Math.min(100, score), reasons };
}

export const riskLevel = (score: number | null | undefined) =>
  score == null ? null : score >= 60 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';
