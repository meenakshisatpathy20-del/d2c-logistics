import type { Zone } from '../courier.types.js';

/**
 * Demo rate cards. These are illustrative numbers for demo mode only,
 * not any courier's real contracted rates.
 */
export interface DemoCourierProfile {
  code: string;
  name: string;
  /** Freight for the first 500 g, before the zone multiplier (INR). */
  baseFreight: number;
  /** Freight for each extra 500 g, before the zone multiplier (INR). */
  additionalPer500g: number;
  codFixed: number;
  codPercent: number;
  /** Added to the zone's base delivery days (negative = faster). */
  speedAdjustDays: number;
  awbPrefix: string;
  awbLength: number;
  /** Zones this courier serves. Hyperlocal partners serve LOCAL only. */
  zones: Zone[];
  /** Demo pickup on-time %, standing in for the scorecard built from our own shipments. */
  pickupOnTimePct: number;
}

const ALL_ZONES: Zone[] = ['LOCAL', 'REGIONAL', 'METRO', 'NATIONAL', 'SPECIAL'];

export const DEMO_COURIERS: DemoCourierProfile[] = [
  {
    code: 'DELHIVERY',
    name: 'Delhivery',
    baseFreight: 40,
    additionalPer500g: 35,
    codFixed: 30,
    codPercent: 1.75,
    speedAdjustDays: 0,
    awbPrefix: '1490',
    awbLength: 14,
    zones: ALL_ZONES,
    pickupOnTimePct: 96,
  },
  {
    code: 'EKART',
    name: 'Ekart',
    baseFreight: 36,
    additionalPer500g: 32,
    codFixed: 28,
    codPercent: 1.5,
    speedAdjustDays: 1,
    awbPrefix: 'FMPC',
    awbLength: 14,
    zones: ALL_ZONES,
    pickupOnTimePct: 88,
  },
  {
    code: 'SHADOWFAX',
    name: 'Shadowfax',
    baseFreight: 38,
    additionalPer500g: 33,
    codFixed: 30,
    codPercent: 1.6,
    speedAdjustDays: 0,
    awbPrefix: 'SF',
    awbLength: 13,
    zones: ['LOCAL', 'REGIONAL', 'METRO', 'NATIONAL'],
    pickupOnTimePct: 91,
  },
  {
    code: 'BLUEDART',
    name: 'Blue Dart',
    baseFreight: 60,
    additionalPer500g: 50,
    codFixed: 40,
    codPercent: 2,
    speedAdjustDays: -1,
    awbPrefix: '7728',
    awbLength: 11,
    zones: ALL_ZONES,
    pickupOnTimePct: 94,
  },
  {
    code: 'XPRESSBEES',
    name: 'Xpressbees',
    baseFreight: 37,
    additionalPer500g: 31,
    codFixed: 28,
    codPercent: 1.5,
    speedAdjustDays: 0,
    awbPrefix: '1416',
    awbLength: 14,
    zones: ALL_ZONES,
    pickupOnTimePct: 72,
  },
  {
    code: 'AMAZON',
    name: 'Amazon Shipping',
    baseFreight: 42,
    additionalPer500g: 36,
    codFixed: 30,
    codPercent: 1.5,
    speedAdjustDays: 0,
    awbPrefix: '3740',
    awbLength: 12,
    zones: ['LOCAL', 'REGIONAL', 'METRO', 'NATIONAL'],
    pickupOnTimePct: 92,
  },
  {
    code: 'BLITZ',
    name: 'Blitz',
    baseFreight: 45,
    additionalPer500g: 40,
    codFixed: 30,
    codPercent: 1.5,
    speedAdjustDays: 0,
    awbPrefix: 'BLZ',
    awbLength: 12,
    zones: ['LOCAL'],
    pickupOnTimePct: 90,
  },
  {
    code: 'PIKNDEL',
    name: 'Pikndel',
    baseFreight: 44,
    additionalPer500g: 38,
    codFixed: 30,
    codPercent: 1.5,
    speedAdjustDays: 0,
    awbPrefix: 'PKD',
    awbLength: 12,
    zones: ['LOCAL'],
    pickupOnTimePct: 89,
  },
];
