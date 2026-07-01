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

**Backend** — Node.js, Express, Prisma ORM (PostgreSQL), JWT auth, Socket.io, bcrypt
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

The entire stack is containerized (PostgreSQL + backend API + nginx frontend). With Docker Desktop running:

```bash
# (optional) copy env defaults and adjust secrets / DB credentials
cp .env.example .env

# build and start db + backend + frontend
docker compose up --build
```

The `db` service is `postgres:16-alpine`. The backend waits for it to become healthy (compose `depends_on: condition: service_healthy`) before applying the Prisma schema.

Then open **http://localhost:8080** and log in with `admin@pulseservice.com` / `admin123`.

- Frontend (nginx) is served on `http://localhost:8080` and proxies `/api` and `/socket.io` to the backend container.
- Backend API is also exposed directly on `http://localhost:3000` (container `PORT=3000`; see `docker-compose.yml`).
- On first boot the backend automatically applies the Prisma schema (`prisma db push`) and seeds demo data. Postgres data is persisted in the `postgres-data` Docker volume; seeding is idempotent (it checks the database for existing users via `prisma/seed-check.js`), so it only runs on an empty database.
- The Postgres instance is also exposed on `localhost:5432` (user/password/db default to `pulseservice`).

Useful commands:

```bash
docker compose up --build -d     # run detached
docker compose logs -f backend   # follow backend logs
docker compose down              # stop containers
docker compose down -v           # stop and wipe the database volume (re-seeds next start)
```

## Getting Started (local, without Docker)

### 1. Backend

Requires a running PostgreSQL instance. Set `DATABASE_URL` in `backend/.env`, e.g.
`postgresql://pulseservice:pulseservice@localhost:5432/pulseservice?schema=public`
(the quickest option is `docker compose up -d db`).

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

## DB-driven metadata (single source of truth for enums)

Every enumerated value (statuses, types, roles, priorities, payment methods, ...) is defined once in `backend/src/constants/lookups.js`, seeded into the `Lookup` table, and served to the frontend from the database via `GET /api/v1/metadata`. Each entry carries its `value`, display `label`, and (where relevant) a `color` for status badges.

The frontend consumes this through the `useMetadata` / `useLookup` hooks and the shared `LookupSelect` and `StatusBadge` components — so dropdown options, labels, and badge colors are never hardcoded in the UI.

**Write-path enforcement:** create/update routes validate incoming enum fields (status, type, priority, discountType, payment method, customer type, ...) against the `Lookup` table via `validateLookups` middleware (`src/middleware/validateLookups.middleware.js`) backed by a cached `lookups.service.js`. Invalid values are rejected with a `400`, so the database is the source of truth on writes as well as reads.

To add or change an enum value, edit `lookups.js` and re-seed (`npm run db:seed`, or `docker compose down -v` for a fresh start).

## Linting

Both packages ship a strict ESLint flat config:

```bash
# backend (eslint:recommended + strict rules, CommonJS)
cd backend && npm run lint

# frontend (typescript-eslint strict-type-checked + react-hooks)
cd frontend && npm run lint
```

Use `npm run lint:fix` to auto-fix what's mechanically fixable.

## API

All endpoints are namespaced under `/api/v1` and require a `Bearer` JWT except `POST /auth/login`. Key route groups: `auth`, `users`, `roles`, `customers`, `jobs`, `dispatch`, `estimates`, `invoices`, `payments`, `technicians`, `pricebook`, `inventory`, `agreements`, `reports`, `settings`, `notifications`, `calls`, `campaigns`.

## Authorization (roles & permissions)

Every user has one `role` (see the `userRole` lookup: `admin`, `exec`, `manager`, `dispatcher`, `csr`, `technician`). Roles map to fine-grained **permission keys** (e.g. `invoices.void`, `reports.financial`) via the `RolePermission` table. Defaults live in `backend/src/constants/permissions.js` and are seeded on first boot; an admin can re-map any role's permissions at runtime from **Settings → Roles & Permissions** (`PUT /roles/:role/permissions`). The `admin` role always retains every permission.

Read endpoints are generally open to any authenticated user; **write / sensitive / financial actions are gated** by the `requirePermission(...)` middleware (`src/middleware/permission.middleware.js`), backed by a cached `permissions.service.js`. A user's effective permissions are returned on `POST /auth/login` and `GET /auth/me`, and the React app consumes them through the `usePermissions` hook / `<Can>` component to hide actions the user can't perform. User administration (`/users`) and role administration (`/roles`) require the `users.manage` permission.

After changing default permission sets in `permissions.js`, re-seed (`npm run db:seed`, or `docker compose down -v` for a fresh start) to apply them.

## Notes

- Document numbers (jobs, invoices, estimates, customers) auto-increment from values stored in `CompanySettings`.
- Dispatch changes and job updates emit Socket.io events for live board updates.
- This is a foundation covering the core ServiceTitan feature set; integrations like Stripe payment processing, QuickBooks sync, SMS/email delivery, and a technician mobile app are stubbed/structured for future build-out.
