# PulseService — Adversarial Desktop Review #3 (Front Office Perspective)

**Reviewer stance:** I run the front office at a small commercial HVAC shop. I
schedule jobs, answer the phone, quote and invoice work, take payments, order
parts, and keep the books straight. I'm judging this against ServiceTitan,
Housecall Pro, Jobber, FieldEdge, Service Fusion, and Workiz — the tools I've
actually used or demoed. I don't care how the code is organized. I care
whether I can do my job faster in this than in what I have now, and whether
I'm going to get burned by it at month-end.

**Method:** Read `DESKTOP-REVIEW-2.md` in full and verified its findings
against the live code (routes, controllers, permission catalog, sidebar nav,
and the relevant pages) rather than assuming anything carried over. Then
walked every feature called out as new since that review — job archiving,
invoice void/payment reversal, the Roles & Permissions redesign, sidebar
gating, campaign/call/message archiving, serialized units CRUD, the Help
Center, PWA update prompts, and login rate limiting.

---

## TL;DR verdict — 6.5/10 (down from 7, and I mean that as "still not go-live ready")

Some of this cycle's work is exactly what I asked for. The invoice void bug
is real and it's fixed — voiding used to be silently broken for every single
invoice (frontend called a route that didn't exist), and now there's also a
proper way to reverse a payment on a paid invoice so I can actually void it
when a customer's card gets disputed or I fat-fingered a payment. Job
archiving is clean, consistent, and finally gives me a "soft delete" I trust
— archive, restore, filtered list, same wording everywhere. The Roles &
Permissions screen went from 30 cramped checkbox tiles to a searchable
toggle list with select-all per section — genuinely nicer than what I have to
fight with in some competitors' admin screens. And the sidebar is finally
gated end-to-end instead of 5-out-of-20 items, so I'm not staring at eleven
tabs I have no rights to click into.

But the **single biggest problem flagged in the last review — any
technician, dispatcher, or CSR can hit supplier costs, PO pricing, and
job-level margins just by typing a URL — is completely untouched.** I went
and checked every route file myself: every `GET` on `/inventory`,
`/purchasing`, `/suppliers`, `/serials`, `/inventory/locations` is still open
to any logged-in user, there is still zero permission-aware route guard on
the frontend, and `getJobParts` still ships wholesale `unitCost` to anyone
who can open a job — which today is everyone. This was called the
highest-leverage fix needed for go-live in the last review, and a full cycle
went by without anyone touching it. If I'm Prime Comfort's owner and my
tech can see what I pay for a compressor next to what I billed the customer
for the same compressor, that's not a "nice to fix eventually" — that's a
reason to not put this in front of my staff yet.

On top of that, I found a few new things that would genuinely bite me at the
counter: the Void button shows up on partially-paid invoices and just throws
a raw error instead of guiding me to reverse the payment first (I'd click
through a confirm dialog for nothing); the new Serialized Units editor lets
me set a unit's status to "Installed" by hand without linking a customer or
job, which silently breaks the equipment history I'd go looking at during a
warranty call; and the brand-new Help Center already describes yesterday's
software — it tells me serialized units are "created automatically" from a
PO receipt with no mention of the manual Add/Edit/Delete buttons sitting
right next to that text.

**Compared to the field:** ServiceTitan and FieldEdge wouldn't ship a data
leak like the inventory/purchasing one, full stop — margin visibility by
role is table stakes in this category. Housecall Pro and Jobber's void/
refund flows are more guided (they tell you up front why a button is
disabled instead of letting you click through to an error). The archiving
and roles work here is genuinely competitive, maybe better than Jobber's
role management. Net: this still isn't a tool I'd trust with real customer
money and real technician access without the exposure gap closed first.

---

## Scorecard vs. `DESKTOP-REVIEW-2.md`'s findings

| # | Finding | Status |
| --- | --- | --- |
| N1 | Four of six new list pages (`PurchaseOrdersPage`, `SerializedUnitsPage`, `StockLocationsPage`, `PricingTiersPage`) hand-roll a plain `<table>`, no sort/CSV | ⛔ **Still open** — verified: all four still render a bare `<table>`/`<thead>`, no `DataTable`, no sort, no CSV, no bulk anything. `SerializedUnitsPage` got a real CRUD modal bolted onto the same plain table. |
| N2 | "Bulk actions" is one button (`Export selected`) on one page (`CustomersPage`) | ⛔ **Still open** — `bulkActions=` appears exactly once in the whole frontend, unchanged. No bulk archive/status/reassign added anywhere, including the pages that got new archive actions this cycle. |
| N3 | New inventory/purchasing `GET` endpoints have no permission gating; `getJobParts` exposes `unitCost` to anyone who can view a job; no frontend route guard | ⛔ **Still open — this is the top issue, again.** Verified line-by-line in `inventory.routes.js`, `purchasing.routes.js`, `suppliers.routes.js`, `serials.routes.js`, `stockLocations.routes.js`: every `GET` sits above `router.use(auth)` only, no `requirePermission`. `App.tsx` still has no permission-aware route wrapper — `Sidebar` gating (this cycle's actual improvement) only hides the *link*, not the *page*. A technician (permissions: `jobs.status`, `inventory.issueToJob` only) can type `/suppliers`, `/purchasing`, `/serials`, `/inventory/locations` into the address bar today and see everything. |
| N4 | Technician GPS broadcast (`PATCH /technicians/:id/location`) has no permission guard and no frontend consumer — dead code with an open write | ⛔ **Still open** — route, controller, and global `io.emit("technician:location", ...)` are unchanged; still zero references to `technician:location` anywhere in the frontend. |
| N5 | Estimate got a public approval portal; invoice never got a pay link | ⛔ **Still open** — no Stripe/pay-link code, no public invoice route found anywhere in `frontend/src` or `backend/src`. |
| N6 | `dispatcher` role has full purchasing/supplier/inventory authority, barely differentiated from `manager` on this subsystem | ⛔ **Still open** — `DEFAULT_ROLE_PERMISSIONS.dispatcher` in `permissions.js` is byte-for-byte the same list (`suppliers.manage`, `purchasing.manage`, `purchasing.receive`, `inventory.manage` all present) as last review. |
| N7 | QuickBooks sync is push-only with no "Web Connector hasn't polled" health indicator | ⛔ **Still open** — no `lastPoll`/connector-health UI found in `SettingsPage.tsx`'s QuickBooks tab. |
| N8 | Public estimate token has no expiry/revocation and no rate limit | ⛔ **Still open** — `publicToken.js` is unchanged (pure HMAC over `scope:id`, no timestamp); `public.routes.js` has no rate limiter. |
| D3/D10 | No payment processing / invoice-side customer portal | 🟡 **Unchanged** — still bookkeeping-sync only (QuickBooks), no card/ACH capture, no invoice pay link. Same as last review. |
| — | Login rate limiting (10/15min) | ✅ **Confirmed enforced** — `auth.routes.js` applies it by default; the `DISABLE_LOGIN_RATE_LIMIT` escape hatch exists but is opt-in via env var and is **not** set anywhere in the committed `docker-compose.yml`. Not a regression. |

Everything the last review flagged is either unchanged or untouched. None of
its 8 numbered findings moved. This cycle's work was additive (new features)
rather than remediative (fixing what was already flagged) — worth knowing
going in if you're deciding what "done" means for this codebase.

---

## New findings (introduced or exposed by the recent work)

**N9 — Void button is shown on partially-paid invoices, then fails with a
raw backend error instead of guiding me.** `InvoiceDetailPage.tsx` shows the
Void button whenever `status !== "void" && status !== "paid"` — which
includes `"partial"`. But `voidInvoice` on the backend unconditionally
rejects any invoice with `amountPaid > 0` ("Reverse the payment(s) before
voiding"). So on a partially-paid invoice I see a live Void button, click it,
confirm a dialog that says nothing about existing payments ("Are you sure you
want to void this invoice? This action cannot be undone."), and only *then*
get told to go reverse a payment first. At the counter, with a customer on
the phone, that's a wasted click and a moment of "wait, did it void or not?"
— exactly the kind of friction that makes office staff stop trusting a
button's state. The fix is one extra clause on the frontend condition
(`invoice.amountPaid === 0`) plus wording in the confirm dialog itself.

**N10 — Reversing a payment relabels it "Refunded" even when no money was
ever refunded.** `payments.controller.js`'s `reversePayment` sets
`status: "refunded"`, and that's the exact string shown everywhere —
Payment History, the standalone Payments list, presumably any future report
keyed off `paymentStatus`. But the UI action is called "Reverse Payment" and
its own confirm dialog explains it as "the invoice needs to be voided or the
payment was recorded in error" — i.e., a bookkeeping correction, not a
refund to the customer's card. If I reverse a cash payment that was logged
against the wrong invoice, "Refunded" on my Payments list is simply wrong —
no cash left the building. This is a real audit-trail wording problem for a
bookkeeper reconciling against a bank statement: "Refunded" implies money
movement that may not have happened. Suggest a distinct `reversed` status
(or at minimum a label override) separate from an actual processor refund.

**N11 — Manually editing a Serialized Unit's status to "Installed" bypasses
the Install flow entirely and corrupts the equipment record.** The generic
`PUT /:id` used by `SerializedUnitFormModal`'s edit form accepts *any*
`status` value from the dropdown, including `installed`, with no requirement
to also supply `installedCustomerId`/`installedJobId`/`installedLocationId`
(those only get set by the dedicated `POST /:id/install` action). So I can
open a unit, flip its status dropdown to "Installed," hit Save, and end up
with a unit that reads "Installed" everywhere but is linked to no customer
and no job. The next time someone pulls up that customer's equipment/asset
history looking for it (e.g. during a warranty claim), it won't be there —
it'll just show up as an orphaned "installed" unit on the Serialized Units
list. The status dropdown in the manual edit form should exclude
`installed`/`voided`-by-install-flow states, or the backend should require
the install fields whenever status is being set to `installed` outside the
`/install` action.

**N12 — The new Help Center already documents a feature that no longer
matches the page it's attached to.** `serialsHelp` in
`frontend/src/content/pageHelp.ts` says: "Serialized units are created
automatically when a serialized inventory item is received against a
purchase order" — with zero mention of the "New Unit" manual create/edit/
delete UI that shipped this same cycle right there on `SerializedUnitsPage`.
Same gap in `marketingHelp`: no mention that campaigns can now be archived/
restored, or that Calls and Messages have a delete action. For a feature
whose entire pitch is "helps office staff who've never used this before
understand what they're looking at," having it describe an earlier version
of the page is worse than having no help at all — it actively teaches the
wrong workflow to a first-time user in their first five minutes. This needs
a checklist step ("update `pageHelp.ts`") attached to any feature PR that
touches a page with existing help content, or it will keep drifting.

**N13 — The Archive button changes color/severity depending on which screen
I'm standing on.** Same "archive job" action, three places: `JobsPage.tsx`
row action uses a neutral `IconButton` (no `variant`), `JobDetailPage.tsx`
uses `variant="outline"` (neutral outline button), but `DispatchPage.tsx`'s
job-detail modal renders the **identical, equally-reversible** action as
`variant="danger"` — a red button, the same visual weight the app uses for
permanent deletes elsewhere (e.g. "Delete campaign"). Archiving is explicitly
the *safe, undo-able* alternative to deleting (the confirm-dialog copy says
so, consistently, in all three places) — but the button styling on the
Dispatch board tells me the opposite, which is exactly the kind of visual
inconsistency that makes a fast-moving office worker hesitate or misjudge
severity ("wait, is this the delete one?").

**N14 — No unsaved-changes warning when switching roles in the new Roles &
Permissions editor.** `RolesTab`'s role `<select>` calls `setDraft(...)`
directly on change with no dirty-check. Toggle five permissions off for
`dispatcher`, get pulled away mid-edit (phone rings — this is a front-office
job), come back, switch to review `csr` instead, then switch back to
`dispatcher` — your five toggles are gone, silently, with no prompt at any
point. The old checkbox-tile version had the exact same problem, so this
isn't a regression, but a redesign of this screen was exactly the moment to
fix it, and it wasn't.

**N15 — Pricing Tiers is still a dead end for the two roles who touch
tier-priced line items daily.** Confirmed by reading the route: Pricing
Tiers has no sidebar entry of its own — it only exists as a button inside
`PricebookPage.tsx`, and `PricebookPage` itself is gated behind
`pricebook.manage`, which `dispatcher` and `csr` don't hold by default. A
dispatcher building an estimate for a tier-priced commercial customer has no
discoverable way to check *why* a line item priced the way it did, or to add
a one-off override, without either memorizing the raw URL
(`/pricebook/pricing-tiers`) or getting an admin to do it. This was flagged
as an "open question" in the last review; it's now a confirmed, unresolved
gap, not a question.

---

## What's genuinely better (for balance)

The invoice void fix matters more than any single line item in this review
— a completely broken void button (silently 404ing under the old `PATCH`
call) is the kind of bug that would have gotten this software fired by a
real bookkeeper the first time she needed to fix a billing mistake and
couldn't. Payment reversal is well-modeled on the backend: it correctly
recalculates `amountPaid`/`balance` off the invoice total (not just
subtracting blindly), correctly reopens the invoice's status out of "paid,"
and correctly blocks voiding while a payment is still active — the ordering
(reverse, then void) is enforced server-side, not just suggested in the UI
copy. Job archiving is a genuinely well-executed feature: consistent icon,
consistent non-destructive confirm-dialog wording ("nothing is deleted...
you can restore it anytime"), and it reaches every place a job can be
deleted from (Jobs list, Job Detail, Dispatch board), with the last of those
now properly permission-gated where it used to be an unguarded hard delete.
Campaign archiving and Call/Message delete inherited that same pattern
cleanly — same icons, same wording style, same tone. The Roles &
Permissions redesign is a real quality-of-life win: search-to-filter across
~30 permissions beats scrolling a wall of checkboxes, and per-section
select-all/clear-all is exactly the shape of control an admin actually
wants. Revenue reporting correctly excludes reversed/refunded payments from
totals (`status: "completed"` filter, verified in `reports.controller.js`)
— the number on the Dashboard won't lie to me because someone reversed a
bad entry. The PWA update-prompt (self-registered service worker, "Reload"
toast on new deploy) is a sensible fix for the specific failure mode of a
long-lived office browser tab silently running stale JS for weeks.

---

## Prioritized remediation roadmap

**Phase 0 — This has to happen before this touches real customer money or a
real hourly technician's login**
1. Gate the inventory/purchasing/supplier/serials/stock-location `GET`
   routes behind at minimum a view-level permission, and strip `unitCost`/
   supplier pricing out of `getJobParts`'s technician-visible shape. *(N3,
   unchanged from last review — now two cycles old)*
2. Add a permission-aware route guard on the frontend so a role without the
   relevant `.manage` permission can't load those pages by URL at all, not
   just lose the sidebar link. *(N3)*
3. Finish or delete the technician-location broadcast endpoint — it's an
   unguarded write with zero consumers. *(N4, unchanged)*

**Phase 1 — Money-handling correctness/trust**
4. Don't show Void on invoices with `amountPaid > 0` (i.e. exclude
   `"partial"`, not just `"paid"`/`"void"`); update the confirm-dialog copy
   to say what will actually happen. *(N9)*
5. Separate "reversed/corrected" from an actual "refunded" payment status, or
   at minimum relabel it so a bookkeeper reconciling against a bank
   statement isn't misled. *(N10)*
6. Require the install fields (`installedCustomerId`/`installedJobId`) as a
   condition of setting a serialized unit's status to `installed` through
   the generic edit form, not just through `/install`. *(N11)*

**Phase 2 — Close the role-model gaps that affect daily front-office work**
7. Give Pricing Tiers its own gated nav entry reachable by `dispatcher`/`csr`
   (a read-only view at minimum), instead of nesting it behind
   `pricebook.manage`. *(N15)*
8. Split purchasing/supplier/inventory-adjust authority out of the blanket
   `dispatcher` default. *(N6, unchanged)*

**Phase 3 — Consistency & polish**
9. Normalize the Archive button's severity styling across Jobs/Dispatch (pick
   one: neutral/outline, since it's explicitly framed as non-destructive
   everywhere else). *(N13)*
10. Add a dirty-check/confirm when switching roles mid-edit in the
    Permissions screen. *(N14)*
11. Update `pageHelp.ts` for Serialized Units and Marketing to reflect the
    features that shipped alongside the Help Center itself. *(N12)*
12. Port the four remaining plain-`<table>` pages onto the shared
    `DataTable`, and either build real bulk actions or stop implying they
    exist broadly. *(N1, N2 — unchanged)*

Phase 0 is a repeat from the last review, not a new discovery — it survived
an entire development cycle untouched while unrelated features shipped
around it. That's the fact I'd put in front of whoever owns this roadmap
before green-lighting anything else.

---

*Filed as an internal engineering review. Companion to `DESKTOP-REVIEW.md`,
`DESKTOP-REVIEW-2.md`, `MOBILE-REVIEW.md`, `MOBILE-REVIEW-2.md`, and
`MOBILE-REVIEW-3.md`. Nothing here is customer-facing.*
