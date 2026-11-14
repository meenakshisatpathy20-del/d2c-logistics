/**
 * Sample data for the screen designs. Vendor and brand names are real;
 * customer names are shortened and phone numbers masked. Replaced by live API
 * data once the screens are approved.
 */
import type { Tone } from "@/components/ui/primitives";

export const formatINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

// ---------- Journey lanes ----------

export type Lane = "PROBLEM" | "TO_PACK" | "READY" | "PICKED" | "MOVING" | "OUT_TODAY" | "DELIVERED";

export const LANES: { key: Lane; label: string; hint: string; tone: Tone }[] = [
  { key: "PROBLEM", label: "Needs a fix", hint: "Stuck, failed or late", tone: "red" },
  { key: "TO_PACK", label: "To pack", hint: "New orders", tone: "orange" },
  { key: "READY", label: "Ready for pickup", hint: "Booked, slot set", tone: "amber" },
  { key: "MOVING", label: "On the way", hint: "Picked up, moving between hubs", tone: "blue" },
  { key: "OUT_TODAY", label: "Out today", hint: "Arriving today", tone: "green" },
  { key: "DELIVERED", label: "Delivered", hint: "Today", tone: "green" },
];

export type Shipment = {
  id: string; // order number
  brand: string;
  brandSlug: string;
  product: string;
  customer: string;
  phone: string;
  city: string;
  pincode: string;
  payment: "COD" | "Prepaid";
  amount: number;
  vendor: string;
  lane: Lane;
  courier?: string;
  awb?: string;
  note: string; // the one line that matters on the card
  noteTone: Tone;
  owner: string; // initials
  ownerName: string;
  problem?: string;
  rtoRisk?: "High" | "Medium";
  weightKg: number;
  dims: string;
  placedAt: string;
};

