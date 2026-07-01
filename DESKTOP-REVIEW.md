# PulseService — Adversarial Desktop Review

**Reviewed at:** commit `5bdb7bf` (2026-07-01)
**Method:** Read the app shell, routing, list/detail/form pages, the dispatch
board, reporting, the data/query layer, and the socket wiring (frontend +
backend), then compared the office/back-office web experience against the
desktop products of **ServiceTitan, Housecall Pro, Jobber, FieldEdge, Service
Fusion, Workiz.** As with the mobile review, this is deliberately adversarial —
the goal is to find what's missing or wrong, not to celebrate what works.

---

## TL;DR verdict

Desktop is our **stronger surface** than mobile — this is clearly built as an
office/dispatcher tool, and the CRUD, dispatch board, global search, RBAC, and
design system are legitimately good. Call it a **6/10** against the category.

But "manage records in a nice UI" is only half of what a back-office platform
does. The other half is **communicating with customers and money moving** —
emailing/printing estimates and invoices, collecting payment, syncing to
accounting, and a dispatch board that updates live for the whole office. On
those we range from *stubbed* to *absent*:

The three biggest problems, in order:
**(1) "Send" sends nothing and there's no PDF/print — we can't actually deliver
a document to a customer; (2) the dispatch board is not real-time despite
advertising it in the architecture; (3) no payments/accounting integration and
no customer-facing portal.** Everything else is polish on top of those holes.

---

## Benchmark: what the popular desktop apps do that we don't

| Capability | ServiceTitan / Housecall / Jobber / FieldEdge | PulseService today |
| --- | --- | --- |
| Email/text estimates & invoices to customers | ✅ Core | ❌ "Send" only flips a status; no email/SMS exists |
| PDF / print documents | ✅ Branded PDFs | ❌ No PDF, no print stylesheet, no `window.print` |
| Online estimate approval / invoice pay link | ✅ Customer clicks to approve/pay | ❌ None (`approvedAt`/`signatureUrl` set manually) |
| Integrated payment processing | ✅ Stripe/native card | ❌ Manual "record payment" only |
| Accounting sync (QuickBooks/Xero) | ✅ Two-way | ❌ None |
| Live dispatch board (multi-user) | ✅ Updates for everyone instantly | ❌ Frontend never connects the socket; needs refetch |
| Map view / GPS tech tracking / routing | ✅ Standard | ❌ `lat`/`lng` stored, never mapped |
| Customer portal | ✅ Self-serve history/approve/pay | ❌ None |
| Reporting: AR aging, job costing, P&L, export | ✅ Deep + exportable | ⚠️ 4 fixed chart tabs, no export/custom range |
| Table sorting / bulk actions / CSV import-export | ✅ Everywhere | ❌ None |
| Audit log / activity history | ✅ Who did what, when | ❌ None |
| Recurring jobs / capacity planning | ✅ Standard | ❌ None |

We win on: **global command search, DB-driven configuration, RBAC, and the
drag-and-drop board UI.** We're absent on the revenue-cycle and
collaboration features that justify a back-office subscription.

---

## Findings by severity

Severity reflects impact on a real office user (dispatcher, CSR, owner).

### 🔴 Critical

**D1 — "Send" doesn't send; no way to deliver a document.**
There is **no email or SMS integration in the codebase** (no nodemailer, no SMTP,
no provider). "Send Estimate" / "Send Invoice" only set `status = "sent"` /
`sentAt`. The customer is never contacted. There is also **no PDF generation and
no print path** (no PDF lib, no `window.print`, no print stylesheet). Net: the
office literally cannot produce or deliver an estimate/invoice to a customer from
this app — the single most important back-office job. *Competitors treat
email + branded PDF + online approve/pay as the core loop.*

**D2 — The dispatch board is not real-time, despite the plumbing.**
The backend runs socket.io with dispatch rooms (`app.js`, `join:dispatch`) and
`socket.io-client` is a dependency — but **the frontend never opens a socket**
(no `io()`, no `socket.on` anywhere in `frontend/src`). `useDispatch` only
invalidates its *own* React-Query cache after *its own* mutations. So when
dispatcher A reassigns a job, dispatcher B (and the affected tech) see nothing
until a manual refetch or the 30s `staleTime` lapses — and even then only if they
refetch. A shared dispatch board that isn't live is a correctness problem, not
just a nicety: two dispatchers will stomp each other.

**D3 — No payments / accounting integration.**
Payments are hand-keyed (`Record Payment`), there is no card processing, and no
QuickBooks/Xero sync. For a platform whose whole point is the cash cycle
(estimate → job → invoice → payment → books), the money never actually moves and
never reconciles to accounting. This is table stakes for every competitor.

### 🟠 High

**D4 — No global error boundary.**
`main.tsx` mounts `QueryClientProvider` + `BrowserRouter` with **no React
`ErrorBoundary`**. Any render-time exception in any page white-screens the entire
SPA with no recovery — brutal for an all-day office tool. One bad datum can take
down the whole app for a user.

**D5 — Data tables are read-only grids.**
No column **sorting**, no **bulk selection/actions** (email 10 overdue invoices,
reassign 5 jobs), no **CSV import/export**, no **saved views/filters**, no column
configuration. (Confirmed: no `sortBy`/`onSort` and no row-selection checkboxes
in any list page.) Office users live in these tables all day; competitors make
every column sortable and support bulk operations and exports.

