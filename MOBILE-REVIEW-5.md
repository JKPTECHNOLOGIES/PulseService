# PulseService — Adversarial Mobile Review #5 (Busy Technician Perspective)

**Reviewed at:** commit `b932a65` ("Gate Map geocode action; enlarge modal
close target")
**Prior review:** `af7d021` (scored 6/10) — see `MOBILE-REVIEW-4.md`,
`MOBILE-REVIEW-3.md`, `MOBILE-REVIEW-2.md`, `MOBILE-REVIEW.md`
**Reviewer stance:** Same tech at Prime Comfort Solutions. Phone-only. I log
parts on a job, I count stock on my truck, I drive to the next call. I don't
care what "phase" the office is on — I care whether the screen in my hand
fights me. This round I finally got some wins, so I went looking for the next
thing that'll waste my afternoon.
**Method:** Re-verified Review #4's open items against the live code (not
assumed fixed). Then audited everything the office team shipped that a
phone-holding role can actually reach — the new **purchasing/inventory** pages
(`StockLocationsPage`, `PurchaseOrdersPage`, `PurchaseOrderDetailPage`,
`PricingTiersPage`, `SerializedUnitsPage`) — plus the two things that changed
under *my* thumbs this round: the new **Map** tab that replaced Dispatch in my
bottom bar, and **dark mode**. Cross-checked every raw `<table>` in the app
against the responsive card pattern the team already owns
(`DataTable.renderMobileCard`, `LineItemsTable`, `CycleCountPage`), and
re-checked `technician: ["jobs.status", "inventory.issueToJob"]` against the
gates on anything I can now navigate to.

---

## TL;DR verdict — 7.5/10 (up from 6)

Credit where it's due: **this round they finally fixed my screen.** The
"Add part" / "Install unit" links and both trash icons on Job Detail are real
44px targets now. The "Edit" button that used to sit there waiting to 403 me is
gone unless I actually hold `jobs.edit`. The Help popup stopped throwing itself
in my face on My Day and a job. iOS stopped zooming every time I tap a field.
And a deploy no longer reloads the app out from under me mid-parts-entry — it
asks first. Those were the top items two reviews running. Done. That's the
biggest single jump this app has made for *me* specifically.

They also swapped my dead-end "Dispatch" tab (a board I can only stare at) for
a **Map**, made line items and cycle count usable as cards, and gave Add Part a
search box and a **barcode scanner** — which is the single best thing that's
happened to my parts workflow. Good round.

So why not higher? Because the office shipped a whole **purchasing/inventory
suite** and none of it survives contact with a phone. And the Map they handed
me shows me *the entire company's* jobs, not mine. The base is now genuinely
good; the misses are concentrated in the newest, least-reviewed corner.

---

## What got fixed since Review #4 (verified against the code)

| #4 item | Status |
| --- | --- |
| PWA `autoUpdate` reloads mid-task | ✅ Now `prompt` + reload toast |
| `JobMaterialsCard` tap targets | ✅ 44px via `IconButton`/min-h |
| Help modal auto-opens on My Day / job | ✅ Suppressed on tech-primary screens |
| Serialized Units Install gate too strict | ✅ `issueToJob` can Install |
| C3 iOS zoom-on-focus | ✅ 16px rule unlayered, beats `text-sm` |
| `JobFormPage`/Edit gated by `jobs.edit` | ✅ Route + button gated |
| Tech bottom-bar 3rd tab dead-ends on Dispatch | ✅ Now the job Map |
| `CycleCountPage` / `LineItemsTable` not mobile | ✅ Card layouts under `md:` |
| `AddPartModal` unsearched picker, no scan | ✅ Search + barcode scan |
| Unify the Google-only directions helper | ✅ One platform-aware `lib/maps.ts` |

Ten straight carry-overs closed. This is the round the roadmap actually landed.

---

## Findings by severity

### 🟠 High

**M5-1 — The new purchasing/inventory pages are desktop-only tables.**
`StockLocationsPage`, `PurchaseOrdersPage` (both tables),
`PurchaseOrderDetailPage`, `PricingTiersPage` (both tables), and
`SerializedUnitsPage` each render a raw full-width multi-column `<table>` inside
an `overflow-hidden` card. There's no `renderMobileCard`, no `hidden md:table`,
no scroll wrapper — so on a phone the 5–6 columns squish into an unreadable
jumble. A warehouse lead or inventory manager approving a PO or checking truck
stock from their phone gets the same broken experience the *rest* of the app
was fixed out of three reviews ago. The team already owns the exact pattern
(just applied to `LineItemsTable` and `CycleCountPage`) — it just wasn't applied
to the newest pages. This is the clear next batch.

### 🟡 Medium

**M5-2 — My Map tab shows the whole company, not my jobs.**
The tab that replaced Dispatch (`MapPage`) sources `useDispatchBoard` — *every*
job for the next 14 days, for everyone. As a tech, I want *my* route, not 40
pins for the other trucks. Right now it's noise the moment the company has more
than one crew. Scope it to jobs assigned to the current technician (filter
client-side by assignment, or pass the tech to the query).

**M5-3 — Reports charts don't respect dark mode.**
`ReportsPage` hardcodes `#f0f0f0` grid lines and `#6b7280` axis ticks. On the
new dark theme the grid glows bright and the labels go dim. Contained fix — feed
`isDark`-derived colors into the four chart tabs (grid stroke, tick fill, and
the tooltip surface).

### 🟢 Low / polish

- **Modals are centered dialogs, not bottom sheets.** They're near-full-width
  on mobile so they're usable, and the close target is 44px now — but the taller
  forms (Add Part, schedule editor) would feel more native as a bottom sheet
  with an internal `max-h` scroll. Prior reviews implied "sheet modals" shipped;
  strictly, they didn't.
- **Header is filling up.** Title + "?" help + theme toggle + bell + avatar all
  live in the top bar now. It fits at 320px today, but there's no more room —
  the next action added here will force a decision.
- **Barcode scanner nests inside the Add Part modal.** It works, but it's a
  full-screen overlay rendered inside another dialog's focus trap; worth a quick
  real-device check on iOS Safari that camera permission + focus return behave.

---

## Prioritized remediation roadmap (highest leverage first)

1. **Mobile-card the five new inventory/purchasing pages** (M5-1) — reuse
   `DataTable`'s `renderMobileCard` where the page already uses `DataTable`, or
   the `hidden md:table` + card-list pattern from `CycleCountPage`/`LineItemsTable`
   for the hand-rolled ones. One batch, low risk, closes the last big mobile gap.
2. **Scope the Map to the signed-in tech's jobs** (M5-2) — finishes the bottom-bar
   tab that replaced Dispatch so it's an asset, not clutter.
3. **Theme the Reports charts** (M5-3) — grid/tick/tooltip colors from `isDark`.
4. Polish: a bottom-sheet modal variant for tall forms; keep an eye on header
   density; real-device pass on the nested scanner.

Two items this round were already fixed while writing it (the Map geocode
button that 403'd for techs, and the sub-44px modal close button) — see commit
`b932a65`.

---

*Filed as an internal engineering review. Companion to `MOBILE-REVIEW.md`
through `-4`. Nothing here is customer-facing.*
