# PulseService — Adversarial Mobile Review #6 (Busy Technician Perspective)

**Reviewed at:** commit `409d98b`
**Prior review:** `b932a65` (scored 7.5/10) — see `MOBILE-REVIEW-5.md`,
`MOBILE-REVIEW-4.md`, `MOBILE-REVIEW-3.md`, `MOBILE-REVIEW-2.md`,
`MOBILE-REVIEW.md`
**Reviewer stance:** Still the same tech at Prime Comfort Solutions, still
phone-only, still grading on exactly one axis: does the screen in my hand help
me finish the call or fight me? Secondarily I put on the warehouse manager's hat
and tried to approve a PO and count a truck from a phone, because last round
that's where the app fell apart. This round I came in expecting to be
disappointed again — and mostly wasn't.
**Method:** Re-verified **every** item `MOBILE-REVIEW-5.md` claimed fixed or
recommended, against the live code, line by line — I did not assume the roadmap
landed. Then I walked the surfaces a phone-holding role can actually reach:
`BottomTabBar`, `MyDayPage`, `JobDetailPage` (materials card, clock in/out,
e-signature, photos, Add Part search + scanner), the five
purchasing/inventory pages, `CycleCountPage`, the responsive `Modal`,
`DataTable.renderMobileCard`, the offline mutation queue (`main.tsx` +
`lib/offlineMutations.ts` + `vite.config.ts`), the update prompt, `usePush`,
and dark mode. Cross-checked `technician: ["jobs.status",
"inventory.issueToJob"]` (`backend/src/constants/permissions.js:207`) against
the gates on everything I can now tap.

---

## TL;DR verdict — 8/10 (up from 7.5)

Give the office team their due: **they closed the entire #5 roadmap.** Not
"mostly," not "the easy ones" — all of it. The five purchasing/inventory pages
that were desktop-only `<table>` jumbles last round are now proper card lists
on my phone (`PricingTiersPage`, `StockLocationsPage`, `PurchaseOrdersPage`,
`SerializedUnitsPage` via `DataTable.renderMobileCard`; `PurchaseOrderDetailPage`
via a hand-rolled `md:hidden` card block). The Map tab finally shows **my**
route instead of all forty trucks. The Geocode button that used to 403 me is
gated behind `customers.edit`. The modals are real bottom sheets now, with a
grab handle, a 44px close target, and safe-area padding. The barcode scanner's
camera doesn't flicker or re-prompt anymore. And the Reports charts — even
though I can't reach them — got themed for dark mode the smart way, with one
global CSS override instead of touching every chart. That's a clean sweep, and
it's the second round running the roadmap actually shipped.

So why only 8 and not higher? Because I found the **same 403 trap they just
fixed on the "Edit" button, still sitting on the "Assign" button** two cards
down in the same file — I can open it, fill it out, and eat a 403. And because
when I dug into the offline story, the two things I do most on a job — **log a
part and change the status** — aren't in the offline queue at all. Only clock
in/out survive an app reload; my part gets silently dropped. For an "installable
PWA" that a tech is supposed to trust in a basement, that's the gap that keeps
this behind ServiceTitan and Housecall Pro. The base is genuinely good now; the
misses are specific and fixable.

---

## What got fixed since Review #5 (verified against the code)