**D6 — No audit trail / activity history.**
Nothing records who changed a job's status, edited an invoice, deleted a
customer, or reassigned work. For multi-user back-office software this is both an
operational need (accountability) and often a compliance one. There's no
`ActivityLog`/history model and no per-record timeline in the UI.

**D7 — Monolithic bundle, no code-splitting.**
`vite build` emits one ~1.17MB (~316KB gzip) chunk (warns >500KB). Every route —
Reports/recharts, dispatch, all forms — loads up front. First paint is heavier
than it needs to be, and there's no `React.lazy`/route-level splitting.

### 🟡 Medium

**D8 — Reporting is shallow.** Four fixed chart tabs (Revenue/Jobs/Techs/
Customers) with preset period toggles. No custom date ranges, no export, no
drill-down, and none of the reports an owner actually runs: **AR aging, job
costing/margin, P&L, sales by source/campaign, technician revenue, close rates.**

**D9 — No optimistic updates; stale shared data.** Every mutation waits for the
round-trip then invalidates (`staleTime: 30000`). Combined with D2, the board and
lists routinely show other users stale state, and the local UI feels laggy on
each drag/edit.

**D10 — No customer portal.** Customers can't view history, approve an estimate,
or pay an invoice online — so even if D1 is fixed with email, there's no
destination link for the customer to act.

**D11 — No scheduling depth.** No recurring jobs, no capacity/utilization
planning beyond the per-tech bar we added, no route optimization, and no map
despite storing `lat`/`lng` on locations/technicians.

**D12 — Dead/duplicate socket code.** `backend/src/config/socket.js`
(`initSocket`, `join_dispatch`) is a second, unused socket implementation that
diverges from the inline one in `app.js` (`join:dispatch`). Confusing and a
maintenance trap — pick one.

### 🟢 Low / polish

- **Hidden command palette:** great feature, but "intentionally NO on-screen
  affordance" (per its own comment) means most users never discover Cmd/Ctrl+K.
  Add a subtle search entry point in the header.
- **No keyboard shortcuts** beyond the palette (no `n` = new, `/` = search, list
  `j/k` navigation) — power-office-user niceties competitors ship.
- **No dark mode / density settings / saved user prefs** (page size, default
  filters).
- **No bulk CSV import** for onboarding (customers, pricebook) — painful first
  day for a new account.
- **Notifications are in-app only** (bell + list); no email digests or
  escalations.
- **Inconsistent form error surfacing** — some forms show field errors, others
  register inputs with no visible validation feedback.

---

## What we actually got right (for balance)

- **Command-palette global search** (Cmd/Ctrl+K, debounced, keyboard-navigable
  across customers/jobs/invoices/estimates) — genuinely competitive.
- **DB-driven single source of truth** for statuses/types/roles (no hardcoded
  enums; write-path validation) — clean, rare to see done this well.
- **RBAC/permissions**: permission-gated navigation, a `Can` component, and a
  Roles admin tab.
- **Dispatch board**: day/week/month, drag-and-drop reassign/reschedule,
  unassigned/undated backlogs, plus the KPI strip, per-tech utilization, live
  "now" line, and status legend.
- **Accounting-integrity guardrails**: invoices lock after payment/void; cascade
  hard-delete keeps referential integrity.
- **Solid engineering base**: typed API layer, React Query caching, server-side
  pagination + debounced search + status filters, consistent design system.

The foundation is good. The gaps are about *finishing the business workflows*,
not fixing a shaky base.

---

## Prioritized remediation roadmap

**Phase 1 — Close the revenue-cycle holes (highest business value)**
1. **PDF + email delivery** for estimates/invoices (server-side PDF, an email
   provider, branded template). This is the #1 missing back-office capability.
   *(D1)*
2. **Payment processing** (Stripe) with an invoice **pay link**, and record the
   payment automatically. *(D3)*
3. **Online estimate approval** link (wire up `approvedAt` + `signatureUrl`).
   *(D1/D10 seed)*

**Phase 2 — Make it trustworthy for multi-user offices**
4. **Wire the dispatch socket on the frontend** (subscribe to the existing rooms;
   emit board updates from reassign/reschedule/status controllers) so the board
   is live for everyone; add **optimistic updates**. *(D2/D9)*
5. **Global `ErrorBoundary`** with a friendly recovery screen. *(D4)*
6. **Audit log** model + per-record activity timeline. *(D6)*
7. Delete the **duplicate socket implementation**. *(D12)*

**Phase 3 — Power-office table & reporting features**
8. **Sortable columns, bulk actions, CSV import/export, saved filters** on all
   lists. *(D5)*
9. **Reporting depth**: AR aging, job costing/margin, sales by source,
   technician revenue, custom date ranges + export. *(D8)*
10. **Route-level code-splitting** to shrink first load. *(D7)*

**Phase 4 — Platform reach**
11. **Customer portal** (view history, approve, pay). *(D10)*
12. **Recurring jobs, capacity planning, map/route view** (use the `lat`/`lng` we
    already store). *(D11)*
13. Discoverable command-palette affordance + keyboard shortcuts; user prefs /
    dark mode. *(polish)*

Phase 1 is where the money is — without document delivery and payments, the
desktop app can't run a real service business regardless of how nice the UI is.

---

*Filed as an internal engineering review. Companion to `MOBILE-REVIEW.md`.
Nothing here is customer-facing.*
