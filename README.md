# D2C Logistics

Shipping platform for D2C Ecommerce India: book, ship, track and manage every order from one place, across every courier, with an owner on every step and red flags raised automatically.

## What is here

| Path | What it is |
| --- | --- |
| `apps/web` | Website (Next.js + TypeScript + Tailwind). Login, Control Tower, Orders, Book Shipment |
| `apps/api` | Backend API (NestJS + TypeScript), database layer (Prisma + PostgreSQL) |
| `apps/api/prisma/schema.prisma` | Data model: brands, users, warehouses, couriers, orders, shipments, tracking, pickups, tasks, red flags, messages, audit log |
| `apps/api/src/couriers` | Courier engine. Every courier sits behind one interface; all 8 run in demo mode today |

## Couriers

Delhivery, Ekart, Shadowfax, Blue Dart, Xpressbees, Amazon Shipping, Blitz and Pikndel run in **demo mode**: realistic rates, AWB numbers and tracking, with no outside calls. Demo rates are illustrative, not real contracted rates. Switching a courier to live replaces its adapter; nothing else changes.

## Run locally

```bash
pnpm install
pnpm db:up                      # PostgreSQL + Redis in Docker
cd apps/api && pnpm exec prisma migrate dev && pnpm exec prisma db seed
pnpm start:dev                  # API on http://localhost:4000
cd ../web && pnpm dev           # Website on http://localhost:3000
```

Copy `apps/api/.env.example` to `apps/api/.env` first.

## Checks

```bash
cd apps/api && pnpm lint && pnpm test && pnpm test:e2e && pnpm build
cd apps/web && pnpm lint && pnpm build
```

The same checks run automatically on every push (`.github/workflows/ci.yml`).
