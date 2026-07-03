# PulseService — Adversarial Mobile Review #3

**Reviewed at:** commit `c90bf0d` ("Let technicians issue parts and install
units in field")
**Prior review:** `24e3e64` (scored 6.5/10, up from 4/10) — see
`MOBILE-REVIEW-2.md` and `MOBILE-REVIEW.md`
**Method:** Re-verified every claim in `MOBILE-REVIEW-2.md`'s scorecard against
the live code (not assumed), then audited everything shipped since — the
multi-location inventory module, the `inventory.issueToJob` permission, and the
new job-detail field workflow (`JobMaterialsCard` / `AddPartModal` /
`InstallSerialModal`) — for what an adversarial reviewer would flag on a phone
screen. Cross-checked `backend/src/constants/permissions.js` against
`Sidebar.tsx`, `BottomTabBar.tsx`, and every page's own `<Can>` gates.

---

## TL;DR verdict — ~7/10 (up narrowly from 6.5)

Real, structural wins landed since the last review: **web push is now genuinely
wired** (closing the last piece of C1), the `DataTable` renders one layout per
viewport with an actual mobile sort menu (N1/N2 fully fixed), the bottom tab
bar is role-aware (N5 fixed), My Day got platform-aware maps and a real
error-vs-empty state (N6 fixed), the attachment lightbox now uses an
accessible Headless UI dialog (M4 fixed), and every modal grid in the codebase
now carries a `sm:` breakpoint (H1/N4 — genuinely, verifiably fixed
project-wide this time, not just claimed).

But two things keep this from being a clean step forward:

1. **A previously-claimed fix isn't real.** MOBILE-REVIEW-2 marked C3 (iOS
   zoom-on-focus) "✅ Fixed" via a 16px media-query floor in `index.css`. On
   inspection, that rule loses to CSS specificity almost everywhere in the
   app, because the shared `Input`/`Select` components and essentially every
   hand-rolled form field explicitly set `text-sm` (14px) directly on the
   native `<input>`/`<select>` element. A class selector always beats a bare
   element selector regardless of source order, so the "fix" is dead code on
   contact with real markup. This isn't a new regression from this round's
   work — it was already broken when the last review shipped — but it means
   the scorecard needs correcting: **the #1 mobile-usability bug from the very
   first review was never actually closed.**
2. **The newest feature (field inventory for techs) didn't get the same rigor
   as the rest of the app.** The permission model is correct on the backend,
   but the frontend around it has real gaps: an unguarded "Edit" button that
   lets a technician fill out a whole job form they can't save, a bottom-bar
   "Dispatch" tab that hands techs a desktop gantt they have no permission to
   use, and two inventory-adjacent screens (`CycleCountPage`, `LineItemsTable`)
   that reintroduce the exact bare-`<table>` anti-pattern the rest of the app
   spent two review cycles fixing.

Net: meaningfully better infrastructure, but the newest work shows the "mobile
first" discipline hasn't fully generalized, and one review-old "done" item
turns out to have been a false positive the whole time.

---

## Scorecard vs. `MOBILE-REVIEW-2.md`'s findings

