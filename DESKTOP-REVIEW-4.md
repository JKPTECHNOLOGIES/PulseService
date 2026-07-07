# PulseService — Adversarial Desktop Review #4 (Front Office Perspective)

**Reviewed at:** commit `409d98b`
**Prior review:** `DESKTOP-REVIEW-3.md` (scored 6.5/10)
**Reviewer stance:** I still run the front office at a small commercial HVAC
shop — I dispatch, answer the phone, quote and invoice, order parts, and
reconcile the books at month-end. I judge this against ServiceTitan, Housecall
Pro, Jobber, FieldEdge, Service Fusion, and Workiz. I don't care how the code
is organized; I care whether I'd trust my staff's logins and my margins to it.

**Method:** Read `DESKTOP-REVIEW-3.md` in full and re-verified every one of its
findings **against the live code** rather than assuming anything carried over —
route by route, controller by controller, and permission by permission. Then I
walked the surfaces called out as shipped since then (the read-permission
close-out on inventory/purchasing/suppliers/serials, `RequirePermission` route
gating, the `DataTable`/bulk-action rollout, the dispatch realtime + optimistic
work, the map/directions helper, dark mode, keyboard shortcuts) and hunted for
problems the remediation work itself introduced.

---

## TL;DR verdict — 7.5/10 (up from 6.5, and this time I mean it went *up*)

This is the cycle I've been asking for across three reviews. The single issue
I called "the top issue, again" in #3 — any technician/CSR/dispatcher reading
supplier costs, PO pricing, and job-level margins straight off an unguarded
URL — **is finally closed.** I checked every route file line by line:
`/purchasing` gates every read behind `purchasing.manage`/`purchasing.receive`
(`purchasing.routes.js:12-18`), `/suppliers` behind a supplier/purchasing/
inventory tier (`suppliers.routes.js:14-19`), `/inventory/locations` behind an
inventory/purchasing tier (`stockLocations.routes.js:13-22`), and — the one
that actually mattered — the wholesale `unitCost` is now **stripped from the
technician-visible shape** of both the item list and `getJobParts` unless the
caller holds `inventory.manage` (`inventory.controller.js:24-31, 67-70,
470-495`). Serial `purchaseCost` is stripped the same way
(`serials.controller.js:9-16, 47-48, 89-92`). And there's now a real
frontend route guard — `RequirePermission` (`components/layout/RequirePermission.tsx`)
— wrapping the sensitive routes in `App.tsx` (`App.tsx:112-156`), so a role
can't just type the URL to bypass a hidden sidebar link anymore.

On top of that, a genuinely long list of #3's smaller findings got closed:
the Void button no longer shows on partially-paid invoices
(`InvoiceDetailPage.tsx:187-190`), reversed payments are now labeled
`reversed` and not `refunded` (`payments.controller.js:52-57, 103-106`), the
manual "flip a unit to Installed and orphan it" hole is blocked
(`serials.controller.js:150-180`), the dead technician-GPS write endpoint was
**deleted** (`technicians.routes.js:16-20`), the Help Center now describes the
manual serial workflow (`content/pageHelp.ts:650-655`), the Dispatch archive
button is neutral-styled like everywhere else (`DispatchPage.tsx:1533-1534`),
the Roles editor has a dirty-check before you switch roles
(`SettingsPage.tsx:841-844, 929-930`), Pricing Tiers has its own nav entry the
dispatcher/CSR can reach (`Sidebar.tsx:112-117`), and all four "plain-table"
pages were ported onto the shared `DataTable` with sort + CSV and now carry
real bulk actions. That's eleven-ish prior findings actually *remediated*
instead of features stacked on top of them. Compared with #3 — where nothing
moved — this cycle did the unglamorous work.