export const SHIPMENTS: Shipment[] = [
  { id: "18886", brand: "Kasrat", brandSlug: "kasrat", product: "Hex dumbbell pair", customer: "Sahil K.", phone: "98xxxxxx97", city: "Mumbai", pincode: "400097", payment: "Prepaid", amount: 2224, vendor: "D2C Main Warehouse", lane: "PROBLEM", courier: "Blue Dart", awb: "77280550314", note: "Delivery failed · customer picked tomorrow 6–9 pm", noteTone: "red", owner: "SE", ownerName: "Support Executive", problem: "NDR", weightKg: 2, dims: "30×20×15", placedAt: "04 Nov" },
  { id: "18897", brand: "Luxura Sciences", brandSlug: "luxura", product: "Argan hair oil", customer: "Kavya T.", phone: "94xxxxxx58", city: "Kochi", pincode: "682024", payment: "Prepaid", amount: 549, vendor: "Laxmi Imitation", lane: "PROBLEM", courier: "Ekart", awb: "FMPC3301847219", note: "No scan for 52 h · RCA sent to Ekart", noteTone: "red", owner: "OE", ownerName: "Ops Executive", problem: "Stuck", weightKg: 0.8, dims: "32×26×6", placedAt: "12 Nov" },
  { id: "18895", brand: "AccessHer", brandSlug: "accessher", product: "Pearl earrings", customer: "Hetal P.", phone: "97xxxxxx31", city: "Ahmedabad", pincode: "380015", payment: "COD", amount: 699, vendor: "Star India", lane: "PROBLEM", courier: "Delhivery", awb: "14905527310971", note: "Gujarat delay · customer informed", noteTone: "amber", owner: "OE", ownerName: "Ops Executive", problem: "Late", weightKg: 0.3, dims: "12×10×5", placedAt: "11 Nov" },

  { id: "18909", brand: "AccessHer", brandSlug: "accessher", product: "Gold-plated bangles set", customer: "Bhawana J.", phone: "98xxxxxx21", city: "Mumbai", pincode: "401107", payment: "COD", amount: 360, vendor: "Star India", lane: "TO_PACK", note: "COD confirmed · weight to check", noteTone: "amber", owner: "OE", ownerName: "Ops Executive", rtoRisk: "High", weightKg: 5.28, dims: "40×33×20", placedAt: "Today 12:00" },
  { id: "18908", brand: "AccessHer", brandSlug: "accessher", product: "Kada bangle set", customer: "Divya M.", phone: "97xxxxxx08", city: "Chennai", pincode: "603112", payment: "COD", amount: 614, vendor: "Laxmi Imitation", lane: "TO_PACK", note: "Waiting for COD confirmation", noteTone: "grey", owner: "OE", ownerName: "Ops Executive", weightKg: 5.28, dims: "40×33×20", placedAt: "Today 10:14" },
  { id: "18907", brand: "AccessHim", brandSlug: "accesshim", product: "Steel bracelet", customer: "Arjun P.", phone: "99xxxxxx44", city: "Bengaluru", pincode: "560034", payment: "COD", amount: 899, vendor: "Reemm Creations", lane: "TO_PACK", note: "Ready to book", noteTone: "green", owner: "OE", ownerName: "Ops Executive", rtoRisk: "Medium", weightKg: 0.4, dims: "15×10×5", placedAt: "Today 09:40" },
  { id: "18906", brand: "Drape N Don", brandSlug: "drape-n-don", product: "Cotton kurta set", customer: "Neha S.", phone: "98xxxxxx17", city: "New Delhi", pincode: "110017", payment: "Prepaid", amount: 1499, vendor: "D2C Main Warehouse", lane: "TO_PACK", note: "Ready to book", noteTone: "green", owner: "OE", ownerName: "Ops Executive", weightKg: 0.7, dims: "30×25×5", placedAt: "Today 09:12" },

  { id: "18902", brand: "Bagssy", brandSlug: "bagssy", product: "Tote handbag", customer: "Priya N.", phone: "90xxxxxx63", city: "Pune", pincode: "411014", payment: "Prepaid", amount: 1299, vendor: "Mundi (Apex Enterprise)", lane: "READY", courier: "Xpressbees", awb: "14160093820415", note: "Pickup 2–4 pm · executive confirmed", noteTone: "blue", owner: "OE", ownerName: "Ops Executive", weightKg: 0.9, dims: "35×28×10", placedAt: "13 Nov" },
  { id: "18901", brand: "Hungama HiLife", brandSlug: "hilife", product: "Groove speaker", customer: "Farhan Q.", phone: "93xxxxxx11", city: "Lucknow", pincode: "226010", payment: "COD", amount: 1799, vendor: "D2C Main Warehouse", lane: "READY", courier: "Blue Dart", awb: "77280550401", note: "Pickup 4–6 pm · awaiting confirmation", noteTone: "amber", owner: "OE", ownerName: "Ops Executive", weightKg: 1.1, dims: "20×20×15", placedAt: "13 Nov" },

  { id: "18900", brand: "Swarg Homes", brandSlug: "swarg-homes", product: "Cushion covers (5)", customer: "Meera I.", phone: "96xxxxxx72", city: "Surat", pincode: "395007", payment: "Prepaid", amount: 899, vendor: "Laxmi Imitation", lane: "MOVING", courier: "Delhivery", awb: "14905527310984", note: "Picked up 12:40 pm", noteTone: "blue", owner: "OE", ownerName: "Ops Executive", weightKg: 0.9, dims: "30×30×8", placedAt: "13 Nov" },

  { id: "18899", brand: "Hungama HiLife", brandSlug: "hilife", product: "G1 smartwatch", customer: "Imran A.", phone: "96xxxxxx02", city: "Hyderabad", pincode: "500081", payment: "COD", amount: 1099, vendor: "Star India", lane: "MOVING", courier: "Delhivery", awb: "14905527310946", note: "Hyderabad hub · arrives tomorrow", noteTone: "blue", owner: "SE", ownerName: "Support Executive", weightKg: 0.3, dims: "12×10×8", placedAt: "12 Nov" },
  { id: "18896", brand: "Kasrat", brandSlug: "kasrat", product: "Resistance bands", customer: "Rohit G.", phone: "91xxxxxx45", city: "Guwahati", pincode: "781006", payment: "COD", amount: 749, vendor: "D2C Main Warehouse", lane: "MOVING", courier: "Shadowfax", awb: "SF2049381172", note: "Kolkata hub · special zone, 2 more days", noteTone: "blue", owner: "OE", ownerName: "Ops Executive", weightKg: 0.6, dims: "20×15×8", placedAt: "11 Nov" },

  { id: "18893", brand: "Luxura Sciences", brandSlug: "luxura", product: "Vitamin C serum", customer: "Ritu D.", phone: "98xxxxxx90", city: "Kolkata", pincode: "700091", payment: "Prepaid", amount: 999, vendor: "D2C Main Warehouse", lane: "OUT_TODAY", courier: "Xpressbees", awb: "14160093820388", note: "Out for delivery · customer notified", noteTone: "green", owner: "SE", ownerName: "Support Executive", weightKg: 0.2, dims: "10×10×10", placedAt: "10 Nov" },

  { id: "18890", brand: "AccessHer", brandSlug: "accessher", product: "Necklace set", customer: "Kavita R.", phone: "99xxxxxx26", city: "Jaipur", pincode: "302017", payment: "COD", amount: 1899, vendor: "Star India", lane: "DELIVERED", courier: "Delhivery", awb: "14905527310902", note: "Delivered 11:20 am · rated 5★", noteTone: "green", owner: "SE", ownerName: "Support Executive", weightKg: 0.4, dims: "15×12×6", placedAt: "09 Nov" },
];

