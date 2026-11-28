/**
 * The rules of an issue room, in one place: which group a type belongs to,
 * whose turn it is when it opens, which courier contact it goes to, and which
 * real outcomes can close it.
 */
export type Party = 'OURS' | 'COURIER' | 'VENDOR' | 'CUSTOMER';
export const PARTIES: Party[] = ['OURS', 'COURIER', 'VENDOR', 'CUSTOMER'];
export const FAULT_PARTIES = ['COURIER', 'VENDOR', 'CUSTOMER', 'OURS', 'NONE'] as const;

export type Group = 'PICKUPS' | 'TRANSIT' | 'DELIVERY' | 'RETURNS' | 'WEIGHT' | 'MONEY' | 'BOOKING' | 'OTHER';
export type Scope = 'pickup' | 'order' | 'courier';

/**
 * Problems a person can raise by hand (red flags raise the rest by themselves).
 * Taken from our own Velocity chats and the problems Indian D2C brands most
 * often escalate to couriers and aggregators.
 */
export const RAISED: Record<string, { label: string; group: Group; scope: Scope }> = {
  PICKUP_CLAIM: { label: 'Courier says pickup was attempted (closed, not ready)', group: 'PICKUPS', scope: 'pickup' },
  PICKUP_PENDING: { label: 'Pickup pending', group: 'PICKUPS', scope: 'pickup' },
  MANIFEST_MISMATCH: { label: 'Fewer parcels picked up than on the manifest', group: 'PICKUPS', scope: 'pickup' },
  DELAYED: { label: 'Delivery date passed', group: 'TRANSIT', scope: 'order' },
  MISROUTED: { label: 'Parcel sent to the wrong city or hub', group: 'TRANSIT', scope: 'order' },
  LOST: { label: 'Parcel lost', group: 'TRANSIT', scope: 'order' },
  FAKE_ATTEMPT: { label: 'Customer says nobody came (fake attempt)', group: 'DELIVERY', scope: 'order' },
  NOT_RECEIVED: { label: 'Marked delivered, customer did not receive it', group: 'DELIVERY', scope: 'order' },
  DAMAGED: { label: 'Damaged, tampered or items missing', group: 'DELIVERY', scope: 'order' },
  EXECUTIVE_CONDUCT: { label: 'Delivery person asked for extra money or misbehaved', group: 'DELIVERY', scope: 'order' },
  ADDRESS_CHANGE: { label: 'Customer wants a new date or address', group: 'DELIVERY', scope: 'order' },
  RTO_NO_ATTEMPT: { label: 'Return started without a real delivery attempt', group: 'RETURNS', scope: 'order' },
  RTO_STATUS: { label: 'Return (RTO) status or address not updated', group: 'RETURNS', scope: 'order' },
  RTO_NOT_RECEIVED: { label: 'Return not received at our warehouse', group: 'RETURNS', scope: 'order' },
  REVERSE_PICKUP_PENDING: { label: 'Customer return not picked up', group: 'RETURNS', scope: 'order' },
  WEIGHT_CHARGE: { label: 'Charged for a higher weight', group: 'WEIGHT', scope: 'order' },
  PAYMENT_NOT_CREDITED: { label: 'Payment not credited', group: 'MONEY', scope: 'courier' },
  CREDIT_NOTE_PENDING: { label: 'Credit note or adjustment pending', group: 'MONEY', scope: 'courier' },
  COD_REMITTANCE_LATE: { label: 'COD remittance late', group: 'MONEY', scope: 'courier' },
  COD_REMITTANCE_SHORT: { label: 'COD remittance short or deductions unexplained', group: 'MONEY', scope: 'courier' },
  OVERCHARGED: { label: 'Charged more than the quoted rate', group: 'MONEY', scope: 'courier' },
  CLAIM_NOT_PAID: { label: 'Lost or damage claim not paid', group: 'MONEY', scope: 'courier' },
  BOOKING_BLOCKED: { label: 'Bookings blocked on our account', group: 'BOOKING', scope: 'courier' },
  BOOKING_FAILED: { label: 'Booking or label failing (e.g. authentication failed)', group: 'BOOKING', scope: 'courier' },
  OTHER: { label: 'Other', group: 'OTHER', scope: 'courier' },
};
export const RAISED_TYPES = Object.fromEntries(Object.entries(RAISED).map(([k, v]) => [k, v.label])) as Record<string, string>;
export type RaisedType = keyof typeof RAISED;

/**
 * Raised by the deadline check, so no shipment can go quiet at any step.
 * Each one closes by itself when the parcel moves on.
 */
export const WATCHDOG: Record<string, { label: string; group: Group; turn: Party }> = {
  NOT_BOOKED: { label: 'Order not booked within 24 hours', group: 'BOOKING', turn: 'OURS' },
  NOT_PACKED: { label: 'Parcels not packed 1 hour before pickup', group: 'PICKUPS', turn: 'VENDOR' },
  PARCELS_WAITING: { label: 'Parcels waiting at a vendor more than 1 working day', group: 'PICKUPS', turn: 'COURIER' },
  NOT_AT_HUB: { label: 'Picked up but not at the hub within 24 hours', group: 'TRANSIT', turn: 'COURIER' },
  OFD_NO_RESULT: { label: 'Out for delivery, no result by 9 pm', group: 'DELIVERY', turn: 'COURIER' },
  DELAYED: { label: 'Delivery date passed', group: 'TRANSIT', turn: 'COURIER' },
  RETURN_STUCK: { label: 'Return not back in 10 days', group: 'RETURNS', turn: 'COURIER' },
  ATTEMPTS_3: { label: '3 or more failed delivery attempts', group: 'DELIVERY', turn: 'OURS' },
};

