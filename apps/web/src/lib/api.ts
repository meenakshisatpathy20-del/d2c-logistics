export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type RateQuote = {
  courierCode: string;
  courierName: string;
  mode: "DEMO" | "LIVE";
  serviceable: boolean;
  zone: string;
  chargedWeightGrams: number;
  freight: number;
  codCharge: number;
  total: number;
  etaDays: number;
  pickupOnTimePct: number;
  recommended: boolean;
};

export type RateRequest = {
  originPincode: string;
  destinationPincode: string;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  paymentMode: "PREPAID" | "COD";
  codAmount: number;
};

export async function fetchRates(req: RateRequest, signal?: AbortSignal): Promise<RateQuote[]> {
  const res = await fetch(`${API_URL}/api/couriers/rates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw new Error(`Rates request failed (${res.status})`);
  return res.json();
}

export type BookingResult = {
  courierCode: string;
  courierName: string;
  mode: "DEMO" | "LIVE";
  awb: string;
  chargedAmount: number;
  chargedWeightGrams: number;
  expectedDelivery: string;
  labelUrl: string | null;
};

export async function bookShipment(
  courierCode: string,
  req: RateRequest & { orderNumber: string; idempotencyKey: string },
): Promise<BookingResult> {
  const res = await fetch(`${API_URL}/api/couriers/${courierCode.toLowerCase()}/book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(message ?? `Booking failed (${res.status})`);
  }
  return res.json();
}
