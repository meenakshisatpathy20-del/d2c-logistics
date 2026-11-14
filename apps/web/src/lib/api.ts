/** Empty means "same address as the website", which forwards /api to the API. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

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

// ---------- Shared request helper ----------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** Tell open screens that shipments changed, so they refresh at once. */
export const SHIPMENTS_CHANGED = "d2c:shipments-changed";
export const announceShipmentsChanged = () => window.dispatchEvent(new Event(SHIPMENTS_CHANGED));

// ---------- Warehouses ----------

export type Warehouse = { code: string; name: string; city: string; pincode: string; cluster: string | null };
export const getWarehouses = () => request<Warehouse[]>("/api/warehouses");

// ---------- Booking ----------

export type BookOrderInput = {
  orderNumber: string;
  productBrand?: string;
  productName?: string;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  city?: string;
  state?: string;
  pincode: string;
  warehouseCode: string;
  rtoWarehouseCode?: string;
  paymentMode: "PREPAID" | "COD";
  orderValue: number;
  codAmount?: number;
  codAdvance?: number;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  courierCode?: string;
  slot?: { day: "today" | "tomorrow"; startHour: number };
};

export type BookedShipment = {
  id: string;
  orderNumber: string;
  courierCode: string;
  courierName: string;
  mode: "DEMO" | "LIVE";
  awb: string;
  chargedAmount: number;
  chargedWeightGrams: number;
  expectedDelivery: string;
  pickupSlot: { start: string; end: string; label: string } | null;
  labelUrl: string;
};

export const bookOrder = (input: BookOrderInput & { idempotencyKey: string }) =>
  request<BookedShipment>("/api/shipments", { method: "POST", body: JSON.stringify(input) });

export type BulkResult = {
  booked: number;
  failed: number;
  results: { orderNumber: string; ok: boolean; awb?: string; courier?: string; error?: string }[];
};

export const bulkBook = (batchKey: string, rows: Omit<BookOrderInput, "slot">[]) =>
  request<BulkResult>("/api/shipments/bulk", { method: "POST", body: JSON.stringify({ batchKey, rows }) });

// ---------- Shipments board ----------

export type Lane = "PROBLEM" | "TO_PACK" | "READY" | "MOVING" | "OUT_TODAY" | "DELIVERED" | "RETURNED";
export type Tone = "red" | "orange" | "amber" | "blue" | "green" | "grey";

export type BoardCard = {
  id: string;
  orderNumber: string;
  brand: string;
  product: string;
  customer: string;
  phone: string;
  city: string;
  pincode: string;
  payment: "COD" | "Prepaid";
  amount: number;
  collect: number;
  advance: number;
  advanceStatus: string | null;
  vendor: string;
  courier: string | null;
  awb: string | null;
  isDemo: boolean;
  status: string;
  lane: Lane;
  note: string;
  tone: Tone;
  owner: string;
  ownerName: string;
  labelUrl: string | null;
  createdAt: string;
};

export const getBoard = () => request<BoardCard[]>("/api/shipments");

// ---------- Today ----------

export type SlotState = "done" | "confirmed" | "waiting" | "missed" | "scheduled";

export type TodayData = {
  now: string;
  nowHour: number;
  summary: { pickupsDue: number; pickupsDone: number; needsYou: number };
  needsYou: {
    id: string;
    severity: "critical" | "warning";
    title: string;
    detail: string;
    owner: string;
    due: string;
    overdue: boolean;
    action: string;
  }[];
  pickups: {
    vendor: string;
    area: string;
    slots: {
      id: string;
      start: number;
      end: number;
      slot: string;
      courier: string;
      parcels: number;
      status: SlotState;
      label: string;
      manifestUrl: string;
    }[];
  }[];
  pulse: {
    moving: number;
    outToday: number;
    deliveredToday: number;
    codToCollect: number;
    codOrders: number;
    advancesHeld: number;
    advanceOrders: number;
  };
  brands: { name: string; orders: number; shipped: number }[];
};

export const getToday = () => request<TodayData>("/api/today");