**So why only 7.5 and not higher?** Two reasons. First, the remediation cycle
introduced one new self-inflicted trust bug: splitting reports into
`reports.financial`/`reports.operational` on the backend
(`reports.routes.js:17-36`) without teaching the Reports **page** about the
split, so an operational-only role (the default `dispatcher`) sees five
financial tabs that quietly render **$0 / empty** instead of an access screen
(`ReportsPage.tsx:873-884`, `54-59`). Second, the bulk-action rollout is real
but sloppy where it counts: the new bulk deactivate/delete actions fire N
unbatched fire-and-forget mutations and swallow every per-item error
(`PricingTiersPage.tsx:287-291`, `StockLocationsPage.tsx:304-308`), and the two
lists a front office actually lives in for bulk work — **Jobs and Invoices** —
still have no bulk actions at all. Payments/pay-link is still absent, but per
the owner's call that's intentionally deferred and I'm not scoring it as a
gap this round.

**Compared to the field:** the data-exposure posture is now in the neighborhood
where ServiceTitan/FieldEdge live — margins gated by role. That was the thing
keeping this out of my staff's hands, and it's fixed. What's left between this
and Jobber/Housecall is polish and the deferred money-in loop, not a
trust-blocker.

---

## What got fixed since #3

| # | Finding from #3 | Status now | Evidence |
| --- | --- | --- | --- |
| N3 | Inventory/purchasing/supplier reads open; `getJobParts` leaks `unitCost`; no FE route guard | ✅ **Fixed (the big one)** | Reads gated in `purchasing.routes.js:12-18`, `suppliers.routes.js:14-19`, `stockLocations.routes.js:13-22`; cost stripped in `inventory.controller.js:24-31, 67-70, 487-489` and `serials.controller.js:9-16, 47-48, 89-92`; FE guard `RequirePermission.tsx` wired in `App.tsx:112-156` |
| N1 | Four list pages hand-roll a plain `<table>`, no sort/CSV | ✅ **Fixed** | `PurchaseOrdersPage`, `SerializedUnitsPage`, `StockLocationsPage`, `PricingTiersPage` all render `<DataTable>` with `sort`/`csvFilename` now |
| N2 | "Bulk actions" was one redundant button on one page | 🟡 **Mostly fixed** | `bulkActions=` now on 5 pages; real bulk deactivate/delete on Pricing Tiers / Stock Locations / Serialized Units. But Customers & POs are still export-only, and Jobs/Invoices/Estimates have none (see D-N18) |
| N4 | Technician-GPS write endpoint: unguarded, no consumer | ✅ **Fixed (deleted)** | `technicians.routes.js:16-20` documents the removal; no `technician:location` string remains in the app |
| N6 | `dispatcher` had full purchasing/supplier authority | ✅ **Fixed** | `DEFAULT_ROLE_PERMISSIONS.dispatcher` (`permissions.js:178-194`) no longer holds `suppliers.manage`/`purchasing.manage`/`purchasing.receive` — only `inventory.manage` remains |
| N7 | QuickBooks sync push-only, no connector-health indicator | 🟡 **Partial** | `QuickBooksTab.tsx:162-165` now shows "Last sync: …"; still no "hasn't polled in N hours" staleness alarm |
| N8 | Public estimate token: no expiry/revocation, no rate limit | ⛔ **Still open** | `utils/publicToken.js` unchanged (HMAC over `scope:id`, no timestamp); `public.routes.js` still mounts with no limiter |
| N9 | Void button shown on partially-paid invoices | ✅ **Fixed** | `InvoiceDetailPage.tsx:187-190` now requires `invoice.amountPaid === 0`; dialog copy updated |
| N10 | Reversed payment mislabeled "Refunded" | ✅ **Fixed** | `payments.controller.js:103-106` sets `status: "reversed"`, explicitly distinct from processor `refunded` (comment at `52-57`) |
| N11 | Manual edit could set a unit "Installed" with no customer link | ✅ **Fixed** | `serials.controller.js:150-180` rejects `status:"installed"` unless a customer link exists/accompanies it |
| N12 | Help Center described yesterday's serial workflow | ✅ **Fixed** | `content/pageHelp.ts:648-655` now documents the manual New Unit / edit / delete / status-dropdown behavior |
| N13 | Archive button was `danger`-red on the Dispatch modal only | ✅ **Fixed** | `DispatchPage.tsx:1533-1534` uses `variant="outline"`, matching Jobs list & Job Detail |
| N14 | No unsaved-changes guard when switching roles | ✅ **Fixed** | `SettingsPage.tsx:841-844` computes `isDirty`; `926-934` routes a dirty switch through `pendingRole` (confirm) |
| N15 | Pricing Tiers unreachable by dispatcher/CSR | ✅ **Fixed** | `Sidebar.tsx:112-117` adds a Pricing Tiers nav entry for `admin/manager/dispatcher/csr` |
| D3/D10 | No card/ACH processing, no invoice pay link | ⏸️ **Deferred (intentional)** | Owner deferred Stripe/integrated payments (and the payments-dependent customer portal); not scored this round |

