# PulseService — Manual QA Checklist

A hands-on checklist for verifying every role and feature. Tick boxes as you go.
Log in at **http://localhost:8080** (the nginx path). Keep DevTools → Console +
Network open to catch errors/500s.

> Fresh slate: `docker compose down -v && docker compose up --build -d` re-seeds
> demo data. Seeded logins: `admin@pulseservice.com` / `admin123`; and
> `dispatcher@`, `tech1@`, `tech2@`, `tech3@`, `csr@` (all `pass123`).
> `manager` and `exec` are **not** seeded — create them in step 1.

---

## 1. Account provisioning (as admin)

- [ ] Log in as `admin@pulseservice.com` / `admin123`
- [ ] Settings → Users → **Invite User** → create `manager@pulseservice.com` (Manager); copy the one-time temp password
- [ ] Invite `exec@pulseservice.com` (Executive); copy temp password
- [ ] Invited user shows in the Users list with the correct role + Active status
- [ ] Log in as the new manager; Settings → Account → **Change Password** succeeds
- [ ] Log back in with the new password (old temp password no longer works)
- [ ] As admin, **Reset Password** for a user → returns a new one-time password
- [ ] As admin, **Edit** a user's role and Active status → saved
- [ ] Last-admin guard: as admin, try to demote/deactivate **yourself** → blocked with an error

## 2. Role access matrix (log in as each role and confirm)

Expected landing / sidebar / settings visibility:

- [ ] **admin** — lands on Dashboard; sees Payments + Reports; Settings has Account/Company/Billing/Users/Roles/Business Units/Activity Log/QuickBooks
- [ ] **exec** — Dashboard; sees Payments + Reports; Settings shows Account + Activity Log only
- [ ] **manager** — Dashboard; Payments + Reports; Settings shows Account/Company/Billing/Business Units/Activity Log/QuickBooks (no Users/Roles)
- [ ] **dispatcher** — Dashboard; Payments + Reports; Settings shows Account only
- [ ] **csr** — Dashboard; Payments visible, **Reports hidden**; Settings shows Account only
- [ ] **technician** — lands on **My Day**; **Payments + Reports hidden**; Settings shows Account only

Permission enforcement (should SUCCEED ✅ / be BLOCKED ⛔ with a 403 toast):

- [ ] technician clicks "New Customer" and saves → ⛔ 403 (server-enforced even though the button shows)
- [ ] csr creates a customer → ✅
- [ ] csr tries to delete a customer → ⛔ (no delete for csr)
- [ ] dispatcher reassigns a job on the dispatch board → ✅
- [ ] csr reassigns on the dispatch board → ⛔
- [ ] manager voids an invoice → ✅; dispatcher voids an invoice → ⛔
- [ ] exec opens Reports (revenue) → ✅; dispatcher opens revenue report → ⛔ (ops reports only)
- [ ] non-admin cannot reach Users/Roles (tabs hidden; direct API call 403)
- [ ] **technician can issue a part / install a serialized unit** on one of their own jobs (Job Detail → Materials & Equipment) → ✅ (new `inventory.issueToJob` permission)
- [ ] technician still **cannot** create/edit inventory items, adjust stock, or transfer stock between locations → ⛔ (that stays `inventory.manage`-only)
- [ ] technician cannot reach Suppliers, Purchase Orders, Stock Locations (admin), Pricing Tiers, or QuickBooks Settings

## 3. Feature walkthrough (as admin or manager, unless noted)

### Customers
- [ ] Create a customer (first/last/phone) → success
- [ ] Create with **phone left blank** → clean "Missing required field" message (not a crash)
- [ ] Edit customer; add a location; add a contact
- [ ] Assign a **pricing tier** to a customer (Customer form → tier dropdown)
- [ ] Delete a customer

### Jobs
- [ ] Create a job (customer + summary required)
- [ ] Assign a technician
- [ ] Advance status through the lifecycle (new → scheduled → … → completed)
- [ ] **Stale-edit conflict**: open the same job for edit in two browser tabs/sessions, save the first, then try to save the second unchanged → **409 "updated by someone else" error**, not a silent overwrite
- [ ] After the 409, refresh/reopen the job → the second edit can now be saved cleanly against the latest data
- [ ] Delete a job

### Dispatch & Scheduling
- [ ] Dispatch board loads with Day / Week / Month view toggle
- [ ] **Month view** shows every technician's jobs company-wide (this is the "company-wide calendar" from the client's requirements — confirm no separate calendar page is needed)
- [ ] Drag/reassign a job to another technician (day view) → board updates live for a second logged-in office user (real-time socket push)
- [ ] Drag a job to a different day (week/month view) → reschedules correctly, preserving time-of-day/duration
- [ ] (If push enabled) assigned tech receives a notification

