# PulseService — Technical Documentation

A full-featured field‑service management platform (ServiceTitan‑style) for trades
(HVAC, plumbing, electrical). This document describes the architecture, data
model, conventions, and how everything fits together.

> For deployment/handoff/workflow specifics see **[`HANDOFF.md`](./HANDOFF.md)**.

---

## 1. Tech stack

**Backend** — Node.js, Express, Prisma ORM, **PostgreSQL**, JWT auth, Socket.io,
bcrypt, role‑based permissions.

**Frontend** — React 18 + TypeScript, Vite, Tailwind CSS (CSS‑variable theming +
dark mode), TanStack Query (with offline persistence), React Router (lazy
routes), React Hook Form + Zod, Recharts, dnd‑kit, Headless UI, Heroicons,
react‑hot‑toast. PWA (service worker + push).

**Infra** — Docker Compose: `db` (postgres:16‑alpine) + `backend` + `frontend`
(nginx serving the built SPA and proxying `/api` + `/socket.io`).

**Tooling** — Strict ESLint (flat config) on both packages; Vitest for tests.

---

## 2. Repository layout

```
PulseService/
├── docker-compose.yml         # db + backend + frontend
├── .env.example               # env template (Postgres creds, JWT, URLs)
├── samples/                   # example import files (e.g. inventory CSV)
├── docs/                      # this documentation
├── backend/
│   ├── Dockerfile
│   ├── docker-entrypoint.sh   # db push -> sync lookups -> seed once -> start
│   ├── eslint.config.js
│   └── prisma/
│   │   ├── schema.prisma      # 50 models
│   │   ├── seed.js            # demo data (runs once, on empty DB)
│   │   ├── seed-check.js      # idempotent seed guard (checks for users)
│   │   └── sync-lookups.js    # upserts/prunes Lookup rows on EVERY start
│   └── src/
│       ├── app.js             # express app, route registration, socket.io
│       ├── config/            # prisma client, socket
│       ├── constants/         # lookups.js (enum single source of truth), permissions
│       ├── controllers/       # business logic per domain
│       ├── middleware/        # auth, role/permission, validateLookups
│       ├── routes/            # /api/v1/* endpoints
│       ├── services/          # lookups cache, inventory money helpers, etc.
│       └── utils/             # helpers (numbering, pagination, csvToArray, totals)
└── frontend/
    ├── Dockerfile             # multi-stage: vite build -> nginx
    ├── nginx.conf             # SPA + /api & /socket.io proxy + cache headers
    ├── tailwind.config.js     # CSS-var palette, dark mode, safelist
    ├── vitest.config.ts
    └── src/
        ├── App.tsx            # lazy-loaded routes
        ├── main.tsx           # providers, error boundary, vite:preloadError reload
        ├── components/        # layout + ui (shared) + domain widgets
        ├── hooks/             # one module per domain (TanStack Query)
        ├── lib/               # typed axios client, errors, queryKeys, queryClient
        ├── pages/             # 37 routed pages
        ├── store/             # zustand (auth, ui)
        ├── types/             # shared TS interfaces
        └── utils/             # formatters, csv import/export
```

---

## 3. Running & deployment

### Docker (the way it runs in shared/prod)
```bash
cp .env.example .env            # optional; sensible defaults exist
docker compose up --build -d
```
- Frontend (nginx): **http://localhost:8080** (or the host's LAN IP).
- Backend API: **http://localhost:3000** (`/api/v1`), also reachable through the
  frontend at `/api` (nginx proxies to `backend:3000`).
- Postgres: `localhost:5432` (user/pass/db default `pulseservice`).

### Backend start sequence (`docker-entrypoint.sh`)
1. `prisma db push` — applies the schema (no migration files; push‑based).
2. `node prisma/sync-lookups.js` — **upserts + prunes** the `Lookup` table from
   `src/constants/lookups.js` **on every start** (so new enum options appear
   after a normal rebuild — no reseed needed).
3. Seed **once** if the DB is empty (guarded by `seed-check.js`, which checks for
   any `User`). A fresh volume (`docker compose down -v`) re-seeds.
4. `node src/app.js`.

### When a full reseed (`down -v`) is required
Only when you need **seed rows** that only load on an empty DB (demo customers,
jobs, sample equipment/calls, etc.). Enum/lookup changes do **not** need it
(handled by `sync-lookups.js`).

---

## 4. Backend architecture

- **Layering:** `routes/*` (define endpoints + middleware) → `controllers/*`
  (business logic) → Prisma. Cross‑cutting helpers live in `services/*`,
  `utils/*`, `constants/*`.
- **Auth:** JWT bearer. `middleware/auth.middleware.js` verifies the token and
  attaches `req.user`. All routes except `POST /auth/login` (and some `/public/*`)
  require auth.
- **RBAC:** `middleware/permission.middleware.js` exposes
  `requirePermission(...perms)`; permissions are defined in
  `constants/permissions*` and stored per‑role in the `RolePermission` model.
  Sensitive routes (e.g. `inventory.manage`, `inventory.issueToJob`,
  `invoices.void`) are gated. The frontend mirrors this with a `<Can>` component.
