# PulseService — Adversarial Desktop Review

**Reviewed at:** commit `9cbf693` (2026-07-22)
**Prior reviews:** `DESKTOP-REVIEW.md` through `DESKTOP-REVIEW-4.md` (last scored 7.5/10 at
commit `409d98b`) — **all four deleted** and superseded by this document. 67 commits
landed between that review and this one.
**Method:** Assumed every prior finding and every claim in the codebase's own comments
was wrong until independently re-verified against the live code, file-by-line, with no
credit given for "looks fine." Re-checked all six items `DESKTOP-REVIEW-4.md` left open,
read every route file in `backend/src/routes` against its controller, audited the
"single source of truth" (DB-driven lookup) principle end to end, checked permission
gating on every route, and read the new feature surface shipped since the last review
(real CSV-imported customer/job/invoice/agreement/equipment data, the Job→Work Order /
Estimate→Quote / Supplier→Vendor renames, tax-rate removal, Microsoft Graph email +
SSO login, job-to-invoice auto-import, multi-block scheduling, agreements-linked
recurring jobs, the configurable revenue report).

---

## TL;DR verdict — 6/10 (down from 7.5)

The score drops for two reasons, and neither is "the app got worse at doing its job" —
it's that this cycle's 67 commits went entirely into new feature surface and none of
the last review's six open findings were touched, **and** a zero-trust pass turned up
a live secrets-management problem plus a genuine bookkeeping-data-corruption bug in a
feature that shipped this cycle.

**The two things that need attention before anyone relies on this in production, in
order:**

1. **`JWT_SECRET` has no real value set anywhere in this repo or its (git-ignored)
   local override, so the deployed backend is running on the hardcoded fallback
   baked into `docker-compose.yml` — a string that's sitting in version control for
   anyone with repo access to read.** That one secret now also signs every login
   session, the Microsoft SSO CSRF state token, and the public estimate-approval
   HMAC. *(C1)*
2. **Toggling a line item's "include on document" checkbox on an already-paid
   invoice — a feature explicitly built and documented as "safe and reversible" —
   permanently zeroes that invoice's historical tax amount and recalculates its
   total/balance without it, then pushes the corrected-looking-but-wrong number to
   QuickBooks.** This only bites real, tax-collecting historical invoices (the 739+
   CSV-imported ones), not anything created fresh in the app. *(C2)*

Beyond those two, the picture is a genuinely solid engineering base with real, if
unglamorous, gaps: the "single source of truth" principle holds almost everywhere
(one deliberate, documented exception for freeform job types, one accidental leak via
the customer bulk-import endpoint), permission gating is thorough on paper but has an
audit-log redaction hole and an unguarded attachment-delete route, and the three-cycle
entity rename (Job→Work Order, Estimate→Quote, Supplier→Vendor) is complete and clean
in two of three cases but visibly unfinished in the third — which matters today because
it's exactly the kind of inconsistency a client notices live (Help Center text, the
Dispatch board button, the Roles & Permissions matrix, and the Recurring Jobs page all
still say "Job"/"Jobs" while everywhere else says "Work Order").

**None of `DESKTOP-REVIEW-4.md`'s six open items were remediated this cycle** — they
are re-confirmed open below, byte-for-byte unchanged in behavior.

---

