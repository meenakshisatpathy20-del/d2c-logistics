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

### Sign-in

Team members sign in with work email + password, then a 6-digit code. Until email
delivery is connected (`OTP_DELIVERY=demo`, the default) the code is shown on screen.
Demo logins: `founder@d2c.demo`, `ops.manager@d2c.demo`, `ops@d2c.demo`,
`support@d2c.demo`, `finance@d2c.demo`, password `D2C@demo2026` (or `DEMO_PASSWORD`).
On Render set `SESSION_SECRET` (any long random text), `REQUIRE_SESSION_SECRET=true`
and `COOKIE_SECURE=true`, and set `DEMO_PASSWORD` to a private value before the first deploy.
Everyone can change their password in Settings; an admin can reset a forgotten one.

### Alerts, vendors and messages

- Every problem goes to its owner (app bell + WhatsApp). Past its deadline it
  climbs: manager → courier account manager (email) → founder.
- 9 pm daily summary to admins; 9 am pickup list to each vendor.
- Vendor partners sign in at `/v` with their mobile number + one-time code and
  see only their own warehouse (demo vendors: `9800000010`–`9800000014`).
- Until WhatsApp (Meta), SMS (DLT) and email accounts are approved
  (`MESSAGING_MODE=DEMO`, the default), messages are kept in **Messages**
  marked Demo instead of being sent. Links in messages use `PUBLIC_URL`
  (Render's own address is used if it is not set).

### Payment check (no order ships on a "payment done")

- A prepaid order, or the advance on a COD order, books only when the payment
  records show the money in **our own account** and **not refunded**. Otherwise
  it waits in Orders with a payment issue, and the customer is told (SMS, demo
  until approved).
- Money comes in from the gateway webhook (`POST /api/payments/events`, header
  `x-payment-token` = `PAYMENT_WEBHOOK_TOKEN`) or the day's gateway / bank / UPI
  statement (Payments → Import). A held order that is now paid books by itself.
- A refund before pickup cancels the booking; after pickup it raises an urgent
  issue to get the parcel back or the money in.
- Payments → "Customer says I paid": checks a screenshot (read by Claude when
  `ANTHROPIC_API_KEY` is set) or a UTR against our records. A payment into any
  account not listed under **Our accounts** is a wrong-QR payment.
- `PAYMENT_GUARD=off` turns the check off (emergencies only; the tests use it).

### Chat triage (courier WhatsApp groups)

- Chat triage: paste a courier group's chat or upload its WhatsApp export. Every
  AWB is found, asks become cases waiting on the courier, "aligned for tomorrow"
  or "by 4 pm" becomes a promise the chaser holds them to, "warehouse closed" is
  checked against vendor hours, money and "business on hold" open their own
  cases. AWBs still booked outside EcomNext are listed on the courier's case.
- The same chat pasted twice is never filed twice. Every message read is kept in
  the Resolve Hub ledger.
- Live groups: a WhatsApp/Telegram bridge posts each message to
  `POST /api/agent/group-message` (header `x-agent-token` = `AGENT_INBOUND_TOKEN`).

### Free plan sleep

The free plan sleeps after 15 idle minutes, which pauses the pickup and tracking
rules. They catch up as soon as the service wakes (they run once at start-up).
To keep it awake, point a free uptime monitor (e.g. UptimeRobot) at
`/api/health` every 10 minutes, or move to a paid instance.

## Checks

```bash
cd apps/api && pnpm lint && pnpm test && pnpm test:e2e && pnpm build
cd apps/web && pnpm lint && pnpm build
```

The same checks run automatically on every push (`.github/workflows/ci.yml`).
