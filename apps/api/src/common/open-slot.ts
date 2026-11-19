import type { PrismaService } from '../prisma/prisma.service.js';
import { slotAfter, slotFits } from './ist.js';

const OPEN = ['SCHEDULED', 'CONFIRMED'];

/**
 * The first slot from `slot` onwards where this courier can still collect from
 * this warehouse. A slot whose pickup already happened, was missed, moved or
 * postponed is closed to new parcels; a pickup called off because all its
 * parcels were cancelled is opened again. A slot outside the warehouse's
 * declared working hours (Saturday included) is never used. Returns null if a fixed slot was
 * required and it is closed, or if no slot is open at all.
 */
export async function openSlot(
  prisma: PrismaService,
  warehouseId: string,
  courierCode: string,
  slot: { slotStart: Date; slotEnd: Date },
  fixed = false,
): Promise<{ slotStart: Date; slotEnd: Date } | null> {
  const hours = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { opensAt: true, closesAt: true, saturdayClosesAt: true },
  });
  let current = slot;
  // Up to about 3 months of working-day slots; never hands back a closed one.
  for (let i = 0; i < 300; i++) {
    if (!slotFits(current.slotStart, hours)) {
      if (fixed) return null;
      current = slotAfter(current.slotStart);
      continue;
    }
    const taken = await prisma.pickup.findUnique({
      where: { warehouseId_courierCode_slotStart: { warehouseId, courierCode, slotStart: current.slotStart } },
    });
    if (!taken || OPEN.includes(taken.status)) return current;
    if (taken.status === 'CANCELLED') {
      await prisma.pickup.update({ where: { id: taken.id }, data: { status: 'SCHEDULED' } });
      return current;
    }
    if (fixed) return null;
    current = slotAfter(current.slotStart);
  }
  return null;
}
