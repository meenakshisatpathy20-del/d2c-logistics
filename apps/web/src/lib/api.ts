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
