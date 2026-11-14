# D2C Logistics

Shipping platform for D2C Ecommerce India: book, ship, track and manage every order from one place, across every courier, with an owner on every step and red flags raised automatically.

## What is here

| Path | What it is |
| --- | --- |
| `apps/web` | Website (Next.js + TypeScript + Tailwind). Login, Today, Shipments (journey board and table), New shipment panel (one order or bulk CSV) |
| `apps/api` | Backend API (NestJS + TypeScript), database layer (Prisma + PostgreSQL) |
| `apps/api/prisma/schema.prisma` | Data model: brands, users, warehouses, couriers, orders, shipments, tracking, pickups, tasks, red flags, messages, audit log |
| `apps/api/src/couriers` | Courier engine. Every courier sits behind one interface; all 8 run in demo mode today |

## Couriers

Delhivery, Ekart, Shadowfax, Blue Dart, Xpressbees, Amazon Shipping, Blitz and Pikndel run in **demo mode**: realistic rates, AWB numbers and tracking, with no outside calls. The recommended courier is the cheapest one with reliable pickups (85%+ on time). Demo rates are illustrative, not real contracted rates. Switching a courier to live replaces its adapter; nothing else changes.

## Run locally

```bash
pnpm install
pnpm db:up                      # PostgreSQL + Redis in Docker
cd apps/api && pnpm exec prisma migrate dev && pnpm exec prisma db seed
pnpm start:dev                  # API on http://localhost:4000
cd ../web && pnpm dev           # Website on http://localhost:3000
```

Copy `apps/api/.env.example` to `apps/api/.env` first.

## Deploy (Render)

One web service runs both the website and the API: the website forwards `/api/*` to the API.

- Build command: `pnpm install --frozen-lockfile && pnpm run build`
- Start command: `pnpm start` (applies database migrations, loads demo data, starts both apps)
- Environment: `DATABASE_URL` (Render PostgreSQL), `NODE_VERSION=22`, `TZ=Asia/Kolkata`
- Health check: `/api/health`

`render.yaml` sets all of this up in one step (Render → New → Blueprint). Every push to `main` redeploys automatically.

## Checks

```bash
cd apps/api && pnpm lint && pnpm test && pnpm test:e2e && pnpm build
cd apps/web && pnpm lint && pnpm build
```

The same checks run automatically on every push (`.github/workflows/ci.yml`).