Fourteen prior line-items, and all but two moved — most of them fully. This was
a remediation cycle, and it worked.

---

## New findings (introduced or exposed by the recent work)

Severity reflects impact on a real office user (dispatcher, CSR, owner,
bookkeeper, warehouse manager).

### 🔴 Critical

*None this round.* The issue that would have sat here for a third straight
review — the inventory/purchasing margin exposure — is closed. Say that out
loud: there is no Critical finding in this review, for the first time.

### 🟠 High

**D-N16 — The Reports page never learned about its own new permission split,
so an operational-only role sees financial tabs that quietly read $0.**
This cycle split reporting into two backend permissions — `reports.financial`
(Revenue, Customers, AR Aging, Sales, Estimate Pipeline) and
`reports.operational` (Jobs, Technicians, Inventory) — and gates each endpoint
accordingly (`reports.routes.js:17-36`). The default `dispatcher` holds
`reports.operational` **only** (`permissions.js:178-194`), and the Reports nav
link shows for either permission (`Sidebar.tsx:156-161`). But `ReportsPage`
renders **all eight tabs unconditionally** (`ReportsPage.tsx:875-884`) with no
per-tab gate. When a dispatcher clicks Revenue, the query 403s and the tab
falls back to `const chartData = data ?? []` (`ReportsPage.tsx:58`), so it
renders a chart titled "Revenue Overview ($0.00 total)" with an empty
breakdown table — **not** an access-denied message. That's worse than an
error: it silently tells an office worker the business booked $0 of revenue.
The fix pattern already exists in this codebase and is used correctly one
screen over: `SettingsPage.tsx:1324-1347` builds its tab array conditionally
(`...(can("settings.manage") ? [...] : [])`). Reports should do the same with
`reports.financial`/`reports.operational`. As-is, this is a trust bug the
remediation work itself introduced.

### 🟡 Medium

**D-N17 — Bulk deactivate/delete fires N fire-and-forget mutations and eats
every per-item error.** The new bulk actions are real, but the confirm
handlers loop and drop the promises: `for (const t of bulkDeactivate) void
del.mutateAsync(t.id)` (`PricingTiersPage.tsx:287-291`), and identically
`for (const loc of bulkDeactivate) void del.mutateAsync(loc.id)`
(`StockLocationsPage.tsx:304-308`); the Serialized Units bulk-delete path is
the same shape. In all cases the code then calls `setBulkDeactivate([])` /
`setSelectedIds([])` **synchronously**, so the dialog closes and the selection
clears before a single request has resolved. Consequences a warehouse manager
will actually hit: (1) the confirm dialog carries no `loading` state (contrast
the single-item delete at `SerializedUnitsPage.tsx:388`, which does), so
there's no "working…" feedback; (2) if 3 of 20 deletes fail (e.g. a location
still referenced by open stock, a serial that's actually installed), there is
**no toast, no partial-failure summary, nothing** — the rows just silently
remain and the operator believes the batch succeeded; (3) it hammers the API
with an unbounded parallel fan-out instead of one server-side bulk endpoint.
For a genuinely destructive action ("Delete selected"), silent partial failure
is the wrong default. This is new surface area shipped this cycle, so it's a
fair finding rather than legacy debt.