| #5 item | Status | Evidence |
| --- | --- | --- |
| M5-1 — five purchasing/inventory pages are desktop-only tables | ✅ **Fixed, all five** | `PricingTiersPage.tsx:155-190`, `StockLocationsPage.tsx:178-221`, `PurchaseOrdersPage.tsx:177-208`, `SerializedUnitsPage.tsx:251-285` all use `DataTable` + `renderMobileCard`; `PurchaseOrderDetailPage.tsx:132-182` renders a `md:hidden` card list with the table behind `hidden md:table` (`:184-240`); its receipt history (`:275-313`) and receive modal (`:389-467`) are card layouts, not tables |
| M5-2 — Map tab shows the whole company, not my jobs | ✅ **Fixed** | `MapPage.tsx:36-62` reads `role`/`userId`, resolves `myTechId`, and when `isTech` narrows points to `board.technicians.find(t => t.id === myTechId)?.jobs`; header reads "N of your jobs" (`:88`) |
| M5-3 — Reports charts ignore dark mode | ✅ **Fixed (globally)** | Not by feeding `isDark` into props (the charts still hardcode `#f0f0f0`/`#6b7280`), but by CSS overrides in `index.css:43-63` — `.dark .recharts-cartesian-grid line`, `.dark .recharts-text`, and the tooltip surface. CSS beats the SVG presentation attributes, so every chart re-themes at once |
| M5-4 — Map "Geocode" button 403'd techs | ✅ **Fixed** | `MapPage.tsx:94-105` wraps the button in `<Can permission="customers.edit">` |
| M5-5 — modal close target under 44px | ✅ **Fixed** | `Modal.tsx:66-73` — `min-h-[44px] min-w-[44px] sm:min-h-[34px]` on the close button |
| M5-6 — modals are centered dialogs, not bottom sheets | ✅ **Fixed** | `Modal.tsx:44-58` anchors `items-end` + `translate-y-full` on mobile, `sm:items-center` on up, with a grab handle and `pb-[env(safe-area-inset-bottom)]` (`:75`) |
| M5-7 — barcode scanner camera unstable | ✅ **Fixed** | `BarcodeScanner.tsx:25-69` keeps `onDetected`/`onClose` in refs so the init effect depends only on `isOpen` — no teardown/re-prompt on parent re-render |
| (carried from #4) Edit button 403 trap | ✅ **Confirmed still fixed** | `JobDetailPage.tsx:219-231` `<Can permission="jobs.edit">`; route gated at `App.tsx:87-90` (`RequirePermission perm={["jobs.edit"]}`) |

Eight-for-eight. I went in looking for a regression in this list and didn't find
one.

---

## Findings by severity

### 🟠 High

**M6-1 — The "Assign" button on Job Detail is the exact 403 trap they just
fixed on "Edit."**
`JobDetailPage.tsx:424-432` renders an "Assign" button in the Technicians card
with **no `<Can>` wrapper at all**. I open every job off My Day, and that card
sits right at eye level in the right column. As a tech I can tap Assign, the
modal opens (`:614-662`), I pick a name, I hit Assign — and the request dies,
because `POST /jobs/:id/technicians` requires `jobs.assign`
(`backend/src/routes/jobs.routes.js:38-42`) and my role holds only
`jobs.status` + `inventory.issueToJob` (`permissions.js:207`). This is the same
class of bug — an ungated write button that lets a tech do work the server
will reject — that got the Edit button wrapped in `<Can>` last round. They
fixed the one two cards up and left this one alone. Wrap it in
`<Can permission="jobs.assign">` (and while you're there, the "Update Status"
button at `:208-218` is ungated too — it happens to be fine for *me* because I
hold `jobs.status`, but a view-only role would 403 on it).

**M6-2 — The two writes I do most on a job don't survive offline; only clock
in/out do.**
The offline story is real but half-wired. `lib/offlineMutations.ts:11-14`
registers keyed mutation defaults for **exactly two** actions — `clockIn` and
`clockOut` — and the file's own comment explains why that matters: "a paused
mutation only stores its variables + key, never the function itself," so only
keyed defaults can be replayed after an app reload (`main.tsx:67-70` calls
`resumePausedMutations`). But **issuing a part** (`useIssueToJob`,
`hooks/useInventory.ts:245` — no `mutationKey`) and **updating job status**
(`useUpdateJobStatus`, `hooks/useJobs.ts:79` — no `mutationKey`) are plain
mutations. Here's what that means in a mechanical room with no signal: I log
three parts, the `OfflineIndicator` (`components/ui/OfflineIndicator.tsx`,
mounted at `AppLayout.tsx:54`) correctly shows "3 pending sync," I drive off —
and then the service worker picks up a deploy, or iOS evicts the PWA tab, and on
reload only clock in/out come back. My three parts are **gone, silently**, and
so is my "Completed" status change. That's the nightmare from Review #4, just
relocated: clock in/out are safe, but the parts and status that actually bill
the job are not. ServiceTitan and Housecall queue these. Register
`issueToJob`/`updateJobStatus` as keyed offline defaults too, and give me
optimistic feedback so I can tell the tap took.

### 🟡 Medium

**M6-3 — My Map tab's popups are unreadable in dark mode.**
The Map is my third bottom-tab (`BottomTabBar.tsx:22`), so this is a screen I
live in. Its job popups (`MapPage.tsx:123-161`) style text with
`text-gray-800` / `text-gray-500`, which the dark theme inverts to *light*
colors via the `--c-gray-*` ramp (`index.css:37-39`). But the Leaflet popup
bubble itself is white — that background comes from the bundled `leaflet.css`,
and there is **no `.dark .leaflet-popup*` override anywhere in the app** (I
grepped every CSS file — zero hits). So at night the customer name, address,
and summary render as light-gray text on a white bubble: near-invisible. The
job-number link stays blue and readable, everything else disappears. Add a
`.dark` override for `.leaflet-popup-content-wrapper` / `.leaflet-popup-tip`
next to the recharts block you already added in `index.css`.

**M6-4 — Deleting a job photo is a hover-only action, so on a phone it's
invisible.**
`AttachmentGallery.tsx:169-178` puts the per-photo delete button behind
`opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100`.
There is no `:hover` on a touchscreen, and tapping the thumbnail opens the
full-size preview (`:156-168`) rather than revealing the trash button — so I
have no discoverable way to delete a photo I just took by mistake from my
phone. This is the one place the photo flow (which is otherwise good —
`accept="image/*"` at `:125` correctly offers camera or library) breaks on
touch. Make the delete affordance always-visible on mobile, or move it into the
preview dialog.

**M6-5 — The barcode scanner only matches my internal SKU, so most real
barcodes just error.**
`AddPartModal`'s `handleScan` (`JobDetailPage.tsx:939-949`) matches a scanned
code with `items.find(i => i.sku.toLowerCase() === scanned)` — exact match
against the *internal* SKU only. The barcode physically printed on a part in my
truck is a manufacturer UPC/EAN or vendor part number, which is almost never
equal to PulseService's own SKU. So the single best addition to my parts
workflow mostly ends in `No part with SKU "…"`. The scanner works; the lookup
is matched against the wrong field. Match against a barcode/UPC/mfr-part field
(or fall back to substring across SKU + name) so a real scan finds the part.

### 🟢 Low / polish

- **Header action buttons are under 44px.** The "?" help button is `p-1` (~28px,
  `Header.tsx:97-107`); the theme toggle (`:127-138`) and the bell (`:141-154`)
  are `p-2` (~36px). All below the 44px bar the rest of the app now meets. Low,
  because they're not core workflow — but it's inconsistent with the good work
  everywhere else.
- **Offline part-issue leaves the modal spinning with no feedback.** Because
  `AddPartModal`'s submit chains off `mutateAsync(...).then(close)`
  (`JobDetailPage.tsx:1046-1060`) and the mutation is paused offline, the button
  spins and the sheet never closes — I can't tell if it worked. (This is the
  UX face of M6-2.)