| # | Finding | Status |
| --- | --- | --- |
| C1 | Installable / offline / push | ✅ **Now fully fixed** — `frontend/src/hooks/usePush.ts` subscribes via `PushManager`/VAPID; `backend/src/services/push.service.js` uses real `web-push`, and `jobs.controller.js` (`assignTechnician`) + `dispatch.controller.js` (`reassign`) both call `push.sendToUser(...)` on assignment. This is wired to real events, not just a "Send test" button. |
| C2 | Desktop tables in a sideways scroller | 🟡 **Still fixed for the pages reviewed last time — but the pattern is back** in the two newest inventory-adjacent screens (`CycleCountPage.tsx`, `LineItemsTable.tsx`). See N4/N5 below. |
| C3 | iOS zoom-on-focus | 🔴 **Not actually fixed — re-opened.** See N1 below; this was mis-scored "Fixed" last round. |
| H1 | Modal forms cram inputs per row | ✅ **Fixed, verified project-wide.** Grepped every `grid-cols-2`/`grid-cols-3` in `frontend/src`; every hit now carries a `sm:`/`md:` prefix (Equipment, Campaign, Agreements, `QuickBooksTab`, the Dispatch `ScheduleEditor`'s two `datetime-local` inputs at `DispatchPage.tsx:464`, all of it). No bare `grid-cols-N` remains. |
| H2 | Tap targets < 44px | 🟡 **Still partial, plus a fresh instance.** `Pagination.tsx` buttons are still `h-8 w-8`/`p-1.5` (~28–32px), unchanged. New: the "Add part" / "Install unit" links and the "Remove part" trash icon in the brand-new `JobMaterialsCard` (`JobDetailPage.tsx:635-650`, `:684-689`) are bare `text-xs` buttons with no padding — well under the 44px floor, on the single most important tech screen in the app. |
| H3 | Top-left drawer nav | ✅ Unchanged, still fixed. |
| H4 | Monolithic bundle | ✅ Unchanged, still fixed (routes still `React.lazy` in `App.tsx`). |
| H5 | Full-res images, no thumbnails | 🔴 **Still untouched.** `attachments.controller.js`'s `getRaw` serves the same full-resolution blob to both the 3-per-row grid thumbnail and the lightbox (`Content-Type`/`Cache-Control: private, max-age=86400`, no resize, no derivative). |
| M1 | No safe-area | ✅ Unchanged, still fixed. |
| M2 | Gantt on a phone | 🟡 **Unchanged for dispatchers — and now more exposed to techs.** `DispatchPage.tsx` has zero mobile/permission-aware rendering (`grep` for `overflow-x-auto`/`hidden md:`/`Can permission` in that file returns nothing), and it's now one of only 3 tabs on a technician's bottom bar. See N2. |
| M3 | Sub-11px text | 🔴 **Still open, unchanged.** `DispatchPage.tsx` still has half a dozen `text-[10px]`/`text-[11px]` spans (job chip time range, lead-tech name, status legend, "now" marker, tech load, "Lead" badge). |
| M4 | Overlay a11y (lightbox) | ✅ **Fixed.** `AttachmentGallery.tsx`'s preview is now a Headless UI `Dialog`/`Transition` (focus trap, `Escape`, portal) — no more hand-rolled div. |
| M5 | Pull-to-refresh | ⬜ Still skipped (by decision), unchanged. |
| N1 (rev.2) | No sort control on mobile | ✅ **Fixed.** `DataTable.tsx` now has `useIsMobile()` + a "Sort" `Menu` toolbar shown only in card mode (`showSortMenu`). |
| N2 (rev.2) | Every list row renders twice | ✅ **Fixed.** `DataTable.tsx` renders exactly one of `showCards`/table via `useIsMobile`, not both. |
| N3 (rev.2) | Detail pages never mobile-ified | ✅ **Fixed for Job Detail**, the page that matters most now. `JobDetailPage.tsx`'s `dl` is `grid-cols-1 sm:grid-cols-2` (line 230), the header actions are `grid-cols-2 ... sm:flex` (line 182), `AgreementDetailPage.tsx` and `AgreementsPage.tsx` modals are similarly `sm:`-responsive. |
| N4 (rev.2) | Modal grids cram 2 inputs | ✅ **Fixed**, see H1 above. |
| N5 (rev.2) | Bottom bar not role-aware | 🟡 **Fixed mechanically, but the tech tab set itself is now questionable.** `BottomTabBar.tsx` correctly splits `techTabs`/`officeTabs` by role — genuine fix — but see N2 below on whether "Dispatch" belongs in the tech set at all. |
| N6 (rev.2) | My Day rough edges | ✅ **Fixed.** `MyDayPage.tsx`'s `mapsUrl()` now detects Apple platforms (`isApplePlatform()`) and picks `maps.apple.com` vs. Google; `isError` renders a distinct "Couldn't load your day" card with Retry, separate from the empty state. |
| N7 (rev.2) | Saved views via `window.prompt` | 🔴 **Still open, and now on more pages.** `SavedViewsMenu.tsx:27` still calls `window.prompt`; `useSavedViews.ts` is still `localStorage`-only (per-device). Now used on Customers, Jobs, Estimates, *and* Invoices (up from just Customers). |

---

## New findings (introduced or exposed by the recent work)

**N1 — The C3 "16px input floor" doesn't actually work; it's beaten by
specificity almost everywhere.** `frontend/src/index.css:59-65` adds:

```css
@media (max-width: 640px) {
  input, select, textarea { font-size: 16px; }
}
```

That's a bare-element selector (specificity 0,0,1). But the app's own shared
`Input`/`Select` components (`components/ui/Input.tsx:34`,
`components/ui/Select.tsx:35`) — and essentially every hand-rolled form field
in the app, via a repeated `"... rounded-lg text-sm focus:outline-none ..."`
class string — put `text-sm` (0.875rem, specificity 0,1,0) directly on the
native element. A class selector always wins over an element selector
regardless of source order (Tailwind v3 has no native CSS cascade-layer
output; `@layer base/utilities` is a build-time bucketing convention only), so
`.text-sm` overrides the anti-zoom rule on **every field that sets it**. I
confirmed the identical `"w-full px-3.5 py-2.5 border border-gray-300
rounded-lg text-sm ..."` pattern independently in `CustomerFormPage.tsx`,
`EstimateFormPage.tsx`, `InvoiceDetailPage.tsx`, `AgreementsPage.tsx`,
`AgreementDetailPage.tsx`, `EquipmentPage.tsx`, `InventoryPage.tsx`,
`CycleCountPage.tsx`, `QuickBooksTab.tsx`, `InstallSerialModal.tsx`,
`LookupSelect.tsx`, the new `AddPartModal` in `JobDetailPage.tsx:826-827`, and
the status/assign modals on the same page (`JobDetailPage.tsx:523`, `:571`).
Net effect: iOS Safari still zooms the viewport on focus into nearly every
input in the app, exactly the C3 bug from the very first review. This is the
single highest-leverage fix available — it's one bad assumption
(`@media` beats a utility class) propagated through the entire design system.

**N2 — The tech bottom bar spends one of three precious tabs on a screen
techs can't use.** `BottomTabBar.tsx`'s role-aware fix (N5) is real, but the
tech tab set is `My Day / Jobs / Dispatch`. `DispatchPage.tsx` has **zero**
mobile or permission-aware rendering — no `useIsMobile`, no `<Can>`, no
`hidden md:` — so a technician tapping "Dispatch" gets the exact same
drag-and-drop, horizontally-scrolling, multi-technician gantt/calendar a
dispatcher sees. The backend correctly requires `dispatch.manage` for
`POST /dispatch/reassign` (`dispatch.routes.js:9`) — a permission technicians
don't have (`permissions.js:210`) — so any drag a tech attempts optimistically
updates, then rolls back with a toast error (`useDispatch.ts`'s
`onError`/`getErrorMessage`). That's a confusing, wasted interaction on a
touchscreen, and it occupies a bottom-bar slot that could instead surface
something a tech actually needs (e.g. a shortcut into the new
parts/materials workflow, or Time Tracking). This is a direct side effect of
this round's own nav work, not a pre-existing issue.

**N3 — The "Edit" button on Job Detail is unguarded, so a technician can fill
out a whole job form only to have the save silently rejected.** In
`JobDetailPage.tsx:194-204` the Edit `Button` (unlike the "Add part"/"Install
unit" actions in `JobMaterialsCard`, which are correctly wrapped in
`<Can permission={["inventory.manage","inventory.issueToJob"]}>`) has **no**
`<Can>` wrapper at all — it's rendered for every role. It routes to
`/jobs/:id/edit` (`App.tsx`), which is also an unguarded route rendering the
full `JobFormPage.tsx` (customer, schedule, priority, technician assignment,
etc. — I grepped `JobFormPage.tsx` for `Can permission`/`usePermissions`:
zero hits). A technician's actual permission set is `["jobs.status",
"inventory.issueToJob"]` (`permissions.js:210`) — no `jobs.edit`. So a tech
can open the edit form, change fields, tap Save, and only then discover (via a
toast, after the round trip) that the write is a 403. On a phone, in the
field, that's data entry thrown away with no warning up front. This is
exactly the "tab/button a tech can see but not use" pattern the audit was
asked to check for, and it sits on the most important tech-facing screen in
the app.

**N4 — `CycleCountPage.tsx` reintroduces the pre-review desktop-table
anti-pattern, in a screen that is *inherently* a mobile workflow.** A guided
cycle count — "walk the shelf/truck with your phone, type what's physically
there" — is about as mobile-native a use case as this app has, yet the count
table (`CycleCountPage.tsx:133-199`) is a bare `<table className="w-full
text-sm">` with four columns (Item, Expected, Counted input, Variance), no
`overflow-x-auto`, no `DataTable`/`renderMobileCard` adoption, no breakpoint
of any kind. On a narrow screen this either squeezes four columns into
unreadable widths or forces sideways scrolling while trying to type into a
`w-24` counted-quantity field — the exact C2 complaint from the very first
review, shipped fresh in this round's inventory work. Separately: the route
itself (`/inventory/cycle-count` in `App.tsx`) has no permission guard —
the entry-point button on `InventoryPage.tsx:241` is correctly wrapped in
`<Can permission="inventory.manage">` so a technician won't find it by
tapping around, but nothing stops direct navigation, and the POST it
eventually submits to (`/inventory/cycle-count`) is `inventory.manage`-gated
server-side (`inventory.routes.js:61-65`) — so a tech who lands on this page
some other way (bookmark, shared link, browser back/forward) can spend real
time entering counts before hitting a 403 on submit. Same failure shape as N3.