### Estimates → Invoices → Payments
- [ ] Create estimate → add line items via the **pricebook quick-add picker** → confirm price reflects the customer's assigned **pricing tier** (not the base price) if one is set
- [ ] Send estimate → approve (or use the public approval link — `/estimate/:id`, no login)
- [ ] Convert approved estimate to invoice
- [ ] Record a payment → invoice balance updates
- [ ] Void an invoice (admin/manager only)

### Pricebook & Pricing Tiers
- [ ] Pricebook: create/edit category + item
- [ ] Settings/Pricebook → **Pricing Tiers**: create a tier, add a per-item override (fixed price or % discount)
- [ ] Assign the tier to a customer, then open a new estimate/invoice for that customer → quick-add picker shows the **tier-adjusted price**, not the base pricebook price
- [ ] Remove the override → price reverts to base

### Inventory
- [ ] **Stock Locations** (admin): create a warehouse location and a truck location linked to a vehicle
- [ ] Inventory list: create an item (SKU, cost, unit), confirm it appears with **Decimal** cost/qty (not floating-point rounding artifacts)
- [ ] Adjust stock at a location; transfer stock between two locations; confirm both locations' on-hand quantities update correctly
- [ ] View an item's transaction history / cost history — confirm the **perpetual weighted-average cost** recalculates correctly after a receipt at a different unit cost
- [ ] **CSV import**: import a small inventory CSV, confirm items/quantities land correctly (both by total and by individual item, matching the client's ~1k-item dataset shape)
- [ ] **Reorder suggestions**: drop an item's on-hand below its reorder point → item appears in the reorder-suggestions view
- [ ] Low-stock rows are visually flagged in the list

### Suppliers & Purchase Orders
- [ ] Suppliers: create a supplier record; add supplier-specific pricing for an inventory item
- [ ] Confirm the **average-cost-across-suppliers** behavior the client asked for (price averaging) shows sensibly when an item has multiple supplier price records
- [ ] Purchase Orders: create a PO against a supplier with line items, linked to a job (POs should be linkable to jobs)
- [ ] Send/approve the PO (status transitions correctly)
- [ ] **Receive** the PO (full and partial receipt) → confirm received quantities post into the correct stock location and the item's WAC updates
- [ ] Close/complete the PO

### Serialized Units
- [ ] Register a serialized unit (linked to an inventory item) as in-stock
- [ ] Install the unit onto a customer + job (Serialized Units page picker, and again from Job Detail → Materials & Equipment → **Install unit**)
- [ ] Confirm installed units show correctly on the customer's equipment/asset history and on the job's Materials card
- [ ] As **technician** (tech1): install a unit from a job they're assigned to → succeeds with the new permission

### Cycle Count
- [ ] Start a guided cycle count for a stock location (warehouse or truck)
- [ ] Walk through counting a few items, enter counted quantities, confirm variances are shown before committing
- [ ] Commit the count → on-hand quantities update and a cost/quantity adjustment transaction is recorded

### QuickBooks Desktop Sync (admin/manager only)
- [ ] Settings → QuickBooks tab: review connection status (should show disconnected/not-yet-configured in a fresh environment — this needs a real bookkeeper session to fully validate)
- [ ] Run the mock Web Connector harness (`backend/scripts/mock-webconnector.js`) against a seeded invoice/customer/payment and confirm the sync queue reflects success
- [ ] Confirm sync queue view shows customer → invoice → payment dependency gating (an invoice won't sync before its customer does, etc.)

### Service Agreements
- [ ] Agreements: create, schedule a visit, complete a visit

### Equipment
- [ ] Equipment: create/edit; delete (management only)

### Marketing
- [ ] Campaigns: create a campaign
- [ ] Calls: log a call (inbound/outbound), confirm it appears in the list with correct direction icon
- [ ] **Messages** (new): log a message (SMS/email, inbound/outbound) against a customer; confirm it appears in the Messages tab list with correct channel badge; delete a message

### Reports
- [ ] Revenue / jobs / technicians / customers reports all render
- [ ] Inventory reports (value on hand, usage, reorder) render with correct totals

### Roles & Audit (as admin)
- [ ] Settings → Roles & Permissions: toggle a permission for `dispatcher`, save
- [ ] Re-login as dispatcher → the change is in effect
- [ ] Confirm the new **"Issue parts & install units on a job (field use)"** permission appears in the Inventory group of the matrix and can be granted/revoked independently of "Manage items, adjust & transfer stock"
- [ ] Settings → Activity Log: your create/update/delete/login actions are recorded

### Data tables (any list page)
- [ ] Click a column header → sorts asc, click again → desc
- [ ] **Export CSV** downloads the current rows
- [ ] Save a **View**, change filters, re-apply the saved View
- [ ] Customers: select rows → **Export selected**

## 4. Technician field workflow (as tech1/tech2/tech3 — the mobile-primary role)

- [ ] **My Day**: today's assigned jobs listed in scheduled order
- [ ] **Navigate** opens maps to the job address (correct map app for the platform — Apple Maps on iOS, Google Maps elsewhere)
- [ ] **Call** opens the dialer
- [ ] Day stepper (prev / Today / next) works
- [ ] Error state shows if offline (distinct from a genuinely empty day)
- [ ] Open a job from My Day → Job Detail loads with a single-column, thumb-friendly layout
- [ ] Clock in / clock out on a job; confirm time entry is recorded
- [ ] **Materials & Equipment card**: as a tech, confirm **Add part** and **Install unit** buttons are visible (new permission)
- [ ] **Add part**: pick a part, confirm the "From location" defaults to your own assigned truck; issue it, confirm it appears in "Parts used" with a suggested price
- [ ] Confirm you **cannot** delete/reverse a part you added (trash icon should be hidden — that stays office-only) — call this out if it's confusing UX and should instead show a disabled/explained state
- [ ] **Install unit**: install a serialized unit from the job, confirm it appears under "Installed serialized units"
- [ ] Update job status from the job detail screen
- [ ] Confirm you can still **not** reach Suppliers, Purchase Orders, Stock Locations admin, Pricing Tiers, or Marketing/Messages from the "More" drawer

## 5. Mobile / PWA (DevTools device toolbar or a real phone)

- [ ] Bottom tab bar appears; technician sees My Day/Jobs/Dispatch, office roles see Home/Jobs/Invoices; **More** opens the drawer
- [ ] List pages render as stacked **cards** (no sideways scroll)
- [ ] Card toolbar **Sort** control works on mobile
- [ ] Focusing a form field does **not** zoom the page (iOS) — **known issue as of Mobile Review #3**: verify this specifically on the Job Detail "Add part"/"Install unit" modals and any plain `<input>`/`<select>`, since the shared 16px-on-touch rule is currently being overridden by explicit `text-sm` classes
- [ ] Forms and modals are single-column, including the new Add Part / Install Unit / Cycle Count screens
- [ ] Notch/home-indicator safe areas respected (notched device preset)
- [ ] Photo lightbox: Escape closes, focus is trapped
- [ ] (Installed PWA) "Add to Home Screen" works; app opens standalone

## 6. Web push (needs VAPID keys set on the backend)

- [ ] `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; restart backend
- [ ] As a tech: Notifications page → **enable** notifications (grant permission)
- [ ] Admin assigns that tech a job → push arrives with the tab backgrounded
- [ ] Tapping the notification opens the job

## 7. Known issues to specifically re-verify (from Adversarial Review round 3)

These were flagged in `DESKTOP-REVIEW-2.md` and `MOBILE-REVIEW-3.md` — confirm they're still present (or newly fixed) rather than assuming either way:

- [ ] **Desktop — top finding**: as a **technician**, hit the inventory/purchasing GET endpoints directly (e.g. supplier list, PO detail, an item's cost history, `/inventory/jobs/:jobId/parts`) — confirm whether wholesale costs/margins are visible to a role that shouldn't see them. If still open, this needs a read-side permission (or a lighter "inventory.view" tier) before go-live.
- [ ] **Mobile — top finding**: on an iPhone (or iOS simulator), tap into several form inputs across the app (not just one) — confirm whether the page zooms on focus. If still reproducible, the fix is in the shared `Input`/`Select` components' `text-sm` class, not the media query itself.
- [ ] Desktop: confirm which of the six new inventory/purchasing pages use the shared sortable/CSV `DataTable` vs. a bespoke list, and whether that inconsistency is acceptable for launch.
- [ ] Mobile: confirm `JobMaterialsCard`/`AddPartModal`/`InstallSerialModal`/`CycleCountPage` genuinely work end-to-end on a real phone-sized screen, not just "the permission now allows it."

## 8. Stability & edge cases

- [ ] No red console errors / unexpected 500s during any flow
- [ ] Fail login ~11 times quickly → **429 "too many attempts"** (rate limiting)
- [ ] Forcing a page error shows the **Error Boundary** ("Something went wrong / Try again"), not a white screen
- [ ] Logging out clears the session; protected routes redirect to /login
- [ ] Automated tests still pass: `cd backend && npm test` and `cd frontend && npm run build`

---

*Internal QA aid. Reset with `docker compose down -v && docker compose up --build -d`, then*
*`docker exec pulseservice-backend node prisma/seed.js` if you only need fresh data without a full rebuild.*
