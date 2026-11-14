/**
 * Sample data for the screen designs. Vendor names match our pickup points;
 * customer names are shortened and phone numbers masked. Replaced by live API
 * data once the screens are approved.
 */
import type { Tone } from "@/components/ui/primitives";

export type OrderTab = "NEW" | "READY_TO_SHIP" | "IN_TRANSIT" | "DELIVERED" | "NEEDS_ATTENTION" | "RTO";

export const ORDER_TABS: { key: OrderTab; label: string; count: number }[] = [
  { key: "NEW", label: "New", count: 13 },
  { key: "READY_TO_SHIP", label: "Ready to ship", count: 4 },
  { key: "IN_TRANSIT", label: "In transit", count: 7 },
  { key: "DELIVERED", label: "Delivered", count: 271 },
  { key: "NEEDS_ATTENTION", label: "Needs attention", count: 1 },
  { key: "RTO", label: "RTO", count: 2 },
];

export type SampleOrder = {
  id: string;
  date: string;
  customer: string;
  phone: string;
  city: string;
  pincode: string;
  brand: string;
  product: string;
  qty: number;
  weightKg: number;
  dims: string;
  payment: "COD" | "Prepaid";
  amount: number;
  vendor: string;
  tab: OrderTab;
  status: string;
  statusTone: Tone;
  courier?: string;
  awb?: string;
  rtoRisk?: "High" | "Medium";
  weightMismatch?: boolean;
};

export const SAMPLE_ORDERS: SampleOrder[] = [
  { id: "18909", date: "14 Nov, 12:00", customer: "Bhawana J.", phone: "98xxxxxx21", city: "Mumbai", pincode: "401107", brand: "AccessHer", product: "Gold-plated bangles set", qty: 1, weightKg: 5.28, dims: "40×33×20", payment: "COD", amount: 360, vendor: "Star India", tab: "NEW", status: "New", statusTone: "orange", rtoRisk: "High", weightMismatch: true },
  { id: "18908", date: "14 Nov, 10:14", customer: "Divya M.", phone: "97xxxxxx08", city: "Chennai", pincode: "603112", brand: "AccessHer", product: "Kada bangle set", qty: 1, weightKg: 5.28, dims: "40×33×20", payment: "COD", amount: 614, vendor: "Laxmi Imitation", tab: "NEW", status: "New", statusTone: "orange", weightMismatch: true },
  { id: "18907", date: "14 Nov, 09:40", customer: "Arjun P.", phone: "99xxxxxx44", city: "Bengaluru", pincode: "560034", brand: "AccessHim", product: "Steel bracelet", qty: 2, weightKg: 0.4, dims: "15×10×5", payment: "COD", amount: 899, vendor: "Reemm Creations", tab: "NEW", status: "New", statusTone: "orange", rtoRisk: "Medium" },
  { id: "18906", date: "14 Nov, 09:12", customer: "Neha S.", phone: "98xxxxxx17", city: "New Delhi", pincode: "110017", brand: "Drape N Don", product: "Cotton kurta set", qty: 1, weightKg: 0.7, dims: "30×25×5", payment: "Prepaid", amount: 1499, vendor: "D2C Main Warehouse", tab: "NEW", status: "New", statusTone: "orange" },
  { id: "18902", date: "13 Nov, 18:30", customer: "Priya N.", phone: "90xxxxxx63", city: "Pune", pincode: "411014", brand: "Bagssy", product: "Tote handbag", qty: 1, weightKg: 0.9, dims: "35×28×10", payment: "Prepaid", amount: 1299, vendor: "Mundi (Apex Enterprise)", tab: "READY_TO_SHIP", status: "Pickup 2–4 pm today", statusTone: "blue", courier: "Xpressbees", awb: "14160093820415" },
  { id: "18899", date: "12 Nov, 16:05", customer: "Imran A.", phone: "96xxxxxx02", city: "Hyderabad", pincode: "500081", brand: "Hungama HiLife", product: "G1 smartwatch", qty: 1, weightKg: 0.3, dims: "12×10×8", payment: "COD", amount: 1099, vendor: "Star India", tab: "IN_TRANSIT", status: "In transit · Hyderabad hub", statusTone: "blue", courier: "Delhivery", awb: "14905527310946" },
  { id: "18897", date: "12 Nov, 11:20", customer: "Kavya T.", phone: "94xxxxxx58", city: "Kochi", pincode: "682024", brand: "Luxura Sciences", product: "Argan hair oil", qty: 1, weightKg: 0.8, dims: "32×26×6", payment: "Prepaid", amount: 549, vendor: "Laxmi Imitation", tab: "IN_TRANSIT", status: "No scan for 52 h", statusTone: "red", courier: "Ekart", awb: "FMPC3301847219" },
  { id: "18886", date: "04 Nov, 18:56", customer: "Sahil K.", phone: "98xxxxxx97", city: "Mumbai", pincode: "400097", brand: "Kasrat", product: "Hex dumbbell pair", qty: 1, weightKg: 2, dims: "30×20×15", payment: "Prepaid", amount: 2224, vendor: "D2C Main Warehouse", tab: "NEEDS_ATTENTION", status: "NDR · Attempt 1", statusTone: "amber", courier: "Blue Dart", awb: "77280550314", rtoRisk: "High" },
  { id: "18870", date: "06 Oct, 08:54", customer: "Sana R.", phone: "93xxxxxx76", city: "Noida", pincode: "201307", brand: "Hungama HiLife", product: "Bounce earbuds", qty: 1, weightKg: 2, dims: "30×20×15", payment: "Prepaid", amount: 2224, vendor: "D2C Main Warehouse", tab: "RTO", status: "RTO delivered", statusTone: "grey", courier: "Amazon Shipping", awb: "374070260863" },
];

