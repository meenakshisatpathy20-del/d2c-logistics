import { z } from 'zod';
import { SLOT_STARTS } from '../common/ist.js';

const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Pin code must be 6 digits');

/** One order to book. Mirrors our Velocity bulk sheet, so CSV rows map 1:1. */
export const BookOrderSchema = z.object({
  orderNumber: z.string().trim().min(1, 'Order ID is required').max(40),
  productBrand: z.string().trim().max(60).optional(),
  productName: z.string().trim().max(120).optional(),
  customerName: z.string().trim().min(2, 'Customer name is required').max(80),
  customerPhone: z.string().regex(/^[6-9]\d{9}$/, 'Mobile must be 10 digits starting 6–9'),
  addressLine: z.string().trim().min(8, 'Full delivery address is required').max(200),
  city: z.string().trim().max(60).optional(),
  state: z.string().trim().max(60).optional(),
  pincode,
  warehouseCode: z.string().trim().min(1, 'Pickup warehouse is required'),
  rtoWarehouseCode: z.string().trim().optional(),
  paymentMode: z.enum(['PREPAID', 'COD']),
  orderValue: z.number().positive('Order value must be above 0'),
  codAmount: z.number().nonnegative().default(0),
  weightGrams: z.number().int().positive().max(50_000),
  lengthCm: z.number().int().positive().max(200),
  breadthCm: z.number().int().positive().max(200),
  heightCm: z.number().int().positive().max(200),
  /** Leave empty to use the recommended courier (cheapest with reliable pickups). */
  courierCode: z.string().trim().toUpperCase().optional(),
  /** Leave empty for the earliest slot the courier can still confirm. */
  slot: z
    .object({
      day: z.enum(['today', 'tomorrow']),
      startHour: z.number().int().refine((h) => (SLOT_STARTS as readonly number[]).includes(h), 'Unknown pickup slot'),
    })
    .optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});
export type BookOrder = z.infer<typeof BookOrderSchema>;

export const BulkBookSchema = z.object({
  batchKey: z.string().trim().min(8).max(100),
  rows: z.array(BookOrderSchema.omit({ idempotencyKey: true })).min(1).max(500),
});
export type BulkBook = z.infer<typeof BulkBookSchema>;