## Part 1 — Re-verification of `DESKTOP-REVIEW-4.md`'s open items

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| D-N16 | Reports page renders all 8 tabs unconditionally regardless of permission, so any role missing `reports.financial`/`reports.operational` sees tabs silently render "$0" instead of access-denied | ⛛ **Still open, unchanged** | `ReportsPage.tsx:1093-1148` renders all tabs with no permission check anywhere in the file (zero `usePermission`/`can(...)` references); `RevenueTab` (`:111`) falls back to `data?.data ?? []` on a 403 and still renders "Combined Total $0.00" (`:268-273`); backend split unchanged (`reports.routes.js:17-36`). **Correction to the prior review's framing:** there is no longer a "dispatcher" role — the role model was simplified this cycle to just `admin`/`exec`/`technician` (`permissions.js:159-168`), and `exec` now holds *both* `reports.financial` and `reports.operational` by default, so no currently-seeded role actually hits the "operational-only" case. The bug is still real and still reachable today, though: `technician` holds neither permission, so a technician who reaches `/reports` directly (no `RequirePermission` wrapper, see D-N22) sees all 8 tabs silently render "$0" rather than access-denied; and any custom role an admin creates with only one of the two permissions would hit the original partial-tab case. |
| D-N17 | Bulk deactivate/delete fires N fire-and-forget mutations, clears selection/closes dialog before requests resolve, no partial-failure feedback | ⛔ **Still open, unchanged** | `PricingTiersPage.tsx:287-291`, `StockLocationsPage.tsx:304-308`, `SerializedUnitsPage.tsx:410-414` all still loop `void x.mutateAsync(id)` with no `Promise.allSettled`/loading state on the confirm dialog (only `SerializedUnitsPage` even has a `loading` prop wired, and it's not driven by the bulk path) |
| D-N18 | Bulk actions only exist on low-traffic admin pages, not on Jobs/Invoices/Estimates | ⛔ **Still open, unchanged** | Zero `selectable`/bulk references in `JobsPage.tsx`, `InvoicesPage.tsx`, `EstimatesPage.tsx` |
| D-N19 | Public estimate-approval tokens never expire, can't be revoked, no rate limiter on `public.routes.js` | ⛔ **Still open, unchanged** | `backend/src/utils/publicToken.js:9-23` — pure HMAC over `scope:id`, no timestamp/expiry claim, no time check on verify; `public.routes.js:1-10` still has no rate-limit middleware anywhere (confirmed via project-wide grep for `rateLimit`/`express-rate-limit`) |
| D-N21 | QuickBooks tab shows "last sync" but no staleness warning | ⛔ **Still open, unchanged** | `QuickBooksTab.tsx:160-166` — only a raw timestamp, no comparison against `Date.now()`, no "hasn't polled in N hours" banner |
| D-N22 | `RequirePermission` route guard applied unevenly — `/payments`, `/reports`, `/pricebook`, `/serials` still rely solely on backend 403s | ⛔ **Still open, unchanged** | Confirmed in full `App.tsx` route audit below — same four routes, still unwrapped |

---

## Part 2 — Full current route-guard audit (`frontend/src/App.tsx`)

| Route(s) | Frontend-guarded? |
| --- | --- |
| `/dashboard`, `/my-day`, `/customers(/*)`, `/jobs`, `/jobs/:id`, `/recurring`, `/dispatch`, `/map`, `/estimates(/*)`, `/invoices(/*)`, **`/payments`**, `/technicians`, **`/pricebook`**, `/inventory`, `/inventory/cycle-count`, **`/serials`**, `/equipment`, `/agreements(/:id)`, `/marketing`, **`/reports`**, `/settings`, `/notifications`, `/help` | ❌ No `RequirePermission` — backend 403 only |
| `/jobs/new`, `/jobs/:id/edit` | ✅ `RequirePermission perm={["jobs.create"/"jobs.edit"]}` |
| `/inventory/locations` | ✅ `RequirePermission` (inventory/purchasing tier) |
| `/vendors` | ✅ `RequirePermission perm={["vendors.manage"]}` |
| `/purchasing`, `/purchasing/:id` | ✅ `RequirePermission` |

Bolded routes are D-N22's still-open gap.

---

## Part 3 — Findings by severity

### 🔴 Critical

**C1 — `JWT_SECRET` has no real value anywhere in the repo; the live deployment is almost certainly running on the hardcoded fallback checked into `docker-compose.yml`.**
`docker-compose.yml:36`: `JWT_SECRET: ${JWT_SECRET:-pulseservice-super-secret-jwt-key-change-in-production}`. The project's git-ignored `docker-compose.override.yml` sets Web Push keys and the Microsoft Graph app credentials, but **does not set `JWT_SECRET`**, and no root or backend `.env` file exists in the project (only `.env.example`). Nothing in the codebase warns or refuses to boot on the default. This single secret signs/verifies every login JWT (`auth.middleware.js`, `auth.controller.js`), the Microsoft SSO anti-CSRF `state` token (`microsoftAuth.controller.js:30,50`), and — because `publicToken.js` reads the same `JWT_SECRET` — the public estimate-approval HMAC. Anyone who has ever seen this repository's `docker-compose.yml` (it's a tracked file) already knows the fallback string; if it's genuinely active in production, they could forge an admin JWT or a public-estimate-approval link. **This is a real, live risk, not a hygiene nit — verify today whether the deployed host actually has a real `JWT_SECRET` set, and if not, set one.** Note: rotating it invalidates every active session (including your own), so do this deliberately, not five minutes before walking into a demo.

**C2 — Toggling "include this line" on a paid invoice permanently destroys its historical tax amount and silently corrupts total/balance.**
This cycle's per-line-item include/exclude toggle was explicitly designed to be the one safe edit allowed on a paid invoice (`InvoiceDetailPage.tsx:83-86` comment: "a safe, reversible flag ... the backend recalculates the total/balance accordingly"). But the update path it rides through:
- Unconditionally zeroes `taxRate` on *every* edit — `invoices.controller.js:308-311` ("Tax is no longer a supported charge on invoices; always zeroed whenever the invoice is edited.")
- Recomputes totals via `calculateTotals`, which **always returns `taxAmount: 0`** (`backend/src/utils/helpers.js:5-25`)
- Writes the resulting `total`/`balance` and immediately re-queues the invoice for QuickBooks sync (`invoices.controller.js:351`)

The 739+ CSV-imported historical invoices can carry real, non-zero legacy `taxRate`/`taxAmount` — `helpers.js`'s own comment says historical documents are supposed to keep displaying "their original tax amount." The first time anyone flips a single line-item checkbox on one of those real invoices, its original tax amount is permanently deleted and the total is recalculated without it — a silent, irreversible bookkeeping change to a document already reconciled or partially paid, immediately propagated toward QuickBooks. `EstimateDetailPage.tsx:184-190` correctly makes this toggle read-only on estimates, so the exposure is invoice-only. **Do not demo the invoice line-item include/exclude toggle on any of the real imported invoices until this is fixed** — use a fresh, taxless test invoice if you need to show it off.

### 🟠 High

**H1 — QuickBooks Web Connector password is written to the Audit Log in plaintext, readable by a role that shouldn't have it.**
`audit.middleware.js:33` redacts by an exact-string allowlist: `Set(["password","currentPassword","newPassword","token"])`. `quickbooks.controller.js` accepts `webConnectorPassword` on `PUT /quickbooks/settings` (hashed before storage in the DB, per its own comment) — but since `"webConnectorPassword"` doesn't match any redacted key, `summarizeBody()` includes it verbatim in that request's `AuditLog.metadata` row, permanently. The `exec` role holds `audit.view` by default but not `quickbooks.manage` — an executive with no business touching QuickBooks credentials can read the plaintext WebConnector password straight out of the activity log. Fix: redact by substring/case-insensitive match on `password|secret|token`, not an exact-string allowlist.

**H2 — The seed script defaults ~14 admin/technician accounts and a break-glass admin to known, documented passwords, with nothing enforcing rotation.**
`backend/prisma/seed.js:173-184` falls back to `admin123` / `pass123` / `changeme-breakglass-123` whenever `SEED_ADMIN_PASSWORD` / `SEED_EMPLOYEE_PASSWORD` / `BREAKGLASS_ADMIN_PASSWORD` aren't set, and `docker-entrypoint.sh` runs this automatically on first boot with no check that those env vars exist. `scripts/set-admin-password.js` exists as a remediation tool, but nothing forces it to run. The demo playbook already shows awareness of this (admin password has been rotated for this deployment), but the underlying gap — silent, undocumented defaults on first boot — remains for any future environment (staging, a second client instance) stood up without deliberately setting all three vars.

**H3 — The Job→Work Order rename is genuinely incomplete, and the gaps are exactly where a live demo would surface them.**
- **Settings → Roles & Permissions matrix** still labels its groups/permissions "Jobs"/"Estimates" (`backend/src/constants/permissions.js:29-38, 54-59`, rendered verbatim in `SettingsPage.tsx:1005-1014`) — while the sibling `Vendors` group was correctly renamed (`permissions.js:95-98`), proving the effort reached this file but missed two of three groups.
- **The entire Help Center** (`frontend/src/content/pageHelp.ts`) still says "Job"/"Jobs" in the Jobs, Job Detail, Dashboard, Customers, and Recurring articles (e.g. `pageHelp.ts:121-136, 163-173, 71-72, 97-118, 222-223`), while the live pages behind them all say "Work Order" (`JobsPage.tsx:206`, `JobDetailPage.tsx:228-230,344`, `DashboardPage.tsx:344-346`, `CustomerDetailPage.tsx:36,135-137`).
- **The Dispatch board itself** never got renamed: the primary toolbar button still reads "New Job" (`DispatchPage.tsx:1242`), and the job-detail side panel says "Open job" / "Archive job" (`DispatchPage.tsx:1660-1673`) — a dispatcher bouncing between the Jobs list ("New Work Order") and Dispatch ("New Job") sees two words for the identical action.
- **`RecurringPage.tsx`** mixes both terms on one screen: the table column says "work order(s)" (`:192-195`) while the create button, modal title, empty state, and delete confirmation all say "job"/"recurring job" (`:118, 258, 127, 387-388`).

Clicking Help almost anywhere in Jobs/Dispatch/Dashboard/Customers/Recurring, or opening the permissions matrix, shows the old name — trivially discoverable in a live client demo.

### 🟡 Medium

**M1 — Public estimate links can leak a second, durable copy of an already-eternal secret via server logs.**
`estimates.controller.js:279-283` embeds the approval token as a URL **query parameter**; `app.js` uses `morgan("dev")`, whose default format logs the full request URL (query string included) to stdout/container logs. Every time a customer opens their emailed estimate link, the live, never-expiring token is written to logs indefinitely — a second durable copy of the same secret flagged in D-N19/M1 above.

**M2 — The one documented "freeform" exception to single-source-of-truth (`jobType`) has forked into two inconsistent UX contracts.**
`jobs.routes.js:10-16` intentionally leaves `jobType` unvalidated so the office can type a custom service type (surfaced back as suggestions via `GET /jobs/types`). But `RecurringPage.tsx:304` renders the *same conceptual field* as a strict `<LookupSelect category="jobType">`, limited to only the 6 base `lookups.js` values — a shop that relies on a custom job type for regular work orders literally cannot create a recurring template using that type. Backend-side, `recurring.routes.js`/`recurring.controller.js` never validates `type` at all, so the restriction is purely a frontend split-brain.

**M3 — Line-item `type` is never lookup-validated on Estimates/Invoices, unlike the QuickBooks item-mapping path that keys off the same category.**
`estimates.routes.js:9-12` / `invoices.routes.js:9-12` only validate top-level `status`/`discountType`; no route validates each line item's `type` against the `lineItemType` lookup, even though `quickbooks.routes.js:46` explicitly validates the same category for item mappings. An estimate/invoice line item can be persisted with an arbitrary `type` string, which would silently fail QuickBooks item-mapping resolution and mis-render anywhere the UI branches on the known 7 values.

**M4 — The one HTTP-facing bulk-import endpoint bypasses the `customerType` lookup validation the single-create path enforces.**
`customers.routes.js` applies `validateLookups({ type: "customerType" })` to `POST /customers` but not to `POST /customers/import`; `customers.controller.js:372` writes `type: r.type?.trim() || "residential"` straight from each CSV row with no lookup check — a genuine, client-reachable violation of the single-source-of-truth principle (not just an internal script issue), able to write customer types outside the two allowed values and silently break anything that branches on them (status-colored badges, commercial/residential filters).

**M5 — Attachment deletion has no permission gate at all, unlike every comparable delete in the app.**
`attachments.routes.js` applies only `auth`, no `requirePermission`, on delete. Any authenticated user — including a technician — can permanently delete any photo/document on any job/customer/invoice/estimate/equipment record company-wide, not just their own uploads. (Reading raw attachment bytes behind only `auth` is a defensible, consistent "reads open" design choice; the unguarded **delete** is not, since it's destructive and every other delete route in the app is permission-gated.)

**M6 — Lookup validation fails open on an unrecognized category.**
`lookups.service.js` documents: "If the category is unknown (not seeded), validation is skipped (returns true)." This is a deliberate choice, but it means the core enforcement mechanism behind the "every enumerated value is validated on write" claim silently no-ops instead of rejecting if a route ever references a mistyped category or the `Lookup` table is missing rows for one (partial reseed, migration gap) — the opposite of defense-in-depth for a system whose selling point is DB-driven validation.

**M7 — Three still-writable `taxRate` fields survived the tax-removal commit as dead weight.**
`Estimate.taxRate/taxAmount`, `Invoice.taxRate/taxAmount`, and `CompanySettings.taxRate` all still exist in `schema.prisma`. New/edited estimates and invoices correctly hardcode `taxRate: 0` — but `settings.controller.js`'s `update` handler never strips `taxRate` from the request body, so `PUT /settings` can still silently persist a non-zero company-wide tax rate that nothing reads for any calculation (confirmed via full-repo grep). Low risk, but exactly the kind of question ("what does Tax Rate do in Settings? Nothing.") that looks sloppy if a client asks during a demo.

**M8 — A second, hand-maintained copy of the status/color enums lives in the frontend with no drift protection.**
`frontend/src/utils/formatters.ts` (`getJobStatusColor`, `getInvoiceStatusColor`, `getEstimateStatusColor`) hard-encodes the full value+color list for three lookup categories, used as the `StatusBadge` fallback before metadata loads. Currently in sync with `lookups.js`, but nothing (no test, no lint rule) enforces that — add/remove/recolor a status centrally and this file goes stale silently.

**M9 — Purchase Order detail page drops the work-order/customer link the list page shows.**
`PurchaseOrdersPage.tsx` correctly shows and links a PO's originating Work Order; `PurchaseOrderDetailPage.tsx` never references the linked job or customer anywhere (confirmed via grep — zero matches). A PO created from a job's "Create PO" shortcut loses its visible tie-back to that job once you're on its own detail page.

**M10 — "Run due billing" / "Run due now" fire immediately with no confirmation, despite bulk-generating real invoices/jobs.**
`AgreementsPage.tsx` and `RecurringPage.tsx` both call their respective mutations directly on click with no `ConfirmDialog`, even though each can generate an unbounded number of draft invoices/jobs across every due agreement/schedule in one action — inconsistent with every other destructive/bulk action in the app, which does confirm first.

### 🟢 Low / polish

- **The role model is now just three roles: `admin`, `exec`, `technician`.** `manager`
  and `csr` were retired this cycle (`c56c172`) because "this client doesn't use
  them," per the commit message — a deliberate scope match, not a bug. Worth noting
  because it changes what a demo of Settings → Roles & Permissions should say (there
  are three rows now, not the five/six some earlier internal notes assumed), and
  because `exec`'s default permissions (`payments.view`, `reports.*`, `audit.view`
  only — no `jobs.*`, no `dispatch.manage`, no `invoices.manage`, no
  `customers.*`) mean **no non-admin role can currently dispatch, invoice, or manage
  customers** — if the client has office staff who aren't meant to hold full admin
  (settings, user management, everything), that's worth surfacing to them rather than
  assuming it'll come up later.
- **`VendorsPage.tsx`** has no pagination (fetches the entire table in one call) and no bulk actions/`selectable`, unlike the rest of the redesigned list pages — fine at today's vendor count, inconsistent going forward.
- **Estimate/Invoice tax line** (`InvoiceDetailPage.tsx`, `EstimateDetailPage.tsx`) is still conditionally rendered for `taxAmount > 0` — correct today only because that condition can now never be true for a newly-created record (see C2/M7); worth a comment so a future refactor doesn't remove it and silently break legacy invoice display.
- Push-unsubscribe endpoint deletes a subscription by `endpoint` string with no ownership check (low impact — the endpoint URL is itself a high-entropy secret).
- QuickBooks Web Connector SOAP `authenticate` has no rate limit (unlike `/auth/login`), though it fails generically and compares credentials via bcrypt, so it's a hardening gap rather than a live vuln.

---

## What we actually got right (for balance)

- **Single source of truth holds almost everywhere.** One deliberate, well-commented exception (`jobType` freeform) and one accidental leak (M4); every other enumerated value in the app is still defined once in `lookups.js`, seeded, served via metadata, and validated on write.
- **Permission gating is broad and mostly correct.** Every route file was read end to end this cycle; the newer surfaces (`agreements`, `recurring`, `vendors`, `quickbooks`, `messages`, `time`, `push`) are all appropriately gated — the exceptions (H1, M5) are narrow and specific, not systemic.
- **Microsoft SSO and Graph mail are implemented soundly**: CSRF-protected via a signed, purpose-checked, 10-minute-expiry state token; an email-domain allowlist for auto-provisioning; new SSO accounts always land on the least-privileged `technician` role; the app JWT is returned via a URL fragment (never hits server logs) rather than a query string; no secret or token is ever logged on either success or failure paths.
- **Audit log coverage is structurally complete** — the middleware is mounted globally ahead of every router, so every mutating request across all 34 route files is captured; the only gap found is the redaction completeness in H1, not coverage.
- **The terminology rename is 2/3 clean.** Estimate→Quote and Supplier→Vendor are both complete with zero stray old labels anywhere in the frontend; only Job→Work Order has gaps, and they're now itemized precisely (H3).
- **Error boundary, code-splitting, and design-system consistency all still hold**: a root-level boundary plus a per-route one keyed by path so a crash recovers on navigation without a full reload; all 30+ pages are lazy-loaded behind one `Suspense`; the shared `DataTable` (sort, CSV export, pagination) is used consistently across the newly-redesigned list pages.
- **Money-handling correctness from prior cycles held**: Void still hidden until payments are reversed, reversed payments still labeled distinctly from processor refunds, revenue reporting still excludes reversed payments.

---

## Prioritized remediation roadmap

**Phase 0 — Before you rely on this in production (do first, deliberately, not mid-demo)**
1. Confirm whether the deployed host has a real `JWT_SECRET` set; if not, set one. Rotating it logs everyone out, so schedule it, don't surprise yourself with it. *(C1)*
2. Block/patch the invoice line-item include-toggle path so it no longer zeroes `taxRate`/recalculates tax on invoices that already carry a non-zero legacy tax amount — or at minimum, disable the toggle for invoices with `taxAmount > 0` until fixed, the same way estimates already disable it entirely. *(C2)*

**Phase 1 — Close the trust/audit gaps**
3. Redact `audit.middleware.js`'s body summarizer by pattern (`/password|secret|token/i`) instead of an exact-string allowlist. *(H1)*
4. Add a permission gate to attachment delete (owner-or-`*.manage`-tier, matching the resource it's attached to). *(M5)*
5. Validate `customerType` on the bulk-import endpoint the same way the single-create path does. *(M4)*

**Phase 2 — Finish the rename and the reporting gate from last cycle**
6. Finish Job→Work Order in the Roles & Permissions matrix, the Help Center, the Dispatch board, and Recurring Jobs. *(H3)*
7. Gate the Reports tabs by `reports.financial`/`reports.operational`, the same conditional-tab-array pattern already used correctly in `SettingsPage.tsx`. *(D-N16)*
8. Apply `RequirePermission` consistently to `/payments`, `/reports`, `/pricebook`, `/serials`. *(D-N22)*

**Phase 3 — Make destructive/bulk actions safe, and finish the near-misses**
9. Await bulk mutations with `Promise.allSettled`, keep the confirm dialog loading, and surface partial-failure results; don't clear selection until the batch settles. *(D-N17)*
10. Put real bulk actions on Jobs and Invoices, where a front office actually needs them daily. *(D-N18)*
11. Add expiry + revocation to public estimate tokens, and rate-limit `public.routes.js`; stop putting the token in a logged query string. *(D-N19/M1)*
12. Add a "hasn't synced in N hours" staleness badge to the QuickBooks tab. *(D-N21)*
13. Reconcile the `jobType` freeform/lookup split between Jobs and Recurring Jobs; validate `lineItemType` on estimate/invoice line items. *(M2/M3)*
14. Add confirmation dialogs to "Run due billing"/"Run due now." *(M10)*

Phase 0 is genuinely urgent and has nothing to do with feature completeness — it's the difference between "the demo went great" and "a leaked link or a stale secret becomes a real incident later." Everything else is the same kind of finish-the-workflow work the last three reviews already asked for, still waiting.

---

*Filed as an internal engineering review. Companion to `MOBILE-REVIEW.md`. Supersedes and
replaces `DESKTOP-REVIEW.md` (original), `DESKTOP-REVIEW-2.md`, `-3.md`, and `-4.md`, all
deleted. Nothing here is customer-facing.*
