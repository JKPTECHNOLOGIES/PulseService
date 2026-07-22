# PulseService — Adversarial Mobile Review

**Reviewed at:** commit `9cbf693` (2026-07-22)
**Prior reviews:** `MOBILE-REVIEW.md` through `MOBILE-REVIEW-6.md` (last scored 8/10 at
commit `409d98b`) — **all six deleted** and superseded by this document.
**Reviewer stance:** A technician, phone-only, judging whether the screen in hand helps
finish the call or fights it. Also put on the warehouse-manager hat for purchasing/
inventory screens. Assumed every item the prior review called "fixed" had regressed
until independently re-verified against the live code — no credit given without a
fresh citation.
**Method:** Re-checked all five items `MOBILE-REVIEW-6.md` left open against current
code, read the full offline-mutation queue and PWA build output (ran a real
`npm run build` and inspected the generated manifest/service worker rather than trusting
`vite.config.ts` intent), cross-checked the `technician` role's permission set against
every write action reachable from `BottomTabBar` → `MyDayPage` → `JobDetailPage` →
`DispatchPage`/`JobsPage`, and queried the live database directly for real row counts
instead of assuming CSV-import scale.

---

## TL;DR verdict — 7.5/10 (down slightly from 8)

Give credit where it's due: **all five items left open by the last review are now
fixed** (four fully, one partially) — the office/mobile team closed that entire
roadmap. The offline mutation queue in particular was expanded well beyond what was
asked (7 actions now queue and replay, not just the 2 originally flagged), the Leaflet
dark-mode fix is a real CSS-variable fix rather than a patch, and the photo-delete and
barcode-scanner fixes both hold up under a skeptical re-read.

The score still dips slightly because the same *class* of bug that got fixed on Job
Detail's Assign button turned up freshly on two screens reachable from a technician's
phone that weren't in scope last round: the Jobs list ("New Work Order"/"Edit" render
unconditionally for a role that can't use them) and, more seriously, **the Dispatch
board's drag-and-drop is fully reachable and completely ungated for a technician** —
they can drag a job card, watch it optimistically move, and then watch it silently
snap back with a generic "failed" toast, because the route has no frontend guard and
technicians hold neither `dispatch.manage` nor `jobs.edit`. On top of that, the offline
story — while broader than before — only reliably covers literal airplane-mode/no-signal
conditions; a flaky-but-technically-connected basement or crawlspace (the actual
day-to-day condition this feature exists for) still produces an immediate failed
mutation with only a "Dismiss" option, not a queued retry.

**Compared to the field:** installability, offline queuing, dark mode, tap targets, and
iOS input handling are all now genuinely competitive with the name-brand apps. What's
left is closing two ungated-button traps and making the offline story match its own
marketing for anything less clean than a hard connectivity cutoff.

---

## Part 1 — Re-verification of `MOBILE-REVIEW-6.md`'s open items

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| M6-1 | "Assign" (and "Update Status") on Job Detail had no `<Can>` wrapper — a technician could open the modal and eat a 403 | ✅ **Fixed** | `JobDetailPage.tsx:265` wraps Update Status in `<Can permission="jobs.status">`; `:530` wraps Assign in `<Can permission="jobs.assign">`; both match the backend gate (`jobs.routes.js`) |
| M6-2 | Offline queue only covered `clockIn`/`clockOut`; part-issue and status-change were silently lost on reload | ✅ **Fixed, and expanded** | `lib/offlineMutations.ts` now registers keyed defaults for `issueToJob` (`useInventory.ts:251`) and `updateJobStatus` (`useJobs.ts:129`) — plus `updateJob`, `createJob`, `installSerializedUnit`, `uninstallSerializedUnit`, and `reverseTransaction`, none of which were asked for. Replay fires via `queryClient.resumePausedMutations()` on cache restore (`main.tsx:78-81`) |
| M6-3 | Leaflet map popups illegible in dark mode | ✅ **Fixed** | `index.css` adds `.dark .leaflet-popup-content-wrapper`/`-tip` overrides; verified the popup body text itself re-themes too, since its Tailwind gray classes resolve through CSS variables that invert under `.dark` — not just the bubble background |
| M6-4 | Photo delete button was hover-only, invisible on touch | ✅ **Fixed for phone-portrait** | `AttachmentGallery.tsx` uses `opacity-100 sm:opacity-0 sm:group-hover:opacity-100` — always visible below the `sm` (640px) breakpoint. Caveat: this is a *width* heuristic, not an input-type check, so a touch device in landscape at ≥640px falls back to hover-only again with no `pointer: coarse` fallback — low residual risk for the primary phone-portrait case |
| M6-5 | Barcode scanner matched only exact internal SKU, so real-world scans mostly failed | 🟡 **Partially fixed** | `AddPartModal.handleScan` now falls back through internal SKU → vendor SKU → loose substring match — a real improvement. But there is still **no barcode/UPC field anywhere in the schema**; the vendor-SKU field it now also checks is a free-text distributor code an office user manually types in, not something populated by scanning or by the QuickBooks import scripts. A manual-entry fallback exists so the flow degrades gracefully, but most real box barcodes will still not match anything today |