/**
 * Raised by the payment guard: a prepaid order (or a COD advance) ships only
 * when the money is seen in our own account and has not been refunded.
 */
export const PAYMENT: Record<string, { label: string; turn: Party }> = {
  PAYMENT_PENDING: { label: 'Prepaid order: money not received in our account', turn: 'CUSTOMER' },
  PAYMENT_WRONG_ACCOUNT: { label: 'Paid to an account that is not ours (wrong QR)', turn: 'CUSTOMER' },
  PAYMENT_REFUNDED: { label: 'Payment refunded after the order was booked', turn: 'OURS' },
};

const GROUP: Record<string, Group> = {
  PICKUP_UNCONFIRMED: 'PICKUPS',
  PICKUP_MISSED: 'PICKUPS',
  NO_SCAN_48H: 'TRANSIT',
  NDR: 'DELIVERY',
  RTO: 'RETURNS',
  WEIGHT_DISPUTE: 'WEIGHT',
  ...Object.fromEntries(Object.entries(RAISED).map(([k, v]) => [k, v.group])),
  ...Object.fromEntries(Object.entries(WATCHDOG).map(([k, v]) => [k, v.group])),
  ...Object.fromEntries(Object.keys(PAYMENT).map((k) => [k, 'MONEY' as Group])),
};
export const groupOf = (type: string): Group => GROUP[type] ?? 'OTHER';
export const GROUP_TYPES = (g: Group) => Object.entries(GROUP).filter(([, v]) => v === g).map(([k]) => k);

/** Whose turn it is when the issue opens. */
export function firstTurn(type: string): Party {
  // Our team acts first where we hold the proof or must call the customer.
  if (['NDR', 'RTO', 'WEIGHT_DISPUTE', 'OTHER'].includes(type)) return 'OURS';
  return WATCHDOG[type]?.turn ?? PAYMENT[type]?.turn ?? 'COURIER';
}

/** Which courier person an issue goes to first. */
export const contactRoleFor = (type: string) => (groupOf(type) === 'PICKUPS' ? 'PICKUP_LEAD' : 'ACCOUNT_MANAGER');

/** Closing needs one of these real outcomes, not just "done". */
export const OUTCOMES: Record<Group, string[]> = {
  PICKUPS: ['Picked up', 'Packed and ready', 'Moved to another courier', 'Postponed by the vendor', 'Manifest corrected', 'Order cancelled'],
  TRANSIT: ['Moving again', 'Delivered', 'Declared lost, claim raised', 'Claim paid'],
  DELIVERY: ['Delivered', 'Delivered after address fix', 'Attempt recorded', 'Returned to seller', 'Customer received it', 'Executive warned or changed', 'Claim raised with the courier', 'Claim paid', 'Customer cancelled'],
  RETURNS: ['Customer accepted after a call', 'Return received at warehouse', 'Reverse pickup done', 'Return charge reversed', 'Return stopped', 'Claim paid'],
  WEIGHT: ['Dispute won', 'Dispute lost', 'Charge accepted', 'Charge reversed'],
  MONEY: ['Credited', 'Credit note received', 'Adjusted in the invoice', 'Remitted in full', 'Charge reversed', 'Claim paid', 'Written off', 'Payment verified', 'Shipment stopped', 'Returned to seller', 'Converted to COD', 'Order cancelled'],
  BOOKING: ['Booked', 'Order cancelled', 'Bookings unblocked', 'Booking fixed', 'Moved to another courier'],
  OTHER: ['Solved', 'Not a problem'],
};

/** Outcomes that are only true with a reference: UTR, credit note, claim or invoice number. */
export const NEEDS_REFERENCE = ['Payment verified', 'Credited', 'Credit note received', 'Adjusted in the invoice', 'Remitted in full', 'Charge reversed', 'Claim paid', 'Return charge reversed'];

/** Reminders: every 2 hours, 9 am to 8 pm IST on working days. */
export const REMIND_EVERY_HOURS = 2;
export const REMIND_FROM_HOUR = 9;
export const REMIND_UNTIL_HOUR = 20;
/** After this many ignored reminders the issue goes to the contact's manager. */
export const IGNORED_BEFORE_MANAGER = 2;
/**
 * Silence has a consequence: a pickup issue still ignored after the manager was
 * told (one more reminder) is not waited on any longer; the parcels move to
 * the most reliable other courier by themselves.
 */
export const IGNORED_BEFORE_AUTO_SWITCH = 3;

export const PARTY_LABEL: Record<string, string> = { OURS: 'Us', COURIER: 'Courier', VENDOR: 'Vendor', CUSTOMER: 'Customer', SYSTEM: 'System' };
export const ROLE_LABEL: Record<string, string> = {
  ACCOUNT_MANAGER: 'account manager',
  PICKUP_LEAD: 'pickup lead',
  HUB: 'hub',
  REGIONAL_MANAGER: 'regional manager',
};