export const CONTROL_TOWER_KPIS = [
  { label: "Pickups today", value: "9 / 14", sub: "done / due", tone: "orange" as Tone },
  { label: "In transit", value: "7", sub: "2 out for delivery", tone: "blue" as Tone },
  { label: "Delivered today", value: "18", sub: "96% on time", tone: "green" as Tone },
  { label: "Needs attention", value: "3", sub: "1 NDR · 2 stuck", tone: "amber" as Tone },
  { label: "Open red flags", value: "4", sub: "2 critical", tone: "red" as Tone },
  { label: "COD pending", value: "₹48,320", sub: "62 orders", tone: "grey" as Tone },
];

export type RedFlagItem = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  owner: string;
  age: string;
  escalation: string;
};

export const RED_FLAGS: RedFlagItem[] = [
  { id: "f1", severity: "critical", title: "Pickup slot missed · Star India", detail: "Xpressbees · 10–12 am slot · 6 parcels · 2nd miss", owner: "Ops Executive", age: "2 h", escalation: "Escalated to Ops Manager" },
  { id: "f2", severity: "critical", title: "No scan for 52 hours · AWB FMPC3301847219", detail: "Ekart · Kochi · last seen at origin hub", owner: "Ops Executive", age: "4 h", escalation: "RCA request drafted" },
  { id: "f3", severity: "warning", title: "NDR not actioned · Order 18886", detail: "Blue Dart · customer not available · reattempt link sent", owner: "Support Executive", age: "19 h", escalation: "Due in 5 h" },
  { id: "f4", severity: "warning", title: "Customer waiting for reply · Order 18899", detail: "“When will my HiLife smartwatch arrive?”", owner: "Support Executive", age: "1 h 40 m", escalation: "Due in 20 m" },
];

export type PickupRow = {
  vendor: string;
  cluster: string;
  courier: string;
  slot: string;
  parcels: number;
  status: string;
  tone: Tone;
};

export const TODAY_PICKUPS: PickupRow[] = [
  { vendor: "Star India", cluster: "Malad", courier: "Xpressbees", slot: "10–12 am", parcels: 6, status: "Missed · moved to Delhivery 2–4 pm", tone: "red" },
  { vendor: "Laxmi Imitation", cluster: "Malad", courier: "Delhivery", slot: "12–2 pm", parcels: 4, status: "Picked up", tone: "green" },
  { vendor: "Mundi (Apex Enterprise)", cluster: "Malad", courier: "Xpressbees", slot: "2–4 pm", parcels: 3, status: "Confirmed · executive assigned", tone: "blue" },
  { vendor: "Reemm Creations", cluster: "Kandivali", courier: "Shadowfax", slot: "2–4 pm", parcels: 2, status: "Awaiting courier confirmation", tone: "amber" },
  { vendor: "D2C Main Warehouse", cluster: "Noida", courier: "Blue Dart", slot: "4–6 pm", parcels: 11, status: "Scheduled", tone: "grey" },
];

export const COURIER_SCORES = [
  { courier: "Delhivery", pickupOnTime: 96, deliveredOnTime: 93, rto: 4 },
  { courier: "Blue Dart", pickupOnTime: 94, deliveredOnTime: 95, rto: 3 },
  { courier: "Shadowfax", pickupOnTime: 91, deliveredOnTime: 90, rto: 6 },
  { courier: "Ekart", pickupOnTime: 88, deliveredOnTime: 87, rto: 7 },
  { courier: "Xpressbees", pickupOnTime: 72, deliveredOnTime: 89, rto: 5 },
];

export const WAREHOUSES = [
  { code: "D2CNOI", name: "D2C Main Warehouse", pincode: "201309" },
  { code: "WHFQFV", name: "Star India", pincode: "400097" },
  { code: "WHUY73", name: "Laxmi Imitation", pincode: "400064" },
  { code: "WHZAE7", name: "Mundi (Apex Enterprise)", pincode: "400064" },
  { code: "WHTO34", name: "Reemm Creations", pincode: "400101" },
];

export const PICKUP_SLOTS = ["10–12 am", "12–2 pm", "2–4 pm", "4–6 pm"];

export const formatINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

export const BRANDS_TODAY = [
  { slug: "accessher", name: "AccessHer", orders: 42, shipped: 31 },
  { slug: "hilife", name: "Hungama HiLife", orders: 27, shipped: 22 },
  { slug: "kasrat", name: "Kasrat", orders: 11, shipped: 9 },
  { slug: "luxura", name: "Luxura Sciences", orders: 9, shipped: 7 },
  { slug: "accesshim", name: "AccessHim", orders: 8, shipped: 8 },
];