**D-N18 — Bulk actions landed on the low-traffic inventory-admin pages and
skipped the two lists a front office actually needs them on.** Where I'd reach
for bulk operations daily is **Invoices** (bulk-send the month's overdue
invoices, bulk-void a bad import) and **Jobs** (bulk-reassign a called-out
tech's day, bulk status change). Neither `JobsPage` nor `InvoicesPage` (nor
`EstimatesPage`) passes `selectable`/`bulkActions` at all — verified: the only
pages with `selectable` are Customers, Pricing Tiers, Purchase Orders,
Serialized Units, and Stock Locations. And of those, **Customers**
(`CustomersPage.tsx:308-318`) and **Purchase Orders**
(`PurchaseOrdersPage.tsx:209-219`) wire exactly one bulk action — "Export
selected" — which just re-exports rows the toolbar's own `csvFilename` export
already covers for the full list. So the pages that got *real* bulk power
(deactivate a batch of pricing tiers / stock locations) are the ones a shop
touches monthly, while the daily money-and-schedule lists got nothing. This is
the tail of #3's N2: the plumbing is now broadly adopted, but it's pointed at
the wrong tables.

**D-N19 — Public estimate links are still eternal, unrevocable, and
unthrottled.** Unchanged from #3 (now two cycles old): `utils/publicToken.js`
computes a stable HMAC over `scope:id` with no timestamp component, so an
emailed approval link works forever — after the estimate is approved,
converted, superseded, or the customer relationship ends — and there is no way
to revoke a leaked link short of rotating `JWT_SECRET` (which would break every
other token). `public.routes.js` still mounts the three estimate endpoints
with no rate limiter, unlike `/auth/login`. The 128-bit HMAC makes guessing a
specific token infeasible, so this isn't a fire, but for a document that
authorizes a customer to approve a multi-thousand-dollar estimate, "the link
never expires and can't be revoked" is a gap a real shop will eventually get
burned by.

### 🟢 Low / polish

- **D-N20 — Serials and Inventory reads are deliberately open (cost-stripped),
  which is defensible, but it's the one asymmetry left in an otherwise-tightened
  model.** `serials.routes.js:9-10` and `inventory.routes.js:14` intentionally
  leave `GET` open to any authenticated user so a technician's part/serial
  pickers work, and strip `purchaseCost`/`unitCost` for non-managers. That's a
  reasonable call and it's now well-commented — but it means a `csr` (no
  inventory permission at all) can still browse the full serial register and
  item catalog by URL. Low, because no cost/margin data leaks anymore; noting
  it only so the next reviewer doesn't re-flag it as an oversight — it's a
  choice, and the code says so.

- **D-N21 — The QuickBooks tab shows "last sync" but still can't tell me the
  Web Connector *stopped*.** `QuickBooksTab.tsx:162-165` surfaces
  `lastSyncCompletedAt` ("Last sync: never/…"), which is a real improvement
  over #3's raw-queue-only view. But there's still no affirmative
  "the connector hasn't polled in N hours" warning — a bookkeeper who relies on
  this at month-end has to *notice* that the timestamp is stale rather than
  being told. Partial fix; finish it with a staleness badge.