- **Response envelope:** JSON `{ success: true, data }` or paginated
  `{ success: true, data: [...], pagination: {...} }`; errors
  `{ success: false, error }`. Helpers in `utils/helpers.js`
  (`paginate`, `paginatedResponse`, `generateNumber`, `calculateTotals`).
- **Realtime:** Socket.io broadcasts dispatch/job changes to `dispatch:<date>`
  rooms.
- **Audit:** `AuditLog` model + `/audit` routes record sensitive actions.

### Search / Postgres note
Text filters use Prisma `contains` **with `mode: "insensitive"`** (Postgres is
case‑sensitive by default — this was fixed during the SQLite→Postgres migration).

---

## 5. Database

- **PostgreSQL** via Prisma. Schema managed with `prisma db push` (no migration
  history committed; `prisma/migrations` is git‑ignored).
- **50 models.** Grouped by domain:

| Domain | Models |
| --- | --- |
| CRM | User, Customer, Contact, Location, CustomerMessage, Campaign, Call |
| Work | Job, JobTechnician, JobForm, TimeEntry, RecurringJob, Equipment |
| Field ops | Technician, Vehicle, Zone |
| Sales | Estimate, EstimateLineItem, Invoice, InvoiceLineItem, Payment |
| Pricing | PricebookCategory, PricebookItem, PricingTier, PricingTierOverride |
| Inventory | Vendor, StockLocation, InventoryItem, InventoryStock, InventoryItemVendor, InventoryItemCostHistory, InventoryTransaction, SerializedUnit |
| Purchasing | PurchaseOrder, POLine, POLineReceipt |
| Agreements | ServiceAgreement, AgreementVisit |
| Accounting sync | QuickBooksSettings, QuickBooksMapping, QuickBooksItemMapping, QuickBooksSyncQueue |
| Platform | CompanySettings, BusinessUnit, Notification, Attachment, PushSubscription, RolePermission, AuditLog, **Lookup** |

- Document numbers (jobs, invoices, estimates, customers, vendors, POs)
  auto‑increment from counters in `CompanySettings`.

---

## 6. DB‑driven enums (single source of truth) ⭐

This is a core architectural pattern — **no enum value, label, or badge color is
hardcoded**; everything flows from one place.

1. **Definition:** `backend/src/constants/lookups.js` defines every enumerated
   set (statuses, types, roles, priorities, payment methods, PO statuses,
   serialized‑unit statuses, equipment type/condition, …). Each entry:
   `{ value, label, color? }` (color = Tailwind badge classes).
2. **DB:** synced into the `Lookup` table (`@@unique([category, value])`) by
   `prisma/sync-lookups.js` on every backend start (**upsert + prune**), so the
   DB always mirrors the constants.
3. **API:** `GET /api/v1/metadata` returns all lookups grouped by category;
   `GET /api/v1/metadata/:category` returns one.
4. **Write validation:** `middleware/validateLookups.middleware.js` (backed by a
   cached `services/lookups.service.js`) rejects invalid enum values on
   create/update (`400`). The DB is the source of truth on writes too.
5. **Frontend:** `hooks/useMetadata.ts` → `useMetadata()` / `useLookup(category)`
   (`.options`, `.getLabel(value)`, `.getColor(value)`). Consumed by the shared
   `<LookupSelect>` (dropdowns) and `<StatusBadge>` (colored pills). Dispatch job
   cards derive their solid color from the status badge color.

**~39 lookup categories** currently exist (jobStatus, jobPriority, jobType,
estimateStatus, invoiceStatus, paymentMethod/Status, userRole, customerType,
lineItemType, discountType, agreement*, campaign*, call*, inventoryTransactionType,
stockLocationType, po*, serializedUnitStatus, costChangeSource, pricebookItemType,
notificationType, equipmentType, equipmentCondition, businessUnitType, message*,
pricingOverrideType, quickbooks*).

> **To add/change an enum:** edit `lookups.js` → it appears after the next backend
> rebuild (no reseed). `equipmentType` is intentionally **free‑text** in the UI
> (suggestions come from the lookup, but any value is allowed; its write
> validation is disabled).

---

## 7. API surface (route groups)

All under `/api/v1`. 35 groups:

`auth`, `users`, `roles`, `audit`, `metadata`, `customers`, `jobs`, `dispatch`,
`estimates`, `invoices`, `technicians`, `pricebook`, `inventory`,
`stock-locations`, `vendors`, `purchasing`, `serials`, `equipment`,
`agreements`, `reports`, `settings`, `notifications`, `calls`, `campaigns`,
`payments`, `search`, `attachments`, `public`, `time`, `push`, `recurring`,
`geocode`, `quickbooks`, `pricing-tiers`, `messages`.

Notable endpoints added recently:
- `POST /dispatch/reassign` — single‑technician assignment (clears existing, then
  assigns; empty = unassign).
- `POST /jobs/:id` reschedule via `PUT`; `DELETE /jobs/:id` (transactionally
  detaches invoices/estimates/equipment/time, removes assignments/forms).
