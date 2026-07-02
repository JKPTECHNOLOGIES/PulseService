# PulseService — Adversarial Mobile Review #2

**Reviewed at:** commit `24e3e64`
**Prior review:** `56f721d` (scored 4/10) — see `MOBILE-REVIEW.md`
**Method:** Re-read the layout shell, the shared `DataTable`, every list/detail/form
page, all modals, and the new `MyDay`/navigation code, then diffed reality
against the prior review's findings and the field-service bar (ServiceTitan,
Housecall Pro, Jobber, FieldEdge). Deliberately adversarial — including looking
for problems introduced by the recent work.

---

## TL;DR verdict — now ~6.5/10 (up from 4)

We genuinely crossed from "a desktop app that survives on a phone" to "a
responsive, installable PWA with a field-first view." Lists are cards, forms
don't zoom, navigation is in the thumb zone, the bundle is split, and
technicians land on a real **My Day** agenda with one-tap navigate/call. That is
the bulk of the prior roadmap, done.

The remaining gaps are mostly **the places the rollout stopped short** — modals
and detail pages were left on the desktop layout — plus a couple of holes the new
work itself created (you can't sort on mobile; every list row renders twice).

---

## Scorecard vs. prior findings

| # | Finding | Status |
| --- | --- | --- |
| C1 | Installable / offline / push | 🟡 Mostly fixed — PWA + service worker + offline queue landed; **web push still missing** |
| C2 | Desktop tables in a sideways scroller | ✅ Fixed — card layout on every list page |
| C3 | iOS zoom-on-focus | ✅ Fixed — 16px input floor on touch |
| H1 | Forms cram multiple inputs per row | 🟡 Half-fixed — form *pages* done; **every modal form is still `grid-cols-2`** |
| H2 | Tap targets < 44px | 🟡 Half-fixed — `Button`/`IconButton` + list row actions; filter tabs, pagination, modal buttons still small |
| H3 | Top-left drawer nav | ✅ Fixed — bottom tab bar |
| H4 | 1.17 MB bundle | ✅ Fixed — route code-split |
| H5 | Full-res images, no thumbnails | 🔴 Untouched — `AttachmentGallery` still fetches full-res blobs |
| M1 | No safe-area | ✅ Fixed |
| M2 | Gantt on a phone | ✅ Fixed for techs (My Day); dispatchers still get the gantt |
| M3 | Sub-11px text | 🟡 Barely — only `[9px]→[10px]`; `[10px]`/`[11px]` remain |
| M4 | Overlay a11y | 🟡 Partial — Modal got a label; the image **lightbox is still a hand-rolled div** |
| M5 | Pull-to-refresh | ⬜ Skipped (by decision) |

---

## New findings (introduced or exposed by the recent work)

**N1 — You can't sort or see column headers on mobile.** `DataTable`'s sorting
lives in the `<th>` click handlers, but the table is `hidden sm:block`. On phones
(card view) there is no sort control at all, so the sortable columns we added are
desktop-only. *Fix: a "Sort" control in the card toolbar.*

**N2 — Every list row renders twice.** The card `<ul>` and the `<table>` are both
in the DOM (one hidden by CSS), so a 20-row page mounts ~40 row subtrees. Doubles
DOM/memory on the weakest devices. *Fix: render one layout, chosen by a media
query, not both.*

**N3 — Detail pages were never mobile-ified.** The rollout hit *list* pages; the
screen a tech actually works in — **Job detail** — still uses `dl grid-cols-2`,
a wrap-around action row, and desktop spacing. Same for Customer/Invoice/
Estimate/Agreement detail.

**N4 — Modal forms still cram two inputs per row.** Confirmed fixed `grid-cols-2`
(no breakpoint) in the Equipment, Campaign, Log Call, Agreement, Settings Invite,
and Dispatch Schedule modals — including two `datetime-local` inputs side by
side. H1 is only half-done and looks inconsistent.

**N5 — Bottom bar isn't role-aware.** Static 5 tabs for everyone: office staff get
a permanently empty **My Day**, technicians get Dispatch/Invoices they rarely
touch. The drawer is permission-filtered; the bottom bar should be too.

**N6 — My Day rough edges.** `mapsUrl` hardcodes Google Maps and opens a new tab
(bypasses Apple Maps, misbehaves in standalone PWA). A failed fetch renders the
same "Nothing scheduled today" as a genuinely empty day, so a tech can't tell
"no jobs" from "didn't load."

**N7 — Saved views use `window.prompt` + localStorage.** The native prompt is
jarring on mobile (and blocked in some installed-PWA contexts), and views are
per-device, so they don't follow a tech to another phone.

---

## Still open from before

- **H5 image thumbnails/compression** — untouched; phone photos are still
  full-res over cellular.
- **M3 sub-11px text** — notification badge, dispatch chips/legend/"Lead",
  command palette, and Notifications meta are still 10–11px.
- **M4 lightbox a11y** — the attachment lightbox is still a hand-rolled `div`
  (no focus trap/roles/keyboard), unlike the Headless UI Modal.
- **Web push** — still socket-bell-only; a locked phone gets nothing.

---

## What's genuinely better (for balance)

Card lists, 16px inputs, safe-area insets, the bottom tab bar, code-splitting,
skeletons, the `IconButton`/tap-target primitives, and **My Day with one-tap
Navigate/Call** are all real field-first wins. Combined with the RBAC + audit
work, multi-user field use is now actually safe. This is no longer "the office
app on a phone" for a technician.

---

## Prioritized remediation roadmap (highest leverage first)

1. **Mobile sort control** on `DataTable` + render one layout, not both. *(N1, N2)*
2. **Finish H1**: responsive grids in all modals; full-screen sheet modals on
   mobile. *(N4)*
3. **Mobile detail pages** — Job detail first (single column, big tap targets,
   sticky action bar). *(N3)*
4. **Role-aware bottom bar.** *(N5)*
5. **My Day hardening** — platform-aware maps link, distinct error vs. empty
   state. *(N6)*
6. **Image thumbnails + upload compression** *(H5)* and **web push** *(C1)* — the
   two remaining table-stakes competitor gaps.

---

*Filed as an internal engineering review. Nothing here is customer-facing.*
