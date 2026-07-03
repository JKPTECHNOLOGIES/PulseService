# PulseService — Adversarial Desktop Review #2

**Reviewed at:** commit `c90bf0d` (2026-07-03)
**Prior review:** `5bdb7bf` (scored 6/10) — see `DESKTOP-REVIEW.md`
**Method:** Re-read the app shell, routing table (`App.tsx`), `Sidebar.tsx` nav,
every list/detail/form page reachable from it — with particular attention to
everything shipped since the last review (multi-location inventory, purchasing,
suppliers, serialized units, pricing tiers, QuickBooks Desktop sync, the
message log, job optimistic concurrency, the map page, recurring jobs) — plus
the socket wiring, permission catalog, and backend route guards. Deliberately
adversarial, including hunting for problems the new work itself introduced.

---

## TL;DR verdict — now ~7/10 (up from 6)

This was a genuinely productive cycle. All three "biggest problems" from round 1
got real, working fixes: estimates/invoices now generate a branded PDF
(`pdfkit`) and actually email it (`nodemailer`, with a safe Ethereal fallback
when SMTP isn't configured), the dispatch board is now **actually real-time**
(`io.to(`dispatch:${date}`).emit(...)` on create/update/status/assign/
delete, consumed by `useDispatchRealtime`), and there's now a QuickBooks
Desktop sync plus a public, HMAC-token-gated estimate-approval page — a real
first slice of a customer portal. Reporting grew from four fixed chart tabs to
AR aging, sales-by-source, and an estimate pipeline. A global `ErrorBoundary`
is wired at the root and per-route. This is meaningfully better software than
round 1.

But the *new* surface area — six new list pages for inventory/purchasing/
supplier/serialized-unit/pricing-tier data — was built to a visibly lower bar
than the surface it sits next to. Four of six new list pages regressed to
plain `<table>` markup with no sort/export, a scoped `inventory.issueToJob`
permission was added for technicians but its read-side counterpart was never
considered (technicians and CSRs can browse full supplier cost data and
purchase-order pricing today), and "bulk actions" — advertised in the
README as a shipped `DataTable` capability — turns out to be wired into
exactly one page, doing one thing (re-export a CSV of rows you already
exported). The invoice side of the "customer portal" gap is also still
completely open: a customer can approve an estimate online but still can't
pay the resulting invoice online anywhere in the app.

**If I had to name the single highest-leverage gap now:** the new
inventory/purchasing data is more sensitive (unit costs, supplier pricing,
margins) than anything the old app exposed, and it inherited the old app's
"every GET is open to any authenticated user, permissions only gate the nav
link" pattern without anyone re-examining whether that's still the right
default. That's a real risk for a company using role separation as a control,
not just a nice-to-have UI gap.

---

## Scorecard vs. `DESKTOP-REVIEW.md`'s original findings

| # | Finding | Status |
| --- | --- | --- |
| D1 | "Send" doesn't send; no PDF/print | ✅ **Fixed** — `pdf.service.js` (pdfkit) renders branded invoice/estimate PDFs; `email.service.js` (nodemailer, real SMTP or Ethereal fallback) actually emails them; `GET /invoices/:id/pdf` + a "PDF" button wired in `InvoiceDetailPage`/estimate detail. Online approval link (`PublicEstimatePage` + `public.routes.js`, HMAC-token gated) also landed — the D1/D10 "seed" item from the roadmap. |
| D2 | Dispatch board not real-time | ✅ **Fixed** — `frontend/src/lib/socket.ts` opens a real connection; `useDispatchRealtime` joins per-date rooms and invalidates on any `dispatch:*`/`job:*` event; `jobs.controller.js` and `dispatch.controller.js` emit on create/update/status/assign/remove/delete. Genuinely wired both ends now. |
| D3 | No payments/accounting integration | 🟡 **Partial** — QuickBooks Desktop (QBWC/SOAP) sync landed for customers/invoices/payments (one-way push, queue + retry, item mapping). But this is bookkeeping sync, not payment processing: there is still **no card/ACH processing and no invoice pay link** anywhere — the estimate got a public approve page, the invoice did not get a public pay page. Money still only moves by someone hand-keying "Record Payment." |
| D4 | No global error boundary | ✅ **Fixed** — `components/ErrorBoundary.tsx`, mounted at root (`main.tsx`) and per-route inside `AppLayout` (`key={location.pathname}` so a crashed page self-heals on navigation). |
| D5 | Read-only data tables (no sort/bulk/CSV/saved views) | 🟡 **Partial, and inconsistently applied** — the shared `DataTable` now supports sorting, CSV export, row selection + bulk actions, and `SavedViewsMenu` exists and is used on Customers. But it was **not adopted by any of the new inventory/purchasing pages** (see N1) and bulk actions are wired on exactly one page doing one trivial thing (see N2). |
| D6 | No audit trail | ✅ **Fixed** — `audit.middleware.js` records every mutating request to `AuditLog`; viewable at Settings → Activity Log, gated by `audit.view`. |
| D7 | Monolithic bundle, no code-splitting | ✅ **Fixed** — every route in `App.tsx` is `React.lazy`-loaded behind a `Suspense`/`PageSpinner`. |
| D8 | Shallow reporting (4 fixed tabs) | 🟡 **Mostly fixed** — `ReportsPage` now has AR aging, sales-by-source, estimate pipeline, and an inventory report alongside the original four, with CSV export via `downloadCsv`. Custom date ranges on all tabs and job-costing/margin weren't verified as present everywhere but the depth gap is largely closed. |
| D9 | No optimistic updates / stale shared data | ✅ **Fixed** (for jobs) — job edits send `expectedUpdatedAt`; a stale write gets a `409`/`STALE_JOB` with a clear message, and `useUpdateJob`'s `onError` refetches the job so the next save has a fresh timestamp instead of failing forever. Combined with D2, the board and job forms no longer silently stomp each other. |
| D10 | No customer portal | 🟡 **Partial** — `PublicEstimatePage` gives customers a real, unauthenticated, token-gated approve/decline flow. Nothing equivalent exists for invoices (no pay link, no view-only invoice/history page), and there's no "my account" style landing for repeat customers. |
| D11 | No scheduling depth (recurring jobs, map/route) | 🟡 **Mostly fixed** — `RecurringPage` (recurring jobs) and `MapPage` (Leaflet, job pins from the dispatch board) both shipped. Live GPS tech tracking is still not real: see N7. |
| D12 | Dead/duplicate socket implementation | ✅ **Fixed** — `backend/src/config/socket.js` is gone; there's one socket implementation now (inline in `app.js`), and it's actually used. |
| Low: hidden command palette | — | ✅ **Fixed** — palette is now reachable via a header search affordance and the `/` key, not just Cmd/Ctrl+K. |
| Low: no bulk CSV import | — | ✅ **Fixed** — `customers.routes.js` (`POST /customers/import`) and `inventory.routes.js` (`POST /items/import`) both landed with an `ImportModal`. |

---

## New findings (introduced or exposed by the recent work)

**N1 — Four of six new list pages didn't get the `DataTable` upgrade.**
`InventoryPage` and `SuppliersPage` use the shared `DataTable` (sort, CSV,
consistent empty states). `PurchaseOrdersPage`, `SerializedUnitsPage`,
`StockLocationsPage`, and `PricingTiersPage` all hand-roll a plain `<table>`
with a hardcoded `<thead>` — no sorting, no CSV export, no bulk anything. A
dispatcher trying to sort 40 open POs by ship date, or export the serialized-
unit register for an insurance audit, simply can't, on pages built in the same
sprint as ones that can. This isn't legacy debt, it's new code shipped
below the bar the codebase itself already established.

**N2 — "Bulk actions" is one button on one page.** The `DataTable` component
(`components/ui/DataTable.tsx`) fully supports `selectable`/`bulkActions`, and
the root `README.md` advertises "row selection + bulk actions" as delivered.
In the whole frontend, exactly one page (`CustomersPage.tsx`) passes
`bulkActions`, and the action it wires up is "Export selected" — a CSV
re-export of rows the toolbar's own "Export CSV" button already covers for the
full list. There is no bulk status change, bulk reassignment, bulk delete, or
bulk email anywhere (invoices, jobs, estimates, purchase orders included).
Round 1 flagged the *absence* of bulk actions as a High severity gap; round 2
built the plumbing and then didn't use it — which is arguably a worse trap for
a future dev who reads the README, assumes it's everywhere, and doesn't check.

**N3 — Read endpoints for the new purchasing/inventory data are wide open,
and this is now materially more sensitive than before.** Every new route file
(`inventory.routes.js`, `purchasing.routes.js`, `suppliers.routes.js`,
`serials.routes.js`, `stockLocations.routes.js`) gates writes with
`requirePermission(...)` but leaves every `GET` unauthenticated-by-role — open
to any logged-in user. Combined with zero route-level guarding on the frontend
(`Can` only hides sidebar links and buttons; `App.tsx` has no
permission-aware route wrapper), a `technician` — whose only inventory grant
is the new scoped `inventory.issueToJob` — can navigate straight to
`/suppliers`, `/purchasing`, `/purchasing/:id`, `/serials`, or
`/inventory/locations` by URL and see **every supplier's cost per part,
every PO's negotiated pricing, and full serialized-unit/warranty records**
for the whole company. `getJobParts` (`inventory.controller.js`, used by
`JobMaterialsCard` on every job detail page) goes further and returns
`unitCost` — the wholesale cost PulseService pays — to whoever can view the
job, which today is anyone. Reads being open by default was a pre-existing
product decision (see `README.md`'s own "reads are generally open" note), but
nobody revisited it when the write side started guarding genuinely
competitive/financial data. For a small owner-operator like Prime Comfort,
this means any hourly tech can see supplier cost and back into the company's
margin on every job.

**N4 — Technician GPS tracking is half-built and effectively dead code.**
`technicians.controller.js`'s `updateLocation` broadcasts
`io.emit("technician:location", {...})` globally on every location update, and
the route (`PATCH /technicians/:id/location`) has **no permission guard at
all** — any authenticated user can PATCH any technician's lat/lng. But no
frontend code anywhere calls that endpoint (no geolocation watcher, no "start
tracking" toggle) and no frontend code anywhere listens for
`technician:location` (confirmed: it's the only place that string appears in
the repo). `MapPage` only ever shows job pins sourced from the dispatch board
query, never a live technician position. This is backend scaffolding for a
feature that was never wired to anything — worth deleting or finishing, not
leaving half-live with an open write endpoint.

**N5 — Estimate got a customer portal; invoice didn't.** `PublicEstimatePage`
+ `public.routes.js` (HMAC-token verified via `verifyPublicToken`, no login)
let a customer view and approve/reject an estimate from an emailed link. There
is no equivalent for invoices — no public invoice view, no pay link, nothing.
Practically, a customer can approve a $4,000 estimate from their phone but
then has to be called for a credit card number to actually pay the invoice
that estimate becomes. Given D1/D10 are explicitly "close the revenue cycle"
items, closing half of it and not the other half leaves an odd asymmetric
experience.

**N6 — Permission catalog gives `dispatcher` full purchasing + supplier
authority.** `DEFAULT_ROLE_PERMISSIONS.dispatcher` in `permissions.js` includes
`suppliers.manage`, `purchasing.manage`, `purchasing.receive`, and
`inventory.manage` — meaning a dispatcher can create/edit suppliers, cut and
approve purchase orders, and adjust stock, on top of their actual job:
scheduling. `manager` has the exact same purchasing/supplier/inventory rights
as `dispatcher` plus HR/settings/QuickBooks, so the two roles are barely
differentiated on this subsystem — there's no "warehouse/parts manager" or
"office admin" middle tier, so at a shop like Prime Comfort the owner has to
either give every dispatcher purchasing authority or hand-edit the role matrix
on day one. Not broken, but the shipped defaults don't reflect how a real HVAC
shop separates "who schedules jobs" from "who orders parts and owes suppliers
money."

**N7 — QuickBooks sync is push-only, and it's a real operational
dependency.** The QBWC integration (`quickbooksSoap.controller.js`,
`sync-queue.service.js`) only pushes PulseService customers/invoices/payments
out to QuickBooks; nothing flows back (no reconciliation of payments entered
directly in QuickBooks, no chart-of-accounts pull). It also requires a
Windows PC running QuickBooks Desktop with the Web Connector actively polling
— a real piece of always-on office infrastructure, not just a settings
toggle. That's a reasonable scope choice for a first cut, but `SettingsTab`
doesn't surface any of this as a caveat to the admin configuring it, and nothes
nothing detects "the Web Connector hasn't polled in N hours" (i.e., silently
stopped syncing) beyond the raw queue list.

**N8 — Public estimate link has no expiry and no rate limiting.**
`utils/publicToken.js` computes a stable HMAC over `scope:id` with no
timestamp/expiry component, so an emailed estimate-approval link is valid
forever (even after the estimate is converted to a job/invoice, revoked, or
the customer relationship ends) and there's no rate limiter on
`public.routes.js` the way there is on `/auth/login`. The 128-bit HMAC makes
brute-forcing a specific token infeasible, but there's nothing to revoke a
link if it leaks, and no visible cap on request volume to that route.

---

## What's genuinely better (for balance)

The revenue-cycle Phase 1 from round 1's roadmap basically shipped: PDF
generation, real email delivery with sane dev fallback, and an online
approval flow. Phase 2 also shipped in full — the dispatch socket is wired
both directions, there's a global error boundary, an audit log with a UI, and
the dead duplicate socket file is gone. Reporting grew real depth (AR aging,
sales-by-source, pipeline). Bundle is code-split per route. The command
palette is discoverable now. The `DataTable` component itself (sort, CSV,
selection, single-layout-per-viewport) is a well-built, general-purpose
primitive — the problem is adoption, not the primitive. Job edits now protect
against silent overwrites with a clean 409 + auto-refetch pattern. This is a
notably more complete back-office product than six weeks ago.

---

## Prioritized remediation roadmap

**Phase 1 — Close the exposure gap the new inventory/purchasing data opened**
1. **Gate the new read endpoints** (`inventory.routes.js`,
   `purchasing.routes.js`, `suppliers.routes.js`, `serials.routes.js`,
   `stockLocations.routes.js`) behind at least a view-level permission, or
   strip `unitCost`/supplier pricing out of the technician-visible shape of
   `getJobParts`. *(N3)*
2. **Add a route-level permission guard on the frontend** (not just `Can` on
   buttons) so a user without `suppliers.manage`/`purchasing.manage` etc.
   can't reach those pages by URL at all. *(N3)*
3. Either **finish or delete** the technician-location broadcast + endpoint;
   as-is it's an open write with no consumer. *(N4)*

**Phase 2 — Finish the revenue cycle**
4. **Invoice pay link** (Stripe or similar) mirroring the estimate approval
   page — this is the one piece of D1/D3/D10 that's still fully absent.
   *(D3, N5)*
5. **Token expiry / revocation** for public estimate links, plus a rate
   limiter on `public.routes.js`. *(N8)*

**Phase 3 — Bring the new pages up to the established bar**
6. Port `PurchaseOrdersPage`, `SerializedUnitsPage`, `StockLocationsPage`, and
   `PricingTiersPage` onto the shared `DataTable` (sort + CSV at minimum).
   *(N1)*
7. Either build out real bulk actions (bulk reassign, bulk status, bulk send)
   on the pages that would benefit — invoices, jobs, POs — or stop advertising
   "bulk actions" as a general capability in the README. *(N2)*

**Phase 4 — Role model catch-up**
8. Split `purchasing`/`suppliers`/`inventory.manage` out of the blanket
   `dispatcher` default, or introduce a dedicated parts/procurement role, so a
   shop can hand out scheduling access without also handing out spending
   authority. *(N6)*
9. Surface QuickBooks Web Connector health (last successful poll time) in
   `QuickBooksTab` instead of only a raw queue list. *(N7)*

Phase 1 is the one that matters most for a real business running on this
today: the new subsystems moved real financial data (supplier costs, PO
pricing, margins) into the app, and the permission model didn't move with it.

---

*Filed as an internal engineering review. Companion to `DESKTOP-REVIEW.md`,
`MOBILE-REVIEW.md`, and `MOBILE-REVIEW-2.md`. Nothing here is customer-facing.*
