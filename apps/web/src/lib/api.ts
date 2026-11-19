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
  switchedOff?: boolean;
  failingNow?: boolean;
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
    const path = window.location.pathname;
    window.location.replace(path === "/v" || path.startsWith("/v/") ? "/v/login" : `/login?next=${encodeURIComponent(path + window.location.search)}`);
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

export type Warehouse = { code: string; name: string; city: string; pincode: string; cluster: string | null; opensAt: number; closesAt: number; saturdayClosesAt: number | null; hours: string };
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
  /** Couriers tried first whose booking failed; the order went to the next one. */
  failedOver?: { courierCode: string; courierName: string; reason: string }[];
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
    escalationLevel: number;
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
export type Me = { id: string; name: string; email: string | null; role: string; warehouseId: string | null };
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
    packedAt: string | null;
    photos: { id: string; url: string; at: string }[];
    events: { status: string; location: string | null; remark: string | null; at: string }[];
    flags: { id: string; type: string; title: string; message: string; owner: string | null; action: string | null; note: string | null; escalationLevel: number; open: boolean; createdAt: string }[];
  }[];
  messages: { from: string; name: string | null; body: string; channel: string; at: string }[];
  /** Open problems about the order itself (e.g. not booked in 24 hours). */
  orderFlags?: OrderDetail["shipments"][number]["flags"];
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

export type TeamMember = { id: string; name: string; role: string; email: string | null; phone: string; active: boolean; managerId: string | null; lastLoginAt: string | null };
export const getTeam = () => request<TeamMember[]>("/api/team");

export type CourierInfo = {
  code: string;
  name: string;
  mode: "DEMO" | "LIVE";
  active: boolean;
  pickupOnTimePct?: number;
  // Connection health (Settings): only for team roles that may see it.
  health?: "ok" | "failing" | "off";
  lastBookedAt?: string | null;
  lastFailedAt?: string | null;
  lastError?: string | null;
  failures24h?: number;
  simulated?: string | null;
};
export const getCourierHealth = () => request<CourierInfo[]>("/api/couriers/health");
export const simulateCourierFailure = (code: string, message: string | null) =>
  request<CourierInfo>(`/api/couriers/${code}/simulate-failure`, { method: "POST", body: JSON.stringify({ message }) });
export const setCourierActive = (code: string, active: boolean, reason?: string) =>
  request<CourierInfo>(`/api/couriers/${code}`, { method: "PATCH", body: JSON.stringify({ active, reason }) });

// ---------- Settings: team, warehouses ----------

export const addTeamMember = (m: { name: string; email: string; phone: string; role: string; managerId?: string; password: string }) =>
  request<{ id: string }>("/api/settings/team", { method: "POST", body: JSON.stringify(m) });
export const updateTeamMember = (id: string, patch: { active?: boolean; role?: string; managerId?: string | null }) =>
  request<{ id: string }>(`/api/settings/team/${id}`, { method: "PATCH", body: JSON.stringify(patch) });

export type WarehouseFull = {
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  cluster: string | null;
  contactName: string;
  contactPhone: string;
  opensAt: number;
  closesAt: number;
  saturdayClosesAt: number | null;
  hours: string;
  placeholder: boolean;
  vendorLogin: { active: boolean; lastLoginAt: string | null } | null;
};
export const getWarehousesFull = () => request<WarehouseFull[]>("/api/settings/warehouses");
export const addWarehouse = (w: Omit<WarehouseFull, "placeholder" | "vendorLogin" | "cluster" | "hours"> & { cluster?: string }) =>
  request<WarehouseFull>("/api/settings/warehouses", { method: "POST", body: JSON.stringify(w) });
export const updateWarehouse = (code: string, patch: Partial<Omit<WarehouseFull, "code" | "placeholder" | "vendorLogin" | "hours">>) =>
  request<WarehouseFull>(`/api/settings/warehouses/${code}`, { method: "PATCH", body: JSON.stringify(patch) });
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

// ---------- Alerts, messages, summary ----------

