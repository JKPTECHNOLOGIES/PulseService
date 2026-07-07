# PulseService — Adversarial Mobile Review #4 (Busy Technician Perspective)

**Reviewed at:** commit `af7d021` ("Merge origin/main (My Day call fix,
inventory CSV, search input debounce fix)")
**Prior review:** `c90bf0d` (scored ~7/10) — see `MOBILE-REVIEW-3.md`,
`MOBILE-REVIEW-2.md`, `MOBILE-REVIEW.md`
**Reviewer stance:** I'm a tech at Prime Comfort Solutions. I don't read
changelogs, I don't care about "Roles & Permissions redesigns," and I have
exactly one job right now: get this rooftop unit fixed before the building
manager calls my boss. My phone is my only tool for logging parts, clocking
in, and getting paid for my time. If this app gets between me and that, it's
a problem — full stop.
**Method:** Re-verified every line of `MOBILE-REVIEW-3.md`'s scorecard against
the live code (not assumed carried-over). Then dug into everything shipped
since that actually touches a tech's phone: job archiving's effect on the tech
view, Serialized Units' new CRUD and its permission gates, the new Help
Center's auto-open behavior, and the new self-registered service worker /
update-prompt. Cross-checked `backend/src/constants/permissions.js`
(`technician: ["jobs.status", "inventory.issueToJob"]`) against every `<Can>`
gate touched this round, and pulled the actual `vite-plugin-pwa` docs to
verify what `registerType: "autoUpdate"` + `skipWaiting: true` really does to
an open tab.

---

## TL;DR verdict — 6/10 (down from 7)

Here's the thing that actually matters to me: **nobody touched the screen I
live in.** Job Detail's materials card still has thumbnail-sized "Add part" /
"Install unit" links and a "Remove" trash icon I have to squint and aim for
with a gloved thumb — same as last review, not one pixel bigger, despite this
exact round shipping a commit *literally titled* "touch target fixes" that
fixed a toggle switch in a settings screen I will open maybe twice a year. The
"Edit" button on a job I can't actually save is still sitting there ready to
eat ten minutes of my time before it 403s on me. Both of those were called
out last review as the top two things to fix on my screen. Neither got fixed.

Then this round added two new ways to slow me down. First: there's now a
"Help" popup that throws itself in my face — dimming the whole screen — the
first time I ever open My Day or a job. Fine once, I guess, but it's landing
on the two screens I open more than any other in this whole app, and it
happens automatically, not because I asked for it. Second, and worse: I dug
into how the "an update is available, tap Reload" toast actually works, and
it turns out that's not really how this thing is configured — the underlying
service worker is set to auto-update and auto-claim the page *before* I ever
see or tap anything. If somebody pushes a deploy while I'm mid-way through
logging a part on a job, there's a real chance my browser tab gets swapped
out from under me — and if it doesn't get the toast right, it silently
reloads via a different code path entirely. That's my half-typed quantity
field, gone, no warning. That is exactly the nightmare scenario this app's
own competitors (ServiceTitan, Housecall, Jobber, FieldEdge) figured out how
to avoid years ago — their apps just don't do that to you mid-form.

On top of that, I went looking for the new "Serialized Units" screen (it's in
my drawer now, so I tapped it) — every action column on that page is just a
row of gray dashes for me. Not just the Edit/Delete buttons the office needs
gated off — the *Install* button too, the one thing I might actually want to
do there. I have to go back to the job and use the materials card instead. So
that's a whole page in my nav that does nothing for me.

Genuinely, the archive/restore stuff added this round is invisible to me like
it should be — I checked, and I don't see clutter on Jobs or Job Detail from
that. The Call button still just works. That's the good news. But between an
untouched top complaint from last time, a screen-dimming popup landing on my
two home screens, and a PWA update mechanism that can eat my typing mid-job,
this round nets out worse for me than the last one, even though the overall
app kept adding polish elsewhere. I'd put this behind Housecall Pro and
Jobber on "doesn't get in my way while I'm working" — which is the only
category I grade on.