**N5 — `LineItemsTable.tsx` was never touched by any mobile pass, and it's
now explicitly tech-relevant.** The task context calls out that techs may
build estimates in the field using the new tier-aware quick-add picker — but
the editable line-item grid underneath that picker
(`LineItemsTable.tsx:117-219`) is a plain 6-column `<table>` (Type select,
Name + Description stacked inputs, Qty, Unit Price, Total, delete) with no
`overflow-x-auto`, no responsive breakpoint, and no card-mode fallback —
unlike `DataTable`, which got exactly this treatment two review cycles ago.
This is used on both `EstimateFormPage` and `InvoiceDetailPage`/
`InvoiceFormPage`. It is arguably the single worst screen in the app on a
narrow viewport today, and it's the one a tech is most likely to touch given
the new pricing-tier work. The new `PricebookQuickAdd` (same file,
lines 244-303) at least adds value quickly, but it's a single unfiltered
`<select>` of the whole pricebook with no search — every item's name and
price crammed into one `<option>` line, which is painful to scan on a phone
keyboard-driven picker.

**N6 — The new `AddPartModal` ships a worse picker than its sibling modal
shipped in the same commit.** `InstallSerialModal.tsx` (also new/updated this
round) gives users a "Find in-stock unit" search box that filters the
subsequent `<select>` as you type (lines 111-138). `AddPartModal`
(`JobDetailPage.tsx:783-919`), shipped in the *same* PR, has no equivalent —
its "Part" field (line 836) is one flat `<select>` built from
`useInventoryItems()` called with **no arguments**, i.e. every non-archived
SKU in the company's entire catalog, unfiltered, unsearched, alphabetized only
by name. For an HVAC company with a real parts catalog (capacitors,
contactors, filters, refrigerant, etc.) that's a long thumb-scroll through a
native `<select>` to find one part while standing at a job. The app also
already has a `BarcodeScanner.tsx` component (wired into `InventoryPage.tsx`'s
desktop "Scan" button) that would be the obvious fit for "scan the part off
the shelf, issue it to the job" — it was not threaded into either
`AddPartModal` or `InstallSerialModal`, despite this being exactly the
field-first inventory scenario the permission change was built for.

