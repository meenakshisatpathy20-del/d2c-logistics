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
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    // Session ended: back to sign-in, then return here.
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error("Please sign in");
  }
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
  slot?: { day: "today" | "next"; startHour: number };
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
    orderId: string | null;
    type: string;
    acted: boolean;
    note: string | null;
    ownerId: string | null;
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

// ---------- Sign-in ----------

export type LoginStep = { challengeId: string; sentTo: string; expiresInMinutes: number; demoCode?: string };
export const login = (email: string, password: string) =>
  request<LoginStep>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const verifyCode = (challengeId: string, code: string) =>
  request<{ name: string; role: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ challengeId, code }) });
export const logout = () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
export type Me = { id: string; name: string; email: string | null; role: string };
export const getMe = () => request<Me>("/api/auth/me");

// ---------- Orders ----------

export const ORDER_TABS = [
  { key: "NEW", label: "New" },
  { key: "READY", label: "Ready to ship" },
  { key: "IN_TRANSIT", label: "In transit" },
  { key: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "RTO", label: "RTO" },
  { key: "ATTENTION", label: "Needs attention" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "ALL", label: "All" },
] as const;
export type OrderTab = (typeof ORDER_TABS)[number]["key"];

export type OrderRow = {
  id: string;
  shipmentId: string | null;
  orderNumber: string;
  createdAt: string;
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
  vendor: string;
  courier: string | null;
  awb: string | null;
  isDemo: boolean;
  status: string;
  lane: string;
  note: string;
  tone: Tone;
  flag: { id: string; title: string; action: string | null; owner: string | null } | null;
  rtoRisk: "LOW" | "MEDIUM" | "HIGH" | null;
  canCancel: boolean;
  labelUrl: string | null;
};

export type OrdersPage = {
  tab: OrderTab;
  page: number;
  size: number;
  total: number;
  pages: number;
  counts: Record<OrderTab, number>;
  rows: OrderRow[];
};

export type OrdersQuery = { tab?: OrderTab; q?: string; brand?: string; courier?: string; payment?: string; page?: number; size?: number };
export const getOrders = (query: OrdersQuery) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  return request<OrdersPage>(`/api/orders?${params}`);
};
export const getOrderFilters = () =>
  request<{ brands: string[]; couriers: { code: string; name: string }[] }>("/api/orders/filters");

export type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  brand: string;
  items: { name: string; qty: number; price: number }[];
  customer: { name: string; phone: string; address: string; city: string; state: string; pincode: string };
  payment: { mode: "COD" | "PREPAID"; orderValue: number; collect: number; advance: number; advanceStatus: string | null };
  parcel: { weightGrams: number; lengthCm: number; breadthCm: number; heightCm: number };
  pickupFrom: { code: string; name: string; city: string; pincode: string };
  returnTo: { name: string; city: string } | null;
  rtoRisk: { score: number; level: "LOW" | "MEDIUM" | "HIGH"; reasons: string[] };
  canEdit: boolean;
  canEditPincode: boolean;
  canCancel: boolean;
  shipments: {
    id: string;
    courier: string;
    courierCode: string;
    awb: string;
    isDemo: boolean;
    status: string;
    charged: number;
    chargedWeightG: number;
    courierWeightG: number | null;
    expectedDelivery: string | null;
    pickup: { id: string; slot: string; date: string; status: string; executive: string | null; manifestUrl: string } | null;
    labelUrl: string;
    events: { status: string; location: string | null; remark: string | null; at: string }[];
    flags: { id: string; type: string; title: string; message: string; owner: string | null; action: string | null; note: string | null; open: boolean; createdAt: string }[];
  }[];
  messages: { from: string; name: string | null; body: string; channel: string; at: string }[];
  history: { action: string; by: string; at: string; after: unknown }[];
};
export const getOrder = (id: string) => request<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`);
export const editOrder = (id: string, patch: Partial<{ customerName: string; customerPhone: string; addressLine: string; city: string; state: string; pincode: string; weightGrams: number }>) =>
  request<OrderDetail>(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const cancelOrder = (id: string, scope: "shipment" | "order", reason: string) =>
  request<OrderDetail>(`/api/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ scope, reason }) });

/** One PDF with every selected label, one per page. */
export const labelsUrl = (shipmentIds: string[]) => `${API_URL}/api/labels.pdf?ids=${shipmentIds.join(",")}`;

// ---------- Needs you ----------

export type FlagAction = { kind: "act" | "resolve" | "reassign"; note?: string; ownerId?: string };
export const actOnFlag = (id: string, action: FlagAction) =>
  request<{ ok: boolean; message: string }>(`/api/flags/${id}/act`, { method: "POST", body: JSON.stringify(action) });

export type TeamMember = { id: string; name: string; role: string; email: string | null; lastLoginAt: string | null };
export const getTeam = () => request<TeamMember[]>("/api/team");

export type CourierInfo = { code: string; name: string; mode: "DEMO" | "LIVE"; pickupOnTimePct?: number };
export const getCouriers = () => request<CourierInfo[]>("/api/couriers");

// ---------- Payments ----------

type Money = { amount: number; orders: number };
export type PaymentsSummary = {
  codOnTheWay: Money;
  codDelivered: Money;
  advances: { held: Money; adjusted: Money; refunded: Money; forfeited: Money };
  freight30d: { amount: number; shipments: number };
};
export const getPayments = () => request<PaymentsSummary>("/api/payments/summary");

export const changePassword = (current: string, next: string) =>
  request<{ ok: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) });
export const resetPassword = (userId: string, next: string) =>
  request<{ ok: boolean; name: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ userId, next }) });
