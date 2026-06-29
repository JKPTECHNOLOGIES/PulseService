# PulseService

A full-featured field service management platform — an open ServiceTitan-style system for commercial and residential trades (HVAC, plumbing, electrical, and more).

PulseService gives contracting businesses everything they need to run operations end to end: CRM, job management, a drag-and-drop dispatch board, estimates and proposals, invoicing and payments, a pricebook, inventory, service agreements, marketing/call tracking, and reporting.

## Feature Overview

| Module | What it does |
| --- | --- |
| **Dashboard** | KPI stat cards, 12-month revenue chart, recent jobs & invoices, quick actions |
| **CRM / Customers** | Residential & commercial customers, contacts, multiple service/billing locations, balances, history |
| **Jobs / Work Orders** | Full job lifecycle (new → scheduled → dispatched → in progress → completed/cancelled), technician assignment, notes, timeline |
| **Dispatch Board** | Drag-and-drop scheduling by technician across a time grid, unassigned job queue, real-time updates via Socket.io |
| **Estimates / Proposals** | Line-item quotes, discounts, tax, send/approve/reject, convert to invoice |
| **Invoicing & Payments** | Invoice generation, balances, payment recording (cash/check/card/ACH), void |
| **Technicians** | Skills, availability, employee records, schedule, location |
| **Pricebook** | Service/part/material catalog organized by category |
| **Inventory** | Warehouse stock, reorder points, low-stock alerts, adjustments & transactions |
| **Service Agreements** | Recurring maintenance contracts, billing frequency, scheduled visits |
| **Marketing** | Campaign tracking and inbound/outbound call logging |
| **Reports** | Revenue, job metrics, technician performance, customer lifetime value |
| **Settings** | Company profile, billing/tax config, business units, users & roles |

## Tech Stack

**Backend** — Node.js, Express, Prisma ORM (SQLite by default), JWT auth, Socket.io, bcrypt
**Frontend** — React 18 + TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, React Hook Form + Zod, Recharts, dnd-kit, Headless UI, Heroicons

## Project Structure

```
PulseService/
├── backend/            # Express + Prisma REST API (port 5000)
│   ├── prisma/         # schema.prisma + seed.js
│   └── src/
│       ├── config/     # Prisma client, Socket.io
│       ├── controllers/# Business logic (16 controllers)
│       ├── middleware/ # auth + role guards
│       ├── routes/     # /api/v1/* endpoints
│       └── utils/      # helpers (numbering, totals, pagination)
└── frontend/           # React + Vite SPA (port 3000)
    └── src/
        ├── components/ # layout + reusable UI + domain components
        ├── hooks/      # TanStack Query hooks per module
        ├── pages/      # 23 routed pages
        ├── store/      # Zustand auth/UI state
        ├── lib/        # axios client, query keys
        ├── types/      # shared TS interfaces
        └── utils/      # formatters
```

## Running with Docker (recommended)

The entire stack is containerized. With Docker Desktop running:

```bash
# (optional) copy env defaults and adjust secrets
cp .env.example .env

# build and start backend + frontend
docker compose up --build
```

Then open **http://localhost:8080** and log in with `admin@pulseservice.com` / `admin123`.

- Frontend (nginx) is served on `http://localhost:8080` and proxies `/api` and `/socket.io` to the backend container.
- Backend API is also exposed directly on `http://localhost:5000`.
- On first boot the backend automatically applies the Prisma schema and seeds demo data. The SQLite database is persisted in the `backend-data` Docker volume, so seeding only runs once.

Useful commands:

```bash
docker compose up --build -d     # run detached
docker compose logs -f backend   # follow backend logs
docker compose down              # stop containers
docker compose down -v           # stop and wipe the database volume (re-seeds next start)
```

## Getting Started (local, without Docker)

### 1. Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
node prisma/seed.js
npm run dev
```

The API starts on `http://localhost:5000` (base path `/api/v1`).

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The app starts on `http://localhost:3000` and proxies `/api` to the backend.

### 3. Log in

Open `http://localhost:3000` and sign in with the seeded admin account:

- **Email:** `admin@pulseservice.com`
- **Password:** `admin123`

Other seeded accounts (password `pass123`): `dispatcher@pulseservice.com`, `tech1@pulseservice.com`, `tech2@pulseservice.com`, `tech3@pulseservice.com`, `csr@pulseservice.com`.

## Switching to PostgreSQL

SQLite is used for zero-config local development. To use PostgreSQL in production:

1. In `backend/prisma/schema.prisma`, change the datasource `provider` to `"postgresql"`.
2. Set `DATABASE_URL` in `backend/.env` to your Postgres connection string.
3. Run `npx prisma db push` (or generate a migration) and re-seed.

## API

All endpoints are namespaced under `/api/v1` and require a `Bearer` JWT except `POST /auth/login`. Key route groups: `auth`, `customers`, `jobs`, `dispatch`, `estimates`, `invoices`, `payments`, `technicians`, `pricebook`, `inventory`, `agreements`, `reports`, `settings`, `notifications`, `calls`, `campaigns`.

## Notes

- Document numbers (jobs, invoices, estimates, customers) auto-increment from values stored in `CompanySettings`.
- Dispatch changes and job updates emit Socket.io events for live board updates.
- This is a foundation covering the core ServiceTitan feature set; integrations like Stripe payment processing, QuickBooks sync, SMS/email delivery, and a technician mobile app are stubbed/structured for future build-out.