- `POST /serials/:id/install` and `POST /serials/:id/uninstall`.
- `POST /inventory/items/import` — CSV bulk import (see `samples/`).
- `GET/POST/PUT/DELETE /equipment` — customer asset tracking.

---

## 8. Frontend architecture

- **Routing:** `App.tsx` uses `lazy(() => import(...))` per page under
  `AppLayout`. `main.tsx` listens for Vite's `vite:preloadError` and reloads once
  (time‑guarded) so stale code‑split chunks after a redeploy auto‑recover instead
  of showing the error boundary.
- **Data:** TanStack Query with offline persistence (`lib/queryClient`); one hook
  module per domain in `hooks/` (`useJobs`, `useInvoices`, `useEquipment`, …).
- **Typed API client:** `lib/api.ts` wraps axios; `api.get<T>/post<T>/…` resolve
  to the parsed body typed as `T`. `lib/errors.ts` `getErrorMessage(err)` is used
  in every mutation `onError`. This is the single place casts live — hooks/pages
  avoid `any`.
- **Forms:** React Hook Form + Zod. Enum fields validate as `z.string()` (values
  are DB‑validated server‑side, not hardcoded in the schema).
- **Theming:** Tailwind palette resolves to CSS variables that invert under a
  `.dark` class (see `useTheme`); `oncolor` is a fixed white for text/icons on
  colored surfaces.
- **PWA/offline:** service worker + push (`usePush`); offline mutation queue
  replays on reconnect.

### Key shared components (`components/ui`)
- **`NumberInput`** — `type=number` that can actually be cleared (keeps a raw
  string buffer; emits `number | null`). Use this instead of raw controlled
  number inputs, which snap back to `0`.
- **`LookupSelect`** — DB‑driven `<select>` for a lookup category (works with RHF
  `register`).
- **`Badge` / `StatusBadge`** — DB‑driven colored status pills.
- **`ImportModal`** — generic CSV importer (template download + preview +
  per‑row error report); configured with `endpoint` + `templateColumns`.
- **`ConfirmDialog`, `Modal`, `DataTable`, `Pagination`, `SearchInput`,
  `EmptyState`, `Spinner`, `Can`, `AttachmentGallery`, `SignatureCard`,
  `BarcodeScanner`, `LineItemsTable`.**

---

## 9. Conventions

- **Strict ESLint** on both packages (`npm run lint`); frontend also type‑checks
  via `tsc` in the build. Keep both green.
- **DB‑driven enums** — never hardcode status/type/role strings or colors; add to
  `lookups.js`.
- **Clickable table rows** navigate to detail; row action buttons call
  `e.stopPropagation()`.
- **Line endings:** repo works on Windows; git shows "LF will be replaced by
  CRLF" warnings — harmless.
- **Money:** stored/handled via helpers; avoid floating‑point surprises with the
  `money()` service helper on the backend.

---

## 10. Features (by module)

Dashboard/KPIs · My Day (tech daily view) · CRM (customers, contacts, locations,
messages, calls) · Jobs (lifecycle, timeline stepper, parts/serialized units,
attachments, signatures, time tracking) · Dispatch board (drag to reassign
tech + drag to reschedule time, single‑tech assignment, status‑colored cards,
create/delete) · Estimates & Invoices (line items, discounts, tax, send/approve,
payments, public estimate page) · Pricebook + Pricing tiers/overrides ·
Inventory (multi‑location stock, cycle count, transactions, CSV import, barcode
scan) · Vendors & Purchasing (POs, receipts) · Serialized units (install/
uninstall, per‑unit history) · Equipment/asset tracking (serial, warranty,
service history) · Service agreements & recurring jobs · Marketing (campaigns +
call logging) · Reports · Notifications (bell → dedicated page) · Settings
(company, business units, users & roles/permissions, tax) · QuickBooks sync
(structured) · Maps/geocode · Dark mode · PWA/offline.

---

## 11. Testing

Vitest is configured on the frontend (`vitest.config.ts`, `src/test/setup.ts`)
with `@testing-library`. Some backend logic has plain test files (e.g.
`permissions.test.js`). Run frontend tests with `npm test` (or `npx vitest`) in
`frontend/`.

---

## 12. Known caveats / watch‑outs

- **Two machines:** the AI/dev machine is `10.4.4.52`; the shared running
  environment is **`10.4.4.23:8080`** (a different host). Code reaches `.23` only
  via **GitHub pull + rebuild on that host** — there is no direct deploy.
- **Stale chunks:** after a rebuild, an already‑open tab may fail to fetch an old
  lazy chunk. Handled by the `vite:preloadError` auto‑reload + nginx `no‑cache`
  on `index.html`. A hard refresh (Ctrl+Shift+R) always fixes it.
- **Service worker:** the PWA SW caches assets; if a stale build persists after a
  rebuild + hard refresh, unregister the SW (DevTools → Application) once.
- **Seed vs sync:** demo/seed rows only load on an empty DB; lookups sync every
  start. Don't `down -v` on the shared host unless losing entered data is OK.