---

## Scorecard vs. `MOBILE-REVIEW-3.md`'s findings

| # | Finding | Status |
| --- | --- | --- |
| N1 | C3 (iOS zoom-on-focus) never actually fixed — `text-sm` on native inputs beats the 16px media query | 🔴 **Still open, verified again.** `frontend/src/index.css:59-65`'s `@media (max-width: 640px) { input, select, textarea { font-size: 16px; } }` is still a bare-element selector (0,0,1 specificity). `components/ui/Input.tsx:34` and `components/ui/Select.tsx:35` still hard-code `text-sm` (0,1,0) directly on the native element, and every hand-rolled field checked this round (`CycleCountPage.tsx`, the `AddPartModal` in `JobDetailPage.tsx:911`) still repeats the same `"... rounded-lg text-sm ..."` string. Nothing shipped this round touched this. Still the single highest-leverage fix available, two reviews running. |
| N2 | Tech bottom bar burns a slot on "Dispatch," a screen techs can't use | 🔴 **Still open, unchanged.** `BottomTabBar.tsx:17-21`'s `techTabs` is still `My Day / Jobs / Dispatch`; `DispatchPage.tsx` still has zero `useIsMobile`/`<Can>`/`hidden md:` guards (grepped again, zero hits). |
| N3 | Unguarded "Edit" button lets a tech fill out a whole job form that 403s on save | 🔴 **Still open, unchanged.** `JobDetailPage.tsx:212-222`'s Edit button has no `<Can>` wrapper; `App.tsx`'s `jobs/:id/edit` route still renders `JobFormPage` with zero permission checks (grepped, zero hits for `Can permission`/`usePermissions`). A tech's permission set is still `["jobs.status", "inventory.issueToJob"]` — no `jobs.edit`. |
| N4 | `CycleCountPage.tsx` reintroduces a bare `<table>` with no mobile treatment | 🔴 **Still open, unchanged.** `CycleCountPage.tsx:133-199` is still a plain 4-column `<table>`, no breakpoint, no card fallback. Not tech-primary (gated to `inventory.manage`), so lower priority for this review, but confirmed unfixed. |
| N5 | `LineItemsTable.tsx` never got a mobile pass, now tech-relevant via pricing tiers | 🔴 **Still open, unchanged.** Still a plain 6-column `<table>` with no `overflow-x-auto`, no breakpoint, no card mode (`LineItemsTable.tsx:28+`). |
| N6 | `AddPartModal`'s part picker is an unfiltered, unsearched `<select>` of the whole catalog; no barcode scanner wired in | 🔴 **Still open, unchanged.** `JobDetailPage.tsx:876-877,920-933` — `useInventoryItems()` called with no args, still a flat native `<select>`, still no search box (unlike its sibling `InstallSerialModal`, which still has one at `InstallSerialModal.tsx:108-118` and hasn't regressed). `BarcodeScanner` still not referenced from either modal. |
| N7 | My Day maps fix didn't propagate to Job Detail's stale Google-only directions link | ⬜ **Not re-verified this round** (out of scope for this pass — no changes touched `lib/maps.ts` or Job Detail's directions link this round; treat as still open). |
| H2 (partial) | `JobMaterialsCard`'s "Add part"/"Install unit"/trash-icon tap targets are bare `text-xs`, under 44px | 🔴 **Still open — and notably skipped by this round's own dedicated mobile-audit commit.** `JobDetailPage.tsx:700-707` ("Add part"/"Install unit") and `:744-757`/`:799-808` (trash icons) are byte-for-byte unchanged. Commit `5a424a7` ("Mobile-audit today's changes: touch target + card fallbacks") fixed `Switch.tsx` (a Settings-only control) and Job Detail's *action-row layout*, but passed over this exact card two clicks away in the same file. |
| — | Switch component 24px touch target (prior-round finding) | ✅ **Fixed, verified.** `Switch.tsx:33-38` now wraps the small visual track in a `min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0` button — a real 44px hit area on touch, tightened back down on pointer devices. Low priority for a tech (Settings screen), but confirmed correct. |
| — | My Day Call button (prior-round fix) | ✅ **Fixed, verified, and it's good.** `frontend/src/utils/phone.ts`'s `canDial()`/`dialOrCopyPhone()` correctly detects Android/iPhone/iPad/Mobile UAs and fires a real `tel:` link on an actual phone (the case that matters), falling back to clipboard-copy + toast on desktop. `MyDayPage.tsx:221-232` wires it to a `min-h-[44px]` button. This is the one thing on my home screen that just works. |

---

## New findings (introduced or exposed by the recent work)

**N1 — The PWA "Reload" toast is largely theater; the underlying config is
set to auto-reload a tab out from under whatever I'm doing.** `main.tsx`
registers the service worker and shows a dismiss-free toast on
`onNeedRefresh()`, asking me to tap "Reload." That reads like the safe,
user-controlled pattern. But `vite.config.ts:9` sets
`registerType: "autoUpdate"`, and per `vite-plugin-pwa`'s own docs, that mode
"forces `workbox.clientsClaim` and `workbox.skipWaiting` to `true`" (both of
which are also explicitly set at `vite.config.ts:36-37`) and means: **"When a
new version of the application is detected, the browser will update caches
and automatically reload open windows/tabs... this can lead to data loss if
users are in the middle of filling out forms. For applications with forms,
it's recommended to use the `'prompt'` option."** That's not my
interpretation — that's the literal guidance from the library this app is
built on, describing this exact scenario. `registerType: "autoUpdate"` and a
hand-rolled "click Reload" toast are two different, contradictory update
strategies bolted together; the toast implies I have a choice, but the mode
underneath it is the one designed to *not* ask. Picture the real scenario:
I'm halfway through typing a quantity into `AddPartModal` on a job, dispatch
pushes a deploy, and my tab gets swapped out from under me — or, if the timing
doesn't line up with a clean SW handoff, a stale/missing chunk 404s and
`main.tsx`'s own `vite:preloadError` listener (lines 16-23) fires a **silent,
un-prompted `window.location.reload()`** with no confirmation of any kind.
Either path loses my half-filled form. This is precisely the failure mode the
task was worried about, and it's real — just one layer down from where the
toast makes it look solved. Fix: switch to `registerType: "prompt"` (which
is what the manual `onNeedRefresh` toast pattern is actually meant to pair
with) so the update genuinely waits for my tap, and consider warning before
reload if a form on-screen has unsaved input.

**N2 — The new Help Center auto-opens a full-screen-dimming modal on the two
screens I open the most, the first time (per browser) I land on them — and it
can double up in my very first session.** `Header.tsx:66-72`'s `useEffect`
calls `getPageHelp(location.pathname)` and, if `!hasSeen(helpContent.key)`,
immediately sets `helpOpen = true` — no tap required. `pageHelp.ts`'s route
table confirms this fires on `/my-day` (`sectionRoutes` line 932, key
`"my-day"`) *and* on `/jobs/:id` (`detailRoutes` line 917, key `"job-detail"`)
— my two most-visited screens, bar none. The modal itself
(`PageHelpModal.tsx` → `Modal.tsx`) is a Headless UI `Dialog` with a
`bg-black/30 backdrop-blur-sm` overlay — it genuinely dims and blocks
interaction with the page underneath until dismissed. The dismiss `X` is
`rounded-lg p-1` around a `h-5 w-5` icon (`Modal.tsx:63-70`) — roughly a 28px
hit target, well under this app's own 44px convention (the one `Switch.tsx`
was just patched to meet in this same round). Tapping the backdrop also
closes it, which softens this somewhat, but the first-run flow for any new
tech, or any tech on a new/reset phone, is: open My Day → screen dims, read
or dismiss a help card → tap into first job → screen dims again, read or
dismiss a second help card → *then* start working. It's a one-time tax (the
`localStorage` key means it won't repeat), but it's landing at exactly the
worst moment — onboarding day, first job of the day, when I'm both least
patient and most likely to be standing in front of a customer. Fix: don't
auto-open on the tech's two primary work routes at all (keep the "?" button
for opt-in access), or at minimum gate auto-open behind a non-blocking toast/
banner instead of a dimming modal for `my-day`/`job-detail` specifically.

