import { announceShipmentsChanged, bulkBook, type BulkResult, fetchRates, getOrder, type OrderDetail, type RateQuote } from "./api";

export type ShipPreviewRow = { order: OrderDetail; quote: RateQuote | null; problem: string | null };

/**
 * Bulk actions always show a preview first: for each saved order, the courier
 * it will go with (cheapest reliable one), the price and delivery days.
 */
export async function previewShipments(orderIds: string[]): Promise<ShipPreviewRow[]> {
  const orders = await Promise.all(orderIds.map(getOrder));
  return Promise.all(
    orders.map(async (o) => {
      if (o.shipments.some((s) => s.status !== "CANCELLED")) return { order: o, quote: null, problem: "Already booked" };
      try {
        const quotes = await fetchRates({
          originPincode: o.pickupFrom.pincode,
          destinationPincode: o.customer.pincode,
          weightGrams: o.parcel.weightGrams,
          lengthCm: o.parcel.lengthCm,
          breadthCm: o.parcel.breadthCm,
          heightCm: o.parcel.heightCm,
          paymentMode: o.payment.mode,
          codAmount: o.payment.mode === "COD" ? o.payment.orderValue - o.payment.advance : 0,
        });
        const quote = quotes.find((q) => q.recommended) ?? null;
        return { order: o, quote, problem: quote ? null : "No courier delivers to this pin code" };
      } catch (e) {
        return { order: o, quote: null, problem: (e as Error).message };
      }
    }),
  );
}

/**
 * Books orders that are already saved (New tab) with the recommended courier
 * and the earliest pickup slot, using the details already on each order.
 */
export async function shipOrders(orderIds: string[], loaded?: OrderDetail[]): Promise<BulkResult> {
  const orders = loaded ?? (await Promise.all(orderIds.map(getOrder)));
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