export type BellItem = { id: string; kind: string; title: string; body: string; link: string | null; read: boolean; at: string };
export const getBell = () => request<{ unread: number; items: BellItem[] }>("/api/notifications/mine");
export const markAllRead = () => request<{ ok: boolean }>("/api/notifications/read", { method: "POST" });
export const markRead = (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" });

export type OutboxRow = { id: string; channel: "WHATSAPP" | "SMS" | "EMAIL"; to: string; kind: string; title: string; body: string; status: string; at: string };
export const getOutbox = (page = 1) => request<{ total: number; page: number; pages: number; rows: OutboxRow[] }>(`/api/messages?page=${page}`);

export type DailySummaryData = {
  day: string;
  booked: number;
  pickedUp: number;
  delivered: number;
  rtoStarted: number;
  stuck: number;
  redFlagsOpen: number;
  critical: number;
  overdue: number;
  codPending: number;
  codPendingOrders: number;
  advancesHeld: number;
  freightToday: number;
  pickups: { due: number; done: number; missed: number };
  topProblems: { title: string; message: string; owner: string }[];
};
export type Summary = { day: string; createdAt: string; data: DailySummaryData; text: string } | null;
export const getLatestSummary = () => request<Summary>("/api/summary/latest");
export const sendSummaryNow = () => request<Summary>("/api/summary/send-now", { method: "POST" });

// ---------- Pickups (upcoming, postpone) and vendor view ----------

export type UpcomingPickup = {
  id: string;
  warehouse: { code: string; name: string; area: string };
  slot: string;
  slotStart: string;
  courier: string;
  status: string;
  executive: string | null;
  postponeReason: string | null;
  canPostpone: boolean;
  parcelCount: number;
  packed: number;
  manifestUrl: string;
  parcels: {
    id: string;
    awb: string;
    orderNumber: string;
    product: string;
    brand: string;
    city: string;
    pincode: string;
    payment: string;
    weightKg: number;
    packed: boolean;
    photos: string[];
  }[];
};
export type PickupDay = { day: string; pickups: UpcomingPickup[] };
export const getUpcomingPickups = () => request<PickupDay[]>("/api/pickups");
export const postponePickup = (id: string, reason: string) =>
  request<{ ok: boolean; movedTo: string }>(`/api/pickups/${id}/postpone`, { method: "POST", body: JSON.stringify({ reason }) });

export const vendorLogin = (phone: string) =>
  request<LoginStep>("/api/auth/vendor-login", { method: "POST", body: JSON.stringify({ phone }) });
export type VendorToday = { warehouse: { code: string; name: string; city: string; contactName: string }; days: PickupDay[] };
export const getVendorToday = () => request<VendorToday>("/api/vendor/today");
export const markPacked = (shipmentIds: string[], packed = true) =>
  request<{ ok: boolean }>("/api/vendor/packed", { method: "POST", body: JSON.stringify({ shipmentIds, packed }) });
export const uploadPackingPhoto = (shipmentId: string, dataUrl: string) =>
  request<{ id: string }>(`/api/vendor/shipments/${shipmentId}/photos`, { method: "POST", body: JSON.stringify({ dataUrl }) });
export const photoUrl = (id: string) => `${API_URL}/api/photos/${id}`;

// ---------- Weight check ----------

export const getWeightHint = (product: string) =>
  request<{ product: string; samples: number; typicalGrams: number | null }>(`/api/weight-hint?product=${encodeURIComponent(product)}`);

// ---------- Issues ----------

export type Party = "OURS" | "COURIER" | "VENDOR" | "CUSTOMER";
export type IssueGroup = "PICKUPS" | "TRANSIT" | "DELIVERY" | "RETURNS" | "WEIGHT" | "MONEY" | "BOOKING" | "OTHER";
export type IssueRow = {
  id: string;
  type: string;
  group: IssueGroup;
  title: string;
  message: string;
  severity: "critical" | "warning";
  about: { kind: "order" | "pickup" | "courier"; id: string; label: string; sub: string } | null;
  waitingOn: Party;
  waitingOnLabel: string;
  waitingPerson: string;
  waitedMinutes: number;
  reminders: number;
  promiseAt: string | null;
  promiseText: string | null;
  promisesBroken: number;
  owner: { id: string; name: string } | null;
  dueAt: string | null;
  overdue: boolean;
  escalationLevel: number;
  openedAt: string;
  resolvedAt: string | null;
  outcome: string | null;
  faultParty: string | null;
  /** What the delay is costing: order value held up, COD not collected, days past the promised date. */
  cost: { parcels: number; value: number; cod: number; daysLate: number } | null;
};
export type IssuesPage = {
  total: number;
  page: number;
  pages: number;
  counts: { groups: Partial<Record<IssueGroup, number>>; waiting: Partial<Record<Party, number>> };
  rows: IssueRow[];
};
export type IssueEventView = { id: string; kind: string; by: string; party: string; body: string; via: string | null; promiseAt: string | null; at: string };
export type IssueDetail = IssueRow & {
  open: boolean;
  action: string | null;
  outcomes: string[];
  people: { party: string; name: string; role: string; company: string; phone: string | null; lastActive: string | null }[];
  courierContacts: { id: string; name: string; role: string; phone: string }[];
  team: { id: string; name: string; role: string }[];
  shipment: { id: string; orderId: string; orderNumber: string; status: string; courier: string; awb: string; city: string } | null;
  pickup: { id: string; warehouse: string; courier: string; slotStart: string; status: string; canPostpone: boolean; canSwitch: boolean; manifestUrl: string; hours: string; slotInHours: boolean } | null;
  order: { id: string; orderNumber: string; status: string } | null;
  events: IssueEventView[];
};
export type IssueQuery = { status?: "open" | "closed"; group?: IssueGroup | "ALL"; waiting?: Party | "ALL"; mine?: boolean; page?: number };
export const getIssues = (q: IssueQuery = {}) => {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (q.group && q.group !== "ALL") p.set("group", q.group);
  if (q.waiting && q.waiting !== "ALL") p.set("waiting", q.waiting);
  if (q.mine) p.set("mine", "1");
  if (q.page) p.set("page", String(q.page));
  return request<IssuesPage>(`/api/issues?${p}`);
};
export const getIssue = (id: string) => request<IssueDetail>(`/api/issues/${id}`);
export type DelayCost = {
  total: { value: number; cod: number; parcels: number };
  rows: { code: string; courier: string; issues: number; parcels: number; value: number; cod: number; maxDaysLate: number; waitingOnThem: number; remindersIgnored: number; promisesBroken: number }[];
};
export const getDelayCost = () => request<DelayCost>("/api/issues/delay-cost");
export type IssueAction =
  | { kind: "message"; body: string }
  | { kind: "ask"; party: Exclude<Party, "OURS">; body: string }
  | { kind: "partner_reply"; party: Exclude<Party, "OURS">; via: "WHATSAPP" | "CALL" | "EMAIL"; body: string; promiseAt?: string }
  | { kind: "call_note"; party: Exclude<Party, "OURS">; agreed: string; nextBy: Party; deadline?: string }
  | { kind: "turn"; party: Party }
  | { kind: "reassign"; ownerId: string }
  | { kind: "postpone"; reason: string }
  | { kind: "switch_courier"; reason: string }
  | { kind: "resolve"; outcome: string; faultParty: string; note?: string };
export const actOnIssue = (id: string, a: IssueAction) => request<IssueDetail>(`/api/issues/${id}/act`, { method: "POST", body: JSON.stringify(a) });
export type IssueType = { key: string; label: string; group: IssueGroup; scope: "pickup" | "order" | "courier" };
export const getIssueTypes = () => request<IssueType[]>("/api/issues/types");
export const raiseIssue = (b: { type: string; body: string; title?: string; orderId?: string; pickupId?: string; courierCode?: string }) =>
  request<IssueDetail>("/api/issues", { method: "POST", body: JSON.stringify(b) });

export type VendorIssue = { id: string; title: string; about: string; yourTurn: boolean; waitedMinutes: number; recent: { by: string; body: string; at: string }[] };
export const getVendorIssues = () => request<VendorIssue[]>("/api/vendor/issues");
export const vendorReply = (id: string, b: { kind: "READY" | "NOT_READY" | "MESSAGE"; body?: string; promiseAt?: string }) =>
  request<{ ok: boolean }>(`/api/vendor/issues/${id}/reply`, { method: "POST", body: JSON.stringify(b) });

export type CourierContactRow = { id: string; courierCode: string; name: string; role: string; phone: string; email: string | null; region: string | null; active: boolean };
export const getCourierContacts = () => request<CourierContactRow[]>("/api/settings/courier-contacts");
export const saveCourierContact = (c: Omit<CourierContactRow, "id" | "email" | "region"> & { email?: string; region?: string }, id?: string) =>
  request<CourierContactRow>(`/api/settings/courier-contacts${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(c) });

/** "3 h 20 m", "2 d 4 h" */
export function waited(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h ${minutes % 60} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