**N3 — A technician can navigate to the new Serialized Units screen from
their own visible nav link and find every action column dead, including the
one action their permission is supposed to grant them.**
`Sidebar.tsx:51`'s `INVENTORY_FIELD = ["inventory.manage",
"inventory.issueToJob"]` gates the "Serialized Units" nav link, so a
technician (who has `inventory.issueToJob` per
`permissions.js:210`) genuinely sees this link in their drawer and can tap
into `/serials`. Once there, `SerializedUnitsPage.tsx:147-152` wraps the
*entire* "Change status" column — including the "Install" button
(`:170-181`), the only field-relevant action on this page — in `<Can
permission="inventory.manage">` with a `<span>—</span>` fallback. Same
pattern on the new "Actions" (Edit/Delete) column added this round
(`:186-211`). A technician has `inventory.issueToJob`, not
`inventory.manage`, so **both columns render as a wall of gray dashes** for
every row on the page. This isn't a new regression from this round's Edit/
Delete addition — the Install-column gating predates it — but this round
doubled down on the same wrong permission for the new buttons instead of
noticing the existing gap, and it directly contradicts what the sidebar link
itself implies ("you have inventory.issueToJob, this page is for you"). Net
effect for a tech tapping this link expecting to install a unit: a page that
does absolutely nothing for them. This is the exact scenario the audit asked
about, and the honest answer is "worse than leaking clutter" — it's a dead
end. Fix: change both `<Can permission="inventory.manage">` gates on this
page to `<Can permission={["inventory.manage", "inventory.issueToJob"]}>`
for the Install action specifically (keep Edit/Delete on `inventory.manage`
alone, correctly, as an office-only action) — mirroring the pattern already
used correctly in `JobDetailPage.tsx`'s `JobMaterialsCard`.

**N4 — This round's own "mobile audit" commit fixed a Settings toggle I'll
never touch and skipped the two touch-target complaints on the screen I use
all day.** Commit `5a424a7` is explicitly framed as sweeping the session's
changes for the mobile-first conventions used elsewhere. It fixed
`Switch.tsx` (used by Roles & Permissions — an office-only screen I can't
even open) and reflowed Job Detail's header action row from `grid-cols-2` to
a stacked flex column (a real, verified fix — see the scorecard). But
`JobMaterialsCard`, three lines away in the *exact same file* it edited
(`JobDetailPage.tsx`), still has the bare `text-xs` "Add part"/"Install unit"
links and unpadded trash-icon buttons flagged as H2 in the last review. If
the goal of that commit was "review everything changed this session for the
same conventions," the materials card should have been in scope — it's the
literal next section down the page from the header row that *was* fixed.

**N5 — Job Detail's archive/restore layout change is correct and invisible
to a tech, verified.** Not a complaint — confirming this because the task
asked for it directly. `JobDetailPage.tsx:200`'s action row is now `flex
flex-col gap-2 shrink-0 sm:flex-row sm:flex-wrap` with every button
`w-full sm:w-auto`, and Archive/Restore is wrapped in `<Can
permission="jobs.delete">` (`:223-250`). A technician's permission set
(`["jobs.status", "inventory.issueToJob"]`) has no `jobs.delete`, so they see
exactly two full-width stacked buttons (Update Status, Edit) with no gap or
orphaned grid cell — clean. Same on `JobsPage.tsx`'s desktop row
(`can("jobs.delete")` gate, `:344`) and its mobile card. The "Archived" badge
(`JobsPage.tsx:298-303`) is present on the mobile card view too. This round's
admin-facing work did not leak clutter onto a tech's screen — good discipline
here, just wish the same discipline reached N1-N4 above.

---

## What's genuinely better (for balance)

The Call button on My Day is exactly right for the one thing I actually do
with my thumb dozens of times a week: `phone.ts`'s `canDial()` correctly
detects a real phone and fires the native dialer instead of a dead `tel:`
link, with a sane clipboard fallback for anyone on a desktop. The `Switch`
component's touch target is now genuinely 44px on touch devices, not just
visually padded — small thing, but done right. This round's admin-facing
additions (job archiving on Jobs/Job Detail, the Invoice Payment History card
fallback) were built with the correct permission gates and didn't spill any
new clutter onto a technician's screen — I checked, not clutter for me. And
whoever wrote the `vite.config.ts` comments and the `main.tsx` reload toast
clearly had the right *intent* (the comment literally says "prompt the user
to reload... instead of silently leaving an old cached bundle running") — the
problem is one configuration flag (`registerType`) undoing that intent, not
a lack of care. That's a one-line fix away from being right.

---

## Prioritized remediation roadmap (highest leverage first)

1. **Fix the PWA update mode.** Switch `registerType` from `"autoUpdate"` to
   `"prompt"` in `vite.config.ts` so the existing `onNeedRefresh` toast in
   `main.tsx` actually gates the reload instead of racing an automatic one.
   This is the single scariest finding this round — a tech losing an
   in-progress parts entry to an unannounced deploy is a worse outcome than
   almost anything else in either mobile review to date.
2. **Fix the tap targets on `JobMaterialsCard`** (H2, still open two reviews
   running) — pad "Add part," "Install unit," and both trash-icon buttons to
   the same 44px convention `Switch` and `IconButton` already use elsewhere.
   This is the single most-touched interactive surface for a tech in the
   whole app and it's never gotten the fix.
3. **Don't auto-open the Help modal on `/my-day` and `/jobs/:id`.** Either
   drop these two routes from the auto-open behavior entirely (keep the "?"
   button for opt-in), or replace the dimming modal with a dismissible,
   non-blocking banner for tech-primary screens specifically.
4. **Fix the Serialized Units permission gate** — let `inventory.issueToJob`
   see and use the Install action (`<Can permission={["inventory.manage",
   "inventory.issueToJob"]}>`), matching the pattern already correct in
   `JobDetailPage.tsx`. Either that, or remove the nav link for
   `inventory.issueToJob`-only users so it stops promising something the
   page doesn't deliver.
5. **Fix C3 for real** (still the oldest open item, two reviews running) —
   strip `text-sm` off native `<input>`/`<select>`/`<textarea>` in `Input.tsx`
   /`Select.tsx` and every hand-rolled field, or make the anti-zoom rule an
   actual override. One change, fixes iOS zoom-on-focus everywhere at once.
6. **Gate `JobFormPage`/the Edit button by `jobs.edit`** (still open, two
   reviews running) — a tech should never be able to fill out a whole edit
   form only to get a 403 on save.
7. **Reconsider the tech bottom bar's third tab** (still open) — "Dispatch"
   remains a dead end for a role that can't act on it; a Materials/parts
   shortcut or Time Tracking would use that slot better.
8. Everything else carried over from Review #3 and still unfixed
   (`CycleCountPage`, `LineItemsTable`, `AddPartModal`'s unsearched picker,
   the stale Google-only directions link on Job Detail) — lower priority for
   a tech specifically, but worth closing before a fifth review finds them
   still sitting here.
