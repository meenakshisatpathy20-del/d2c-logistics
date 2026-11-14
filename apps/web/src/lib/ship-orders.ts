import { announceShipmentsChanged, bulkBook, getOrder, type BulkResult } from "./api";

/**
 * Books orders that are already saved (New tab) with the recommended courier
 * and the earliest pickup slot, using the details already on each order.
 */
export async function shipOrders(orderIds: string[]): Promise<BulkResult> {
  const orders = await Promise.all(orderIds.map(getOrder));
  const rows = orders.map((o) => ({
    orderNumber: o.orderNumber,
    productBrand: o.brand,
    productName: o.items?.[0]?.name,
    customerName: o.customer.name,
    customerPhone: o.customer.phone,
    addressLine: o.customer.address,
    city: o.customer.city || undefined,
    state: o.customer.state || undefined,
    pincode: o.customer.pincode,
    warehouseCode: o.pickupFrom.code,
    paymentMode: o.payment.mode,
    orderValue: o.payment.orderValue,
    codAdvance: o.payment.advance || undefined,
    weightGrams: o.parcel.weightGrams,
    lengthCm: o.parcel.lengthCm,
    breadthCm: o.parcel.breadthCm,
    heightCm: o.parcel.heightCm,
  }));
  const result = await bulkBook(`ship-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, rows);
  announceShipmentsChanged();
  return result;
}
