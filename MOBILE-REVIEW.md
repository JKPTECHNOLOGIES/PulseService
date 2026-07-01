# PulseService — Adversarial Mobile Review

**Reviewed at:** commit `56f721d` (2026-07-01)
**Method:** Read every layout/page component and compared the running responsive
web build against the mobile experience of the market-leading field-service
platforms — **ServiceTitan, Housecall Pro, Jobber, FieldEdge, Service Fusion,
Workiz.** This review is deliberately adversarial: the job here is to find what
is wrong, not to congratulate what works.

---

## TL;DR verdict

We have a **responsive website**, not a **mobile field-service app**. Over the
last few sessions we made the existing desktop UI survive on a small screen
(drawer nav, stacked dispatch, touch drag, photo uploads, responsive tables).
That closes the "it's broken on my phone" gap — but every serious competitor
ships a *native-feeling, installable, offline-capable app built around a
technician in a truck with one hand and bad signal.* Against that bar we are
roughly a **4/10**: usable in a pinch, not something a tech would choose to work
in all day.

The three things that most separate us from the field are, in order:
**(1) no installability/offline, (2) desktop tables & a gantt board forced onto
phones instead of purpose-built mobile views, and (3) no core field workflows
(navigate, capture payment, sign, clock in, get notified).**

---

## Benchmark: what the popular apps do on mobile that we don't

| Capability | ServiceTitan / Housecall / Jobber / FieldEdge | PulseService today |
| --- | --- | --- |
| Installable app (native or PWA) | ✅ Native iOS/Android apps | ❌ Browser tab only — no manifest, no icon, no "Add to Home Screen" |
| Works offline / syncs later | ✅ Core feature (poor-signal jobsites) | ❌ Online-only; any request fails with no signal |
| Push notifications | ✅ Native push (new job, schedule change) | ⚠️ In-app socket bell only; nothing when screen is off |
| Turn-by-turn / map to job | ✅ Tap address → navigate | ❌ We store `lat`/`lng` but show no map |
| In-field card payment | ✅ Card reader / tap-to-pay | ❌ Manual "record payment" only |
| Capture e-signature | ✅ Sign on glass | ❌ `signatureUrl` column exists, no capture UI |
| Clock in / out, time tracking | ✅ One tap from the job | ❌ `TimeEntry` model exists, no mobile UI |
| Photo capture w/ markup & required checklists | ✅ Annotate, before/after, required | ⚠️ Basic upload only (added this session) |
| Barcode/part scanning | ✅ Scan inventory/parts | ❌ None |
| Mobile-first lists (cards, not tables) | ✅ Stacked cards, tap to open | ❌ Desktop tables in a horizontal scroller |
| Bottom tab navigation (thumb reach) | ✅ Standard | ❌ Top-left hamburger drawer |

We are competitive on the **back-office** surface (CRUD for customers, jobs,
estimates, invoices, dispatch). We are absent on the **technician-in-the-field**
surface, which is the entire reason these apps have mobile products.

---

## Findings by severity

Severity reflects impact on a real mobile user, not effort to fix.

### 🔴 Critical

**C1 — Not installable, no offline, no push (architecture).**
There is no web app manifest, no service worker, no `apple-touch-icon`, and
`index.html` carries only a bare `<meta viewport>` (no `theme-color`, no
`apple-mobile-web-app-capable`, no `viewport-fit=cover`). Consequences:
- Cannot be added to the home screen as an app; opens as a browser tab with
  chrome eating vertical space.
- Zero offline capability. A tech in a basement/rural jobsite gets failed
  requests and a dead UI (`frontend/src/lib/api.ts` has no retry/queue).
- No web-push; the socket bell (`useNotifications`) only fires while the tab is
  foregrounded. A dispatch reassignment never reaches a tech whose phone is
  locked.
*Every competitor treats offline + push as table stakes.*

**C2 — Lists are desktop tables in a sideways scroller.**
Customers, Jobs, Estimates, Invoices, Payments, Pricebook, Marketing, Equipment,
and Settings→Team all render `<table>` wrapped in `overflow-x-auto`. On a phone
you must scroll horizontally to see status/amount/actions — the #1 mobile
anti-pattern. Popular apps show a stacked **card row** (title + 2–3 key facts +
status chip, tap to open). We should render cards below `sm:` and tables at
`md:+`.

**C3 — iOS zoom-on-focus everywhere.**
All inputs use `text-sm` (14px). Mobile Safari auto-zooms any focused input under
16px, causing the whole page to jump on every tap into a field
(`LoginPage.tsx`, all `*FormPage.tsx`, all modals). Fix: base input font ≥16px on
touch (or `text-base` on mobile).

### 🟠 High

**H1 — Forms cram multiple inputs per row on phones.**
`CustomerFormPage`, `JobFormPage`, `EstimateFormPage`, `InvoiceFormPage` use
fixed `grid-cols-2` / `grid-cols-3` with **no responsive breakpoint**, so two or
three inputs share ~150px each on a phone. It's also inconsistent — some
sections correctly use `grid-cols-1 md:grid-cols-2`. Standard: single column
under `sm:`.

**H2 — Tap targets below the minimum.**
Row action icons are `p-1.5` (~28px) and `size="sm"` buttons are `py-1.5`
(~30px) — under Apple's 44×44px / Google's 48dp guidance, and often packed side
by side (e.g. inventory edit/photo/history icons). Expect mis-taps with gloves
or thumbs.

