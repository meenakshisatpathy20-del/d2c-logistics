import type { Zone } from '../courier.types.js';

/** First three digits of metro-city pin codes. */
const METRO_PREFIXES = ['110', '400', '560', '600', '700', '500', '411', '380'];

/** Pin code prefixes with hard-to-reach delivery: North East (78, 79), Sikkim (737),
 * J&K/Ladakh (18, 19) and Andaman & Nicobar (744). */
const SPECIAL_PREFIXES = ['78', '79', '737', '18', '19', '744'];

const REGION_NAMES: Record<string, string> = {
  '11': 'Delhi',
  '12': 'Haryana',
  '13': 'Haryana',
  '14': 'Punjab',
  '20': 'Uttar Pradesh',
  '22': 'Uttar Pradesh',
  '30': 'Rajasthan',
  '38': 'Ahmedabad',
  '39': 'Gujarat',
  '40': 'Mumbai',
  '41': 'Pune',
  '45': 'Madhya Pradesh',
  '50': 'Hyderabad',
  '56': 'Bengaluru',
  '60': 'Chennai',
  '68': 'Kerala',
  '70': 'Kolkata',
  '75': 'Odisha',
  '78': 'Assam',
  '80': 'Bihar',
};

export function regionName(pincode: string): string {
  return REGION_NAMES[pincode.slice(0, 2)] ?? `Pin ${pincode.slice(0, 3)}xxx`;
}

function isSpecial(pincode: string): boolean {
  return SPECIAL_PREFIXES.some((p) => pincode.startsWith(p));
}

export function zoneFor(origin: string, destination: string): Zone {
  if (isSpecial(destination)) return 'SPECIAL';
  if (origin.slice(0, 3) === destination.slice(0, 3)) return 'LOCAL';
  if (
    METRO_PREFIXES.includes(origin.slice(0, 3)) &&
    METRO_PREFIXES.includes(destination.slice(0, 3))
  ) {
    return 'METRO';
  }
  if (origin[0] === destination[0]) return 'REGIONAL';
  return 'NATIONAL';
}

export const ZONE_MULTIPLIER: Record<Zone, number> = {
  LOCAL: 1,
  REGIONAL: 1.25,
  METRO: 1.5,
  NATIONAL: 1.8,
  SPECIAL: 2.2,
};

export const ZONE_BASE_ETA_DAYS: Record<Zone, number> = {
  LOCAL: 1,
  REGIONAL: 2,
  METRO: 3,
  NATIONAL: 5,
  SPECIAL: 7,
};