- **No clock-in from My Day, and no "you're clocked in on Job #123" banner.** To
  start my timer I have to open the job (`JobDetailPage.tsx:484-506`); the
  agenda (`MyDayPage.tsx`) has Navigate + Call but no timer. Competitors put a
  running-timer chip on the agenda so I always know what I'm on the clock for.
- **The map is a bright rectangle at night.** OSM tiles are light regardless of
  theme (`MapPage.tsx:117-119`); in dark mode the whole map panel glows. Minor,
  but a dark tile layer under `.dark` would finish the theme.
- **Add Part search can lose the selected item.** The search box filters the
  native `<select>` options (`JobDetailPage.tsx:930-999`); if I select a part
  and then type, the chosen option can drop out of `filteredItems` while the
  value stays set. Edge case, but confusing.

---

## Prioritized remediation roadmap (highest leverage first)

1. **Gate the "Assign" button behind `jobs.assign`** (M6-1) — one `<Can>`
   wrapper closes a 403 trap that's the exact bug you fixed on "Edit" last
   round. Sweep the same file for other ungated writes (Update Status).
2. **Make part-issue and status changes offline-replayable** (M6-2) — register
   `issueToJob`/`updateJobStatus` as keyed mutation defaults alongside clock
   in/out, and add optimistic feedback so the tap is acknowledged. This is the
   difference between "installable PWA" marketing and a tool I trust in a
   basement.
3. **Theme the Leaflet popups for dark mode** (M6-3) — a `.dark
   .leaflet-popup-content-wrapper`/`-tip` block beside your recharts overrides
   in `index.css`. Fixes readability on my primary Map tab at night.
4. **Reveal photo-delete on touch** (M6-4) and **match the scanner against real
   barcodes** (M6-5) — two contained fixes to workflows that are otherwise
   already good.
5. Polish: bump the three header buttons to 44px; close the Add Part sheet (or
   toast) when an offline issue is queued; a running-timer chip on My Day; a
   dark tile layer for the map.

Credit where earned: this is the strongest the mobile experience has been across
six reviews. Close M6-1 and M6-2 and I'm genuinely comparing you to the
name-brand field apps instead of grading on a curve.

---

*Filed as an internal engineering review. Companion to `MOBILE-REVIEW.md`
through `-5`. Nothing here is customer-facing.*