**N7 — The My Day maps fix didn't propagate to Job Detail, the screen a tech
actually lands on after tapping into a job.** `MyDayPage.tsx`'s local
`mapsUrl()` (lines 42-59) does the right thing — detects Apple platforms and
picks `maps.apple.com` vs. Google Maps directions. But `JobDetailPage.tsx`'s
"Directions" link (line 254) uses the shared `lib/maps.ts` `directionsUrl()`
helper, which is still hardcoded to
`https://www.google.com/maps/dir/?api=1&destination=...` and opens in
`target="_blank"` — the exact old N6 problem, just not fixed everywhere it
appears. Two different "get directions" implementations now coexist in the
same app, and the one on the page a tech actually works from all day (Job
Detail) is the stale one.

---

## What's genuinely better (for balance)

Web push is real now — VAPID subscribe/unsubscribe, a working test endpoint,
and actual triggers on job assignment/reassignment — closing the last piece
of C1 and a genuine competitive-parity item against ServiceTitan/Housecall/
Jobber. The `DataTable` component is legitimately well-built: one layout per
viewport (no more double-mounted rows), a real mobile sort menu, CSV export,
and bulk selection, all in one reusable primitive. The bottom tab bar being
role-aware is a real fix, not just a claim. My Day is meaningfully better —
platform-correct maps and an honest error state instead of conflating "failed
to load" with "nothing scheduled." The attachment lightbox is now accessible
(focus trap, keyboard, portal) instead of a hand-rolled div. And — the thing
worth calling out explicitly — every modal grid in the codebase now has a
responsive breakpoint; that was flagged as inconsistent in two prior reviews
and this pass shows zero remaining offenders project-wide. Job Detail itself,
the screen this review was most worried about, held up well: single-column
`dl`, responsive action row, and the new Materials & Equipment card fits the
established card-list visual language rather than looking bolted on.

