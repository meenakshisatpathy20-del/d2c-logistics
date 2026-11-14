/**
 * Demo data for local development and demos.
 * Safe to run on every start: nothing is created twice.
 * Warehouse names and pin codes mirror our real vendor pickup points;
 * contact names and phone numbers are placeholders.
 */
import 'dotenv/config';
import { BrandService } from '../src/common/brand.service.js';
import { codAdvanceFor } from '../src/common/cod-advance.js';
import { istAt } from '../src/common/ist.js';
import { CouriersService } from '../src/couriers/couriers.service.js';
import { DEMO_COURIERS } from '../src/couriers/demo/profiles.js';
import { PickupsService } from '../src/pickups/pickups.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ShipmentsService } from '../src/shipments/shipments.service.js';
import { TrackingService } from '../src/tracking/tracking.service.js';

const prisma = new PrismaService();

async function main() {
  const brand = await prisma.brand.upsert({
    where: { slug: 'd2c' },
    update: {},
    create: { name: 'D2C Ecommerce India', slug: 'd2c' },
  });

  // Couriers: all in DEMO mode until live accounts are ready. Xpressbees is the backup.
  for (const c of DEMO_COURIERS) {
    await prisma.courier.upsert({
      where: { code: c.code },
      update: { name: c.name },
      create: { code: c.code, name: c.name, mode: 'DEMO', isBackup: c.code === 'DELHIVERY' },
    });
  }

  const founder = await upsertUser(brand.id, 'Founder', '9000000001', 'ADMIN');
  const opsManager = await upsertUser(brand.id, 'Ops Manager', '9000000002', 'OPS', founder.id);
  await upsertUser(brand.id, 'Ops Executive', '9000000003', 'OPS', opsManager.id);
  await upsertUser(brand.id, 'Support Executive', '9000000004', 'SUPPORT', opsManager.id);
  await upsertUser(brand.id, 'Finance Executive', '9000000005', 'FINANCE', founder.id);

  const warehouses = [
    { code: 'D2CNOI', name: 'D2C Main Warehouse', address: 'Sector 63', city: 'Noida', state: 'Uttar Pradesh', pincode: '201309', cluster: 'Noida' },
    { code: 'WHFQFV', name: 'Star India', address: 'Govind Nagar, Malad East', city: 'Mumbai', state: 'Maharashtra', pincode: '400097', cluster: 'Mumbai West - Malad' },
    { code: 'WHUY73', name: 'Laxmi Imitation', address: 'Anand Road, Malad West', city: 'Mumbai', state: 'Maharashtra', pincode: '400064', cluster: 'Mumbai West - Malad' },
    { code: 'WHZAE7', name: 'Mundi (Apex Enterprise)', address: 'Marve Road, Malad West', city: 'Mumbai', state: 'Maharashtra', pincode: '400064', cluster: 'Mumbai West - Malad' },
    { code: 'WHTO34', name: 'Reemm Creations', address: 'Lokhandwala Complex, Kandivali East', city: 'Mumbai', state: 'Maharashtra', pincode: '400101', cluster: 'Mumbai West - Kandivali' },
  ];
  for (const [i, w] of warehouses.entries()) {
    await prisma.warehouse.upsert({
      where: { brandId_code: { brandId: brand.id, code: w.code } },
      update: {},
      create: {
        ...w,
        brandId: brand.id,
        contactName: `Contact ${w.code}`,
        contactPhone: `98000000${String(i + 10)}`,
      },
    });
  }

  // New orders waiting to be booked (they show in "To pack").
  const pickupWarehouses = await prisma.warehouse.findMany({ where: { brandId: brand.id }, orderBy: { code: 'asc' } });
  const fresh = [
    ['18906', 'Drape N Don', 'Cotton kurta set', 'Neha S.', '110017', 'New Delhi', 'Delhi', 'PREPAID', 1499],
    ['18907', 'AccessHim', 'Steel bracelet', 'Arjun P.', '560034', 'Bengaluru', 'Karnataka', 'COD', 899],
    ['18908', 'AccessHer', 'Kada bangle set', 'Divya M.', '603112', 'Chennai', 'Tamil Nadu', 'COD', 614],
    ['18909', 'AccessHer', 'Gold-plated bangles set', 'Bhawana J.', '401107', 'Mumbai', 'Maharashtra', 'COD', 360],
  ] as const;
  for (const [i, [orderNumber, productBrand, product, name, pincode, city, state, paymentMode, value]] of fresh.entries()) {
    await prisma.order.upsert({
      where: { brandId_orderNumber: { brandId: brand.id, orderNumber } },
      update: {},
      create: {
        brandId: brand.id,
        orderNumber,
        productBrand,
        source: 'CSV',
        pickupWarehouseId: pickupWarehouses[(i + 1) % pickupWarehouses.length].id,
        customerName: name,
        customerPhone: `98${String(10000000 + i * 7341).slice(0, 8)}`,
        addressLine: 'House 12, Main Road',
        city,
        state,
        pincode,
        paymentMode,
        orderValue: value,
        codAmount: paymentMode === 'COD' ? value - codAdvanceFor(value) : 0,
        codAdvance: paymentMode === 'COD' ? codAdvanceFor(value) : 0,
        advanceStatus: paymentMode === 'COD' && codAdvanceFor(value) > 0 ? 'PAID' : null,
        weightGrams: 400 + i * 150,
        lengthCm: 20,
        breadthCm: 15,
        heightCm: 8,
        items: [{ name: product, qty: 1, price: value }],
      },
    });
  }

  if (process.env.SEED_DEMO_HISTORY !== 'false' && (await prisma.shipment.count()) === 0) {
    await demoHistory(brand.id);
  }

  const counts = {
    couriers: await prisma.courier.count(),
    users: await prisma.user.count(),
    warehouses: await prisma.warehouse.count(),
    orders: await prisma.order.count(),
    shipments: await prisma.shipment.count(),
    openRedFlags: await prisma.redFlag.count({ where: { resolvedAt: null } }),
  };
  console.log('Seeded', counts);
}

