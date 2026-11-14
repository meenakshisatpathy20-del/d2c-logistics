/**
 * Demo data for local development and demos.
 * Warehouse names and pin codes mirror our real vendor pickup points;
 * contact names and phone numbers are placeholders.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { DEMO_COURIERS } from '../src/couriers/demo/profiles.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

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
      create: { code: c.code, name: c.name, mode: 'DEMO', isBackup: c.code === 'XPRESSBEES' },
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

  const pickupWarehouses = await prisma.warehouse.findMany({ where: { brandId: brand.id } });
  const customers = [
    ['Bhawana J.', '401107', 'Mumbai', 'Maharashtra', 'COD', 360],
    ['Divya M.', '603112', 'Chennai', 'Tamil Nadu', 'COD', 614],
    ['Sahil K.', '400097', 'Mumbai', 'Maharashtra', 'PREPAID', 2224],
    ['Sana R.', '201307', 'Noida', 'Uttar Pradesh', 'PREPAID', 2224],
    ['Arjun P.', '560034', 'Bengaluru', 'Karnataka', 'COD', 899],
    ['Neha S.', '110017', 'New Delhi', 'Delhi', 'PREPAID', 1499],
    ['Rohit G.', '781006', 'Guwahati', 'Assam', 'COD', 749],
    ['Priya N.', '411014', 'Pune', 'Maharashtra', 'PREPAID', 1299],
    ['Imran A.', '500081', 'Hyderabad', 'Telangana', 'COD', 1099],
    ['Kavya T.', '682024', 'Kochi', 'Kerala', 'PREPAID', 549],
    ['Manish V.', '302017', 'Jaipur', 'Rajasthan', 'COD', 1899],
    ['Ritu D.', '700091', 'Kolkata', 'West Bengal', 'PREPAID', 999],
  ] as const;

  for (const [i, [name, pincode, city, state, paymentMode, value]] of customers.entries()) {
    const orderNumber = String(18900 + i);
    await prisma.order.upsert({
      where: { brandId_orderNumber: { brandId: brand.id, orderNumber } },
      update: {},
      create: {
        brandId: brand.id,
        orderNumber,
        source: 'OMS_GURU',
        pickupWarehouseId: pickupWarehouses[i % pickupWarehouses.length].id,
        customerName: name,
        customerPhone: `91000000${String(i + 10)}`,
        addressLine: 'Demo address',
        city,
        state,
        pincode,
        paymentMode,
        orderValue: value,
        codAmount: paymentMode === 'COD' ? value : 0,
        weightGrams: 400 + i * 150,
        lengthCm: 20,
        breadthCm: 15,
        heightCm: 8,
        items: [{ name: 'Accessories set', sku: `SKU-${orderNumber}`, qty: 1, price: value }],
      },
    });
  }

  const counts = {
    couriers: await prisma.courier.count(),
    users: await prisma.user.count(),
    warehouses: await prisma.warehouse.count(),
    orders: await prisma.order.count(),
  };
  console.log('Seeded', counts);
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
