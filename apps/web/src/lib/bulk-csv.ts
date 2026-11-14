/**
 * Bulk order CSV checks. Columns follow our current Velocity bulk sheet so the
 * team does not relearn a format. Every row is checked before anything books.
 */
export const BULK_COLUMNS = [
  "order_id",
  "customer_name",
  "customer_phone",
  "address",
  "city",
  "state",
  "pincode",
  "payment_method",
  "order_value",
  "weight_kg",
  "length_cm",
  "breadth_cm",
  "height_cm",
  "pickup_warehouse_id",
  "rto_warehouse_id",
] as const;

/** Optional: the advance a COD customer already paid online (Rs 49 / Rs 99 at D2C Mall). */
export const OPTIONAL_COLUMNS = ["advance_paid"] as const;

export type BulkRow = Record<(typeof BULK_COLUMNS)[number], string> & {
  advance_paid: string;
  line: number;
  errors: string[];
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseBulkCsv(text: string, knownWarehouses: string[], seenOrderIds = new Set<string>()): BulkRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missing = BULK_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);

  const ids = new Set(seenOrderIds);
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    const values = Object.fromEntries(BULK_COLUMNS.map((c) => [c, cells[header.indexOf(c)] ?? ""])) as Record<
      (typeof BULK_COLUMNS)[number],
      string
    >;
    const advanceCol = header.indexOf("advance_paid");
    const row: BulkRow = { ...values, advance_paid: advanceCol >= 0 ? (cells[advanceCol] ?? "") : "", line: i + 2, errors: [] };

    if (!row.order_id) row.errors.push("Order ID is empty");
    else if (ids.has(row.order_id)) row.errors.push("Duplicate order ID");
    ids.add(row.order_id);
    if (!/^[6-9]\d{9}$/.test(row.customer_phone)) row.errors.push("Phone must be 10 digits");
    if (!/^[1-9]\d{5}$/.test(row.pincode)) row.errors.push("Pin code must be 6 digits");
    if (!["cod", "prepaid"].includes(row.payment_method.toLowerCase())) row.errors.push("Payment must be COD or Prepaid");
    if (!(Number(row.order_value) > 0)) row.errors.push("Order value must be above 0");
    if (!(Number(row.weight_kg) > 0)) row.errors.push("Weight must be above 0");
    for (const d of ["length_cm", "breadth_cm", "height_cm"] as const) {
      if (!(Number(row[d]) > 0)) row.errors.push(`${d.replace("_cm", "")} must be above 0`);
    }
    if (row.advance_paid) {
      const adv = Number(row.advance_paid);
      if (!(adv >= 0)) row.errors.push("Advance must be a number");
      else if (row.payment_method.toLowerCase() !== "cod" && adv > 0) row.errors.push("Advance only applies to COD");
      else if (adv >= Number(row.order_value)) row.errors.push("Advance must be less than the order value");
    }
    if (!knownWarehouses.includes(row.pickup_warehouse_id)) row.errors.push("Unknown pickup warehouse ID");
    if (row.rto_warehouse_id && !knownWarehouses.includes(row.rto_warehouse_id)) {
      row.errors.push("Unknown RTO warehouse ID");
    }
    return row;
  });
}

export const SAMPLE_BULK_CSV = `${BULK_COLUMNS.join(",")}
18910,Mansi K.,9876501234,"Shop 6, Dadar West",Mumbai,Maharashtra,400028,Prepaid,1440,4.5,30,25,15,WHFQFV,WHFQFV
18911,Rahul S.,9812345670,"Flat 3B, Sector 18",Noida,Uttar Pradesh,201301,COD,799,0.6,20,15,8,D2CNOI,D2CNOI
18912,Ayesha F.,98123,"MG Road",Bengaluru,Karnataka,560001,COD,1199,0.8,25,20,10,WHUY73,WHUY73
18913,Vikram R.,9900112233,"Banjara Hills",Hyderabad,Telangana,500034,Prepaid,2599,1.2,30,20,12,WHZZZZ,WHTO34
18914,Pooja L.,9988776655,"Salt Lake Sector 5",Kolkata,West Bengal,700091,Prepaid,649,0.4,20,15,6,WHTO34,WHTO34`;

/** A sample where every row is correct, to show bulk booking end to end. */
export const SAMPLE_BULK_CSV_CLEAN = `${BULK_COLUMNS.join(",")},advance_paid
18920,Mansi K.,9876501234,"Shop 6, Dadar West",Mumbai,Maharashtra,400028,Prepaid,1440,1.5,30,25,15,WHFQFV,WHFQFV,
18921,Rahul S.,9812345670,"Flat 3B, Sector 18",Noida,Uttar Pradesh,201301,COD,799,0.6,20,15,8,D2CNOI,D2CNOI,49
18922,Ayesha F.,9812312345,"MG Road, Ashok Nagar",Bengaluru,Karnataka,560001,COD,1199,0.8,25,20,10,WHUY73,WHUY73,99
18923,Vikram R.,9900112233,"Road 12, Banjara Hills",Hyderabad,Telangana,500034,Prepaid,2599,1.2,30,20,12,WHTO34,WHTO34,
18924,Pooja L.,9988776655,"Salt Lake Sector 5",Kolkata,West Bengal,700091,Prepaid,649,0.4,20,15,6,WHZAE7,WHZAE7,`;
