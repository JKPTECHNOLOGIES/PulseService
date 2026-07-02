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

- [ ] **admin** — lands on Dashboard; sees Payments + Reports; Settings has Account/Company/Billing/Users/Roles/Business Units/Activity Log
- [ ] **exec** — Dashboard; sees Payments + Reports; Settings shows Account + Activity Log only
- [ ] **manager** — Dashboard; Payments + Reports; Settings shows Account/Company/Billing/Business Units/Activity Log (no Users/Roles)
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

## 3. Feature walkthrough (as admin or manager)

### Customers
- [ ] Create a customer (first/last/phone) → success
- [ ] Create with **phone left blank** → clean "Missing required field" message (not a crash)
- [ ] Edit customer; add a location; add a contact
- [ ] Delete a customer

### Jobs
- [ ] Create a job (customer + summary required)
- [ ] Assign a technician
- [ ] Advance status through the lifecycle (new → scheduled → … → completed)
- [ ] Delete a job

### Dispatch
- [ ] Drag/reassign a job to another technician → board updates live
- [ ] (If push enabled) assigned tech receives a notification

### Estimates → Invoices → Payments
- [ ] Create estimate → send → approve
- [ ] Convert approved estimate to invoice
- [ ] Record a payment → invoice balance updates
- [ ] Void an invoice (admin/manager only)

### Other modules
- [ ] Agreements: create, schedule a visit, complete a visit
- [ ] Inventory: adjust, receive, view transactions; low-stock rows highlight
- [ ] Pricebook: create/edit category + item
- [ ] Equipment: create/edit; delete (management only)
- [ ] Marketing: create a campaign; log a call
- [ ] Reports: revenue / jobs / technicians / customers all render

### My Day (as tech1)
- [ ] Today's assigned jobs listed in scheduled order
- [ ] **Navigate** opens maps to the job address
- [ ] **Call** opens the dialer
- [ ] Day stepper (prev / Today / next) works
- [ ] Error state shows if offline (distinct from an empty day)

### Roles & Audit (as admin)
- [ ] Settings → Roles & Permissions: toggle a permission for `dispatcher`, save
- [ ] Re-login as dispatcher → the change is in effect
- [ ] Settings → Activity Log: your create/update/delete/login actions are recorded

### Data tables (any list page)
- [ ] Click a column header → sorts asc, click again → desc
- [ ] **Export CSV** downloads the current rows
- [ ] Save a **View**, change filters, re-apply the saved View
- [ ] Customers: select rows → **Export selected**

## 4. Mobile / PWA (DevTools device toolbar or a real phone)

- [ ] Bottom tab bar appears; technician sees My Day/Jobs/Dispatch, office roles see Home/Jobs/Invoices; **More** opens the drawer
- [ ] List pages render as stacked **cards** (no sideways scroll)
- [ ] Card toolbar **Sort** control works on mobile
- [ ] Focusing a form field does **not** zoom the page (iOS)
- [ ] Forms and modals are single-column
- [ ] Notch/home-indicator safe areas respected (notched device preset)
- [ ] Photo lightbox: Escape closes, focus is trapped
- [ ] (Installed PWA) "Add to Home Screen" works; app opens standalone

## 5. Web push (optional — needs VAPID keys set on the backend)

- [ ] `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; restart backend
- [ ] As a tech: Notifications page → **enable** notifications (grant permission)
- [ ] Admin assigns that tech a job → push arrives with the tab backgrounded
- [ ] Tapping the notification opens the job

## 6. Stability & edge cases

- [ ] No red console errors / unexpected 500s during any flow
- [ ] Fail login ~11 times quickly → **429 "too many attempts"** (rate limiting)
- [ ] Forcing a page error shows the **Error Boundary** ("Something went wrong / Try again"), not a white screen
- [ ] Logging out clears the session; protected routes redirect to /login
- [ ] Automated tests still pass: `cd backend && npm test` and `cd frontend && npm test`

---

*Internal QA aid. Reset with `docker compose down -v && docker compose up --build -d`.*