/**
 * Books ~40 orders over the last 6 days through the real booking engine, then
 * runs the real pickup and tracking rules hour by hour up to now. Everything
 * on screen (missed pickups, stuck parcels, returns) comes from those rules.
 */
async function demoHistory(brandId: string) {
  const brands = new BrandService(prisma);
  const couriers = new CouriersService();
  const shipments = new ShipmentsService(prisma, couriers, brands);
  const pickups = new PickupsService(prisma, couriers, brands);
  const tracking = new TrackingService(prisma, couriers, brands);

  const products: Array<[string, string, number]> = [
    ['AccessHer', 'Gold-plated bangles set', 699],
    ['AccessHer', 'Pearl earrings', 499],
    ['AccessHer', 'Necklace set', 1899],
    ['AccessHim', 'Steel bracelet', 899],
    ['Hungama HiLife', 'G1 smartwatch', 1099],
    ['Hungama HiLife', 'Bounce earbuds', 1299],
    ['Hungama HiLife', 'Groove speaker', 1799],
    ['Kasrat', 'Hex dumbbell pair', 2224],
    ['Kasrat', 'Resistance bands', 749],
    ['Luxura Sciences', 'Argan hair oil', 549],
    ['Luxura Sciences', 'Vitamin C serum', 999],
    ['Bagssy', 'Tote handbag', 1299],
    ['Drape N Don', 'Cotton kurta set', 1499],
    ['Swarg Homes', 'Cushion covers (5)', 899],
  ];
  const places: Array<[string, string, string, string]> = [
    ['Kavya T.', '682024', 'Kochi', 'Kerala'],
    ['Imran A.', '500081', 'Hyderabad', 'Telangana'],
    ['Rohit G.', '781006', 'Guwahati', 'Assam'],
    ['Ritu D.', '700091', 'Kolkata', 'West Bengal'],
    ['Kavita R.', '302017', 'Jaipur', 'Rajasthan'],
    ['Hetal P.', '380015', 'Ahmedabad', 'Gujarat'],
    ['Priya N.', '411014', 'Pune', 'Maharashtra'],
    ['Sahil K.', '400097', 'Mumbai', 'Maharashtra'],
    ['Farhan Q.', '226010', 'Lucknow', 'Uttar Pradesh'],
    ['Meera I.', '395007', 'Surat', 'Gujarat'],
    ['Anjali B.', '110092', 'New Delhi', 'Delhi'],
    ['Vikram S.', '560076', 'Bengaluru', 'Karnataka'],
    ['Pooja L.', '600040', 'Chennai', 'Tamil Nadu'],
    ['Nikhil J.', '452010', 'Indore', 'Madhya Pradesh'],
    ['Sneha W.', '751024', 'Bhubaneswar', 'Odisha'],
    ['Aman T.', '160022', 'Chandigarh', 'Chandigarh'],
  ];

  const pickupWarehouses = await prisma.warehouse.findMany({ where: { brandId }, orderBy: { code: 'asc' } });
  const now = new Date();
  const bookings: Array<{ at: Date; row: Parameters<ShipmentsService['book']>[0] }> = [];
  let n = 0;
  for (let day = -6; day <= 0; day++) {
    for (let k = 0; k < 6; k++) {
      const at = istAt(now, 9, day);
      at.setTime(at.getTime() + (k * 50 + ((n * 37) % 45)) * 60 * 1000);
      if (at.getTime() > now.getTime() - 10 * 60 * 1000) continue;
      const [productBrand, productName, value] = products[n % products.length];
      const [customerName, pincode, city, state] = places[(n * 5) % places.length];
      const cod = n % 5 !== 0 && n % 3 !== 0;
      const orderNumber = String(19000 + n);
      bookings.push({
        at,
        row: {
          orderNumber,
          productBrand,
          productName,
          customerName,
          customerPhone: `9${String(800000000 + n * 1234567).slice(0, 9)}`,
          addressLine: `Flat ${10 + n}, Sector ${n % 20}, ${city}`,
          city,
          state,
          pincode,
          warehouseCode: pickupWarehouses[n % pickupWarehouses.length].code,
          paymentMode: cod ? 'COD' : 'PREPAID',
          orderValue: value,
          // D2C Mall asks for an advance on every COD order (Rs 49 / Rs 99).
          codAdvance: cod ? codAdvanceFor(value) : 0,
          weightGrams: 300 + ((n * 173) % 2200),
          lengthCm: 20 + (n % 3) * 5,
          breadthCm: 15,
          heightCm: 8 + (n % 4) * 2,
          // Every fifth order goes to the cheapest courier, as teams often do,
          // so the pickup rules have something to catch.
          courierCode: n % 5 === 4 ? 'XPRESSBEES' : undefined,
          idempotencyKey: `demo-${orderNumber}`,
        },
      });
      n++;
    }
  }

  const HOUR = 60 * 60 * 1000;
  let t = bookings[0].at.getTime();
  let i = 0;
  while (t <= now.getTime()) {
    const at = new Date(t);
    for (; i < bookings.length && bookings[i].at.getTime() <= t; i++) {
      try {
        await shipments.book(bookings[i].row, bookings[i].at);
      } catch (e) {
        console.warn(`Skipped demo order ${bookings[i].row.orderNumber}: ${(e as Error).message}`);
      }
    }
    await pickups.run(at);
    await tracking.sync(at);
    t += HOUR;
  }
  await pickups.run(now);
  await tracking.sync(now);
  console.log(`Demo history: ${bookings.length} orders booked over the last 6 days (brand ${brandId})`);
}

async function upsertUser(
  brandId: string,
  name: string,
  phone: string,
  role: 'ADMIN' | 'OPS' | 'SUPPORT' | 'FINANCE',
  managerId?: string,
) {
  return prisma.user.upsert({
    where: { brandId_phone: { brandId, phone } },
    update: {},
    create: { brandId, name, phone, role, managerId },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
