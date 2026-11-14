/**
 * Where a shipment sits on the journey board, and the one line that matters
 * on its card. Kept as pure functions so the rules are easy to test.
 */
export type Lane = 'PROBLEM' | 'TO_PACK' | 'READY' | 'MOVING' | 'OUT_TODAY' | 'DELIVERED' | 'RETURNED';
export type Tone = 'red' | 'orange' | 'amber' | 'blue' | 'green' | 'grey';

export type LaneInput = {
  status: string; // ShipmentStatus, or 'UNBOOKED' for an order with no shipment
  pickupStatus?: string | null;
  openFlag?: { title: string } | null;
  slotLabel?: string | null;
  lastScanPlace?: string | null;
  courier?: string | null;
};

export function laneFor(s: LaneInput): { lane: Lane; note: string; tone: Tone } {
  if (s.openFlag) return { lane: 'PROBLEM', note: s.openFlag.title, tone: 'red' };
  switch (s.status) {
    case 'UNBOOKED':
      return { lane: 'TO_PACK', note: 'Not booked yet', tone: 'grey' };
    case 'BOOKED':
    case 'PICKUP_SCHEDULED':
      if (s.pickupStatus === 'CONFIRMED')
        return { lane: 'READY', note: `Pickup ${s.slotLabel ?? ''} · executive confirmed`.trim(), tone: 'blue' };
      return { lane: 'TO_PACK', note: `Pack for pickup ${s.slotLabel ?? ''}`.trim(), tone: 'orange' };
    case 'PICKED_UP':
      return { lane: 'MOVING', note: `Picked up by ${s.courier ?? 'courier'}`, tone: 'blue' };
    case 'IN_TRANSIT':
      return { lane: 'MOVING', note: s.lastScanPlace ? `At ${s.lastScanPlace.toLowerCase()}` : 'On the way', tone: 'blue' };
    case 'OUT_FOR_DELIVERY':
      return { lane: 'OUT_TODAY', note: 'Out for delivery · customer notified', tone: 'green' };
    case 'DELIVERED':
      return { lane: 'DELIVERED', note: 'Delivered', tone: 'green' };
    case 'NDR':
      return { lane: 'PROBLEM', note: 'Delivery failed', tone: 'red' };
    case 'RTO_INITIATED':
      return { lane: 'PROBLEM', note: 'Returning to seller', tone: 'red' };
    case 'RTO_DELIVERED':
      return { lane: 'RETURNED', note: 'Returned to seller', tone: 'grey' };
    default:
      return { lane: 'TO_PACK', note: s.status, tone: 'grey' };
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