export const LANE_TOTALS: Record<Lane, number> = {
  PROBLEM: 3,
  TO_PACK: 13,
  READY: 4,
  PICKED: 0,
  MOVING: 13,
  OUT_TODAY: 2,
  DELIVERED: 18,
};

// ---------- Today ----------

export type NeedsYou = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  due: string;
  action: string;
  href: string;
};

export const NEEDS_YOU: NeedsYou[] = [
  { id: "n1", severity: "critical", title: "Star India pickup missed twice", detail: "Xpressbees, 10–12 am · 6 parcels", due: "Escalated", action: "Move to Delhivery", href: "/shipments" },
  { id: "n2", severity: "critical", title: "No scan for 52 hours", detail: "#18897 · Luxura · Ekart, Kochi", due: "RCA sent", action: "See shipment", href: "/shipments" },
  { id: "n3", severity: "warning", title: "Customer chose a new delivery day", detail: "#18886 · Kasrat · Blue Dart", due: "Due in 5 h", action: "Confirm reattempt", href: "/shipments" },
  { id: "n4", severity: "warning", title: "Customer waiting for a reply", detail: "#18899 · “When will my HiLife smartwatch arrive?”", due: "Due in 20 m", action: "Reply", href: "/shipments" },
];

export type SlotStatus = "done" | "confirmed" | "waiting" | "missed" | "scheduled";

export const PICKUP_TIMELINE: {
  vendor: string;
  area: string;
  slots: { start: number; end: number; courier: string; parcels: number; status: SlotStatus; label: string }[];
}[] = [
  { vendor: "Star India", area: "Malad", slots: [
    { start: 10, end: 12, courier: "Xpressbees", parcels: 6, status: "missed", label: "Missed" },
    { start: 14, end: 16, courier: "Delhivery", parcels: 6, status: "confirmed", label: "Moved to Delhivery" },
  ] },
  { vendor: "Laxmi Imitation", area: "Malad", slots: [{ start: 12, end: 14, courier: "Delhivery", parcels: 4, status: "done", label: "Picked up" }] },
  { vendor: "Mundi (Apex)", area: "Malad", slots: [{ start: 14, end: 16, courier: "Xpressbees", parcels: 3, status: "confirmed", label: "Confirmed" }] },
  { vendor: "Reemm Creations", area: "Kandivali", slots: [{ start: 14, end: 16, courier: "Shadowfax", parcels: 2, status: "waiting", label: "Awaiting confirmation" }] },
  { vendor: "D2C Main Warehouse", area: "Noida", slots: [
    { start: 10, end: 12, courier: "Blue Dart", parcels: 8, status: "done", label: "Picked up" },
    { start: 16, end: 18, courier: "Blue Dart", parcels: 11, status: "scheduled", label: "Scheduled" },
  ] },
];

/** "Now" on the sample day, in hours (13:30). */
export const NOW_HOUR = 13.5;

export const PULSE = [
  { label: "Moving now", value: "15", tone: "blue" as Tone },
  { label: "Out today", value: "2", tone: "green" as Tone },
  { label: "Delivered today", value: "18", tone: "green" as Tone },
  { label: "COD pending", value: "₹48,320", tone: "grey" as Tone },
];

export const BRANDS_TODAY = [
  { slug: "accessher", name: "AccessHer", orders: 42, shipped: 31 },
  { slug: "hilife", name: "Hungama HiLife", orders: 27, shipped: 22 },
  { slug: "kasrat", name: "Kasrat", orders: 11, shipped: 9 },
  { slug: "luxura", name: "Luxura Sciences", orders: 9, shipped: 7 },
  { slug: "accesshim", name: "AccessHim", orders: 8, shipped: 8 },
];

// ---------- Booking ----------

export const WAREHOUSES = [
  { code: "D2CNOI", name: "D2C Main Warehouse", pincode: "201309" },
  { code: "WHFQFV", name: "Star India", pincode: "400097" },
  { code: "WHUY73", name: "Laxmi Imitation", pincode: "400064" },
  { code: "WHZAE7", name: "Mundi (Apex Enterprise)", pincode: "400064" },
  { code: "WHTO34", name: "Reemm Creations", pincode: "400101" },
];