**H3 — Navigation is a top-left drawer, not a bottom bar.**
The hamburger drawer (added this session) works but forces a reach to the
top-left corner on large phones — the worst spot for one-handed use. Field apps
put a persistent bottom tab bar (Today / Jobs / Schedule / More) in the thumb
zone.

**H4 — Heavy single bundle on cellular.**
`vite build` emits one ~1.17MB (~316KB gzip) chunk and warns >500KB. No route
code-splitting, no lazy loading. First load on 4G is slow, and there is no
service-worker cache to make the second load instant.

**H5 — Full-resolution images over the wire, no thumbnails.**
Attachments are stored as Postgres `bytea` and re-fetched at full resolution as
authenticated blobs on every view (`AttachmentGallery`), with only a 1-day cache
header and no CDN. Phone photos are 5–12MB; there is no client-side compression
on upload and no server-side thumbnail/resize. On cellular this is expensive and
slow — grid thumbnails should be resized derivatives.

### 🟡 Medium

**M1 — No safe-area handling.** Without `viewport-fit=cover` +
`env(safe-area-inset-*)`, the header/drawer can sit under the notch and the home
indicator on modern iPhones.

**M2 — Dispatch board is a gantt on a phone.** We made it visible/scrollable, but
techs want a **"My Day" agenda list** (their jobs, in order, with address +
status + navigate), not a pinch-and-scroll technician×hour grid.

**M3 — Sub-11px text on the board.** Dispatch uses `text-[9px]`/`text-[10px]`/
`text-[11px]` (chips, tech load, legend). Legible on a monitor, strained on a
phone.

**M4 — Custom overlays skip a11y/focus.** The image lightbox and mobile drawer
are hand-rolled `div`s with `onClick` (no roles, no keyboard, minimal focus
trap), unlike the Headless UI `Dialog` used elsewhere. Screen-reader and
keyboard users on mobile are second-class.

**M5 — No pull-to-refresh / optimistic feedback** on data lists; users can't do
the universal mobile "swipe down to refresh."

### 🟢 Low / polish

- No `inputMode`/`enterKeyHint` tuning on numeric/phone/search fields for better
  soft keyboards.
- No haptic/scroll affordances hinting that wide tables/boards scroll sideways.
- `-webkit-tap-highlight-color` unstyled → default grey flash on tap.
- No skeleton loaders on mobile (spinners only), which feels slower on high
  latency.

---

## What we actually got right (for balance)

- **Responsive shell:** drawer sidebar + hamburger, safe-ish stacking of detail
  headers and meta grids.
- **Touch dispatch:** `MouseSensor` + `TouchSensor` with press-and-hold so drag,
  tap, and scroll are disambiguated on touch.
- **Shared photo storage:** images live in Postgres and are reachable identically
  from web and mobile through one authenticated API — genuinely cross-device.
- **Lightbox portal fix:** preview escapes transformed/`overflow-hidden` ancestors
  and fits any aspect ratio.
- **Dispatch density done well:** KPI strip, per-tech utilization, live "now"
  line, and a status legend — all from already-loaded data.
- **Pricebook & Team Members** now stack/scroll instead of overflowing.

These are real, but they are all "make the desktop app tolerable on a phone."
None of them is a field-first capability.

---

## Prioritized remediation roadmap

**Phase 1 — Stop losing on fundamentals (1–2 days each)**
1. Ship a **PWA**: manifest + icons + `theme-color` + `vite-plugin-pwa` service
   worker (offline shell, cache-first assets). Makes it installable and fast on
   repeat loads. *(C1)*
2. **16px inputs on touch** + base input styles to kill iOS zoom. *(C3)*
3. **Responsive forms**: `grid-cols-1 sm:grid-cols-2/3` everywhere. *(H1)*
4. **Bigger tap targets**: minimum 44px hit areas on row actions and `sm`
   buttons. *(H2)*
5. **Safe-area insets** via `viewport-fit=cover` + padding utilities. *(M1)*

**Phase 2 — Make lists mobile-native (2–4 days)**
6. **Card list pattern** under `sm:` for all list pages; keep tables at `md:+`.
   *(C2)*
7. **Bottom tab bar** on mobile (Today / Jobs / Dispatch / More) alongside the
   drawer. *(H3)*
8. **Image thumbnails**: server-side resize + client-side compression on upload;
   proper cache/CDN story. *(H5)*
9. **Route code-splitting / lazy pages** to shrink first paint. *(H4)*

**Phase 3 — Actual field workflows (the real gap)**
10. **"My Day" technician view** — agenda of assigned jobs with address, status,
    and one-tap navigate (open Maps with `lat`/`lng`). *(M2)*
11. **Web push notifications** for dispatch/schedule changes. *(C1)*
12. **e-Signature capture** (wire up the existing `signatureUrl`).
13. **Clock in/out** from the job (wire up the existing `TimeEntry` model).
14. **Offline queue** for notes/status/photos with background sync.
15. **Barcode/QR scanning** for inventory & parts.

Phases 1–2 make us a legitimate responsive PWA. Phase 3 is what turns this from
"the office app on a phone" into something a technician would actually pick up.

---

*Filed as an internal engineering review. Nothing here is customer-facing.*