---

## Prioritized remediation roadmap (highest leverage first)

1. **Fix C3 for real.** Either strip `text-sm`/explicit font sizes off native
   `<input>`/`<select>`/`<textarea>` elements (let the base-layer 16px rule
   win on mobile, override to `text-sm` only at `sm:` and up), or make the
   anti-zoom rule an actual override (e.g. a mobile-only utility applied last,
   or drop the font-size out of `text-sm` on touch via a plugin). This one
   change fixes iOS zoom-on-focus on nearly every field in the app at once —
   the highest-leverage fix available this round.
2. **Gate `JobFormPage`/the Edit button by `jobs.edit`**, and audit for the
   same pattern elsewhere (any `<Can>`-free "Edit"/"Delete" button next to a
   permission-scoped API route). Add a lightweight route-level permission
   guard as defense-in-depth, matching what the backend already enforces —
   this also would have caught the `CycleCountPage` route gap for free.
3. **Reconsider the tech bottom bar's third tab.** Replace "Dispatch" (a
   permission-locked desktop board for techs) with something they can act on
   — a Materials/parts shortcut, or Time Tracking — or make `DispatchPage`
   itself read-only and single-tech-scoped for the `technician` role.
4. **Mobile-ify `CycleCountPage` and `LineItemsTable`.** Both are exactly the
   card-list pattern the rest of the app already has a reusable answer for
   (`DataTable`'s `renderMobileCard`); neither adopted it. Cycle count in
   particular should be the flagship mobile inventory screen, not the
   regression.
5. **Add search to `AddPartModal`'s part picker** (mirror
   `InstallSerialModal`'s pattern) and wire the existing `BarcodeScanner` into
   both `AddPartModal` and `InstallSerialModal` — this is the single most
   "field technician" moment in the whole app and it currently ships with the
   weaker of two pickers built in the same commit.
6. **Unify the maps helper.** Delete `lib/maps.ts`'s Google-only
   `directionsUrl` (or make it delegate to `MyDayPage`'s platform-aware
   logic) and use one implementation from Job Detail through My Day.
7. **Image thumbnails + compression** (H5) and **sub-11px Dispatch text**
   (M3) remain the two longest-standing, still-untouched items — worth
   closing before they show up in a fourth review.