---

## Part 2 — New / reintroduced findings

### 🟠 High

**H1 — `JobsPage` reintroduces the exact pattern just fixed on Job Detail: "New Work Order" and "Edit" render unconditionally for a role that can't use them, and it's reachable on a phone.**
`JobsPage.tsx` renders its "New Work Order" button (and empty-state action) and its "Edit job" row icon with no `<Can>`/`can()` guard at all, unlike the sibling `jobs.delete`-gated archive/restore buttons on the same page. A technician (`technician` role holds only `jobs.status` + `inventory.issueToJob`) lacks `jobs.create`/`jobs.edit` for both actions. The routes themselves *are* wrapped in `RequirePermission` (`App.tsx`), so tapping through does show a friendly "you don't have access" screen rather than a raw 403 — an improvement over the old pattern — but it's still a dead-end tap the page itself should just hide, exactly like every other action on this same page and on Job Detail already does. Confirmed reachable on a phone: `DataTable`'s mobile card view falls back to the same row actions when no `renderMobileActions` is supplied, and `JobsPage` doesn't supply one, so the Edit pencil renders on every job card a technician sees on the "Work Orders" bottom tab.

**H2 — Dispatch board drag-and-drop reassign/reschedule is fully reachable and completely ungated for a technician, with an optimistic-then-silently-fail UX.**
`DispatchPage.tsx` has no permission checks anywhere around its drag handlers — `handleDragEnd` always calls the reassign/reschedule mutation regardless of role. Backend: reassign requires `dispatch.manage`, reschedule (via job update) requires `jobs.edit` — a technician holds neither. `/dispatch` is visible in the "More" drawer for anyone holding any field-ops permission (technicians qualify via `jobs.status`), and the route has **no** `RequirePermission` wrapper at all, unlike purchasing/vendors/stock-locations which do. Both mutations optimistically move the card on the board, then roll back and show a generic "Failed to update assignment"/"Failed to reschedule job" toast on the inevitable 403. This is the identical UX-trap shape M6-1 called out — flicker, then fail, no explanation — just relocated to a screen that wasn't in scope last round. The board also has zero mobile-specific layout (no responsive breakpoint handling anywhere in the file), so a technician who lands here gets the full desktop horizontal-timeline/grab-to-pan experience on a phone screen, on top of the permission trap.

### 🟡 Medium

**M1 — The offline queue only engages on the browser's binary online/offline signal, not on an actual slow/hung request — which is the realistic field failure mode, not a clean airplane-mode cutoff.**
The axios instance sets no request `timeout`, so a request over a weak-but-not-"offline" cellular connection (a normal condition in an HVAC mechanical room or basement) can hang rather than fail or queue. TanStack Query's mutation auto-pause only engages when the browser already reports offline at dispatch time — it doesn't retroactively pause an in-flight request that times out while still nominally "online," and mutations aren't configured to retry. Compounding this, `OfflineIndicator` only offers a one-tap **Retry** for failed *uploads*; a failed JSON mutation (issue a part, change a status) only gets **Dismiss**, so the technician has to manually redo the whole action from scratch. Net effect: the "queue offline, replay on reconnect" story reliably covers literal airplane mode, but not the flakier, more common field condition it's actually meant for.

**M2 — Inventory list has no pagination or virtualization — a latent performance risk once the real parts catalog is imported.**
Both the backend list endpoint and the frontend hook fetch/render the entire inventory table in one shot with no `take`/`skip`/virtualization, unlike Jobs/Customers which are paginated. The current seeded database only has 10 `InventoryItem` rows (confirmed via a direct query against the live container), so this isn't visible today — but the commit history explicitly describes importing "a real parts/equipment catalog from QuickBooks export," and a real HVAC distributor catalog commonly runs several hundred to a few thousand SKUs. `/inventory` is reachable by a technician (they hold `inventory.issueToJob`), so this is worth fixing before that larger import lands on this screen rather than after someone's phone chokes on it mid-job.