- **D-N22 — `RequirePermission` is applied unevenly.** It guards
  jobs-create/edit, `/suppliers`, `/purchasing(/:id)`, and
  `/inventory/locations` (`App.tsx:76-156`), which is exactly right for the
  sensitive ones. But `/payments`, `/reports`, `/pricebook`, and `/serials`
  have no wrapper, relying entirely on the backend gate to 403. For most that's
  fine (the backend now enforces it), but it means a user who reaches those by
  URL gets a broken/empty page or a silent $0 (see D-N16) instead of the clean
  "You don't have access to this page" screen the component was built to show.
  Consistency here is cheap and would make the whole app fail-friendly, not
  fail-blank.

---

## What's genuinely better (for balance)

The headline is the one that's been open since review #2: **margin and cost
data is now gated by role, end to end** — backend read guards on
purchasing/suppliers/locations, cost-field stripping on the two endpoints a
technician actually hits (item list and job parts), *and* a frontend route
guard so a hidden nav link can't be bypassed with the address bar. That was the
thing I said would keep this out of my staff's logins, and it's done properly,
with the picker-workflow exceptions thought through and commented rather than
left as accidental holes. The role defaults moved with it — `dispatcher` lost
purchasing/supplier authority (`permissions.js:178-194`), which is how a real
shop separates "who schedules" from "who spends." The money-handling
correctness fixes are exactly right: Void is hidden until payments are reversed,
reversals are labeled `reversed` not `refunded` (my bank rec will finally
match), and revenue reporting already excluded reversed payments. The
dispatch board is legitimately good now — realtime via `useDispatchRealtime`
plus true optimistic drag with snapshot-rollback and error toasts
(`hooks/useDispatch.ts:204-319`). Dark mode is fully realized (CSS-variable
palette that inverts under `.dark`, a no-flash init script, even Recharts
theming), and the keyboard-shortcut layer (`/`, `n`, `?`, ⌘/Ctrl-K) is a
real power-office nicety. This is a materially more trustworthy back-office
product than the one I reviewed in #3.

---

## Prioritized remediation roadmap

**Phase 1 — Fix the trust bug this cycle introduced**
1. Gate the Reports tabs by `reports.financial`/`reports.operational` the same
   way `SettingsPage` gates its tabs, so an operational-only role never sees a
   financial tab silently reading $0. At minimum, render an access-denied
   panel on a 403 instead of falling back to `data ?? []`. *(D-N16)*

**Phase 2 — Make destructive bulk actions safe**
2. Await the bulk mutations (`Promise.allSettled`), keep the confirm dialog in
   a `loading` state until they resolve, and surface a "X of Y done, Z failed"
   toast — or add a real server-side bulk endpoint. Don't clear the selection
   until the batch settles. *(D-N17)*
3. Put bulk actions where the front office needs them — bulk-send / bulk-void
   on Invoices, bulk-reassign / bulk-status on Jobs — and drop the redundant
   "Export selected" on Customers/POs (or make it a real action). *(D-N18)*

**Phase 3 — Finish the near-misses**
4. Add expiry + revocation to public estimate tokens (embed an issued-at /
   version and check it) and rate-limit `public.routes.js`. *(D-N19)*
5. Add a "Web Connector hasn't polled in N hours" staleness badge to the
   QuickBooks tab, not just a "last sync" timestamp. *(D-N21)*
6. Apply `RequirePermission` consistently (or a route-config-driven wrapper) so
   `/payments`, `/reports`, `/pricebook`, `/serials` fail-friendly by URL.
   *(D-N22)*

**Phase 4 — The deferred loop (owner's call, tracked not scored)**
7. Integrated card/ACH payments + an invoice pay link, and the
   payments-dependent customer portal. Explicitly deferred; listed so it stays
   on the board.

For the first time across four reviews, Phase 1 here is a bug this cycle
*created*, not one it inherited — which is the good kind of problem to have,
because it means the old ones are actually gone.

---

*Filed as an internal engineering review. Companion to `DESKTOP-REVIEW.md`,
`DESKTOP-REVIEW-2.md`, `DESKTOP-REVIEW-3.md`, and the `MOBILE-REVIEW*` series.
Nothing here is customer-facing.*