**M3 — The "access denied" fallback sends a technician somewhere that isn't built for them.**
`RequirePermission`'s denial screen always offers "Back to Dashboard," but `/dashboard` isn't in a technician's own navigation (their home redirect goes to `/my-day` instead) — a technician who trips H1's dead-end and taps the recovery link lands on the office financial dashboard, not their own agenda. Minor, but avoidable.

**M4 — Attachment delete has no permission gate (shared finding with the desktop review), and it's just as reachable from a phone.**
Covered in full in `DESKTOP-REVIEW.md` (M5) — noting here only because it applies equally to the mobile photo-capture workflow: a technician can delete any photo on any job company-wide, not just ones they took, since the delete route checks only `auth`, no role/ownership tier.

### 🟢 Low / polish (verified sound — no action needed)

- **PWA installability is genuinely solid.** A real production build was inspected directly: `manifest.webmanifest` has correct `name`/`short_name`/`start_url`/`display: "standalone"`/`theme_color`/icon set (64/192/512 + a dedicated maskable icon); `index.html` includes `apple-mobile-web-app-capable` and a pre-paint theme script to avoid a flash of the wrong theme; the update-prompt flow is real (`registerType: "prompt"` paired with a manual "Reload" toast, not a silent swap mid-task); Workbox caching is sensibly tiered (cache-first for images, stale-while-revalidate for metadata, network-first with a 5s timeout for API reads).
- **iOS zoom-on-focus is handled globally**, not per-component — a single unlayered `@media (max-width:640px)` rule forces 16px inputs everywhere, deliberately placed to beat Tailwind's smaller text utilities in the cascade.
- **44px tap targets are consistent** across `Header.tsx`, `MyDayPage.tsx`, and `BottomTabBar.tsx` on mobile widths.
- Dark-mode re-theming depends on Tailwind gray classes resolving through CSS variables everywhere — true today, but fragile if a future hardcoded hex color shows up in any third-party-rendered DOM (e.g., a Leaflet default marker popup used somewhere new).

---

## What we actually got right (for balance)

- **A genuinely complete remediation cycle.** Every one of the last review's five findings moved — four fully fixed, one meaningfully improved — and the team went further than asked on the offline queue (7 actions now safely queue/replay instead of the 2 requested).
- **The dark-mode and PWA fundamentals are done properly**, not patched around: CSS-variable-driven theming that a Leaflet popup correctly inherits, a real installable manifest with maskable icons, and an update flow that asks before it swaps code out from under an in-progress job.
- **Offline handling for the core "log a part / change a status" loop is now real** — the exact gap flagged as the biggest miss last round — including snapshot/rollback safety for the other queued mutations.
- **The barcode scanner degrades gracefully** even where the underlying data model (M6-5) can't fully support it yet — a manual-entry fallback means a failed scan never dead-ends a technician.

---

## Prioritized remediation roadmap

1. **Hide (not just gate-behind-a-friendly-page) "New Work Order"/"Edit" on `JobsPage`** for roles lacking `jobs.create`/`jobs.edit`, matching the pattern already used correctly on Job Detail and the rest of this same page. *(H1)*
2. **Guard the Dispatch board for phone-reachable roles**: wrap the route in `RequirePermission` (or gate drag-and-drop client-side) for anyone lacking `dispatch.manage`/`jobs.edit`, so a technician doesn't get an optimistic-then-silently-fail drag. While there, this is also the moment to decide whether Dispatch should be reachable by a technician's nav at all. *(H2)*
3. **Add a request timeout and make failed JSON mutations retryable with one tap**, not just failed uploads — this is the difference between "installable PWA" marketing and something trusted in a basement with bad signal. *(M1)*
4. **Paginate/virtualize the inventory list** before the full real parts catalog lands on it. *(M2)*
5. Point the `RequirePermission` denial screen's recovery link at a role-appropriate destination (`/my-day` for technicians). *(M3)*
6. Gate attachment delete (shared fix with the desktop review). *(M4)*
7. Populate a real barcode/UPC field during catalog import so scans match on the first try, not just via the manual-entry safety net. *(M6-5 follow-up)*

Two rounds running, the roadmap the previous review left has been fully executed — keep that pattern going and close H1/H2, and this is genuinely comparable to the name-brand field apps rather than being graded on a curve.

---

*Filed as an internal engineering review. Companion to `DESKTOP-REVIEW.md`. Supersedes
and replaces `MOBILE-REVIEW.md` (original), `MOBILE-REVIEW-2.md` through `-6.md`, all
deleted. Nothing here is customer-facing.*
