# Rebrand Scope — "PulseService" → "Prime Comfort Solutions"

Goal: replace all **front-facing** occurrences of "PulseService" with "Prime
Comfort Solutions" so the product can be demoed to the client. This document
maps every occurrence, splits it into must-change vs. leave-alone, and gives a
phased plan with effort estimates.

---

## The big lever: branding is already data-driven

Every **customer-facing document** already reads the company name (and address,
phone, email, website, logo) from the `CompanySettings` row in the database and
falls back to the literal `"PulseService"` only when that field is blank:

- Invoice / estimate / agreement **PDFs** — `pdf.service.js` (`company.name || "PulseService"`)
- Invoice / estimate / agreement **emails** — `invoices/estimates/agreements.controller.js` (`settings?.name || "PulseService"`)
- **Public estimate approval page** — `PublicEstimatePage.tsx` (`estimate.company?.name ?? "PulseService"`)

**Implication:** editing the single `CompanySettings` record instantly rebrands
every document a customer ever sees — **no code change, no deploy.** This should
be step one. The seeded value today is `"PulseService HVAC & Plumbing"`
(`prisma/seed.js:88`).

Everything below is the remaining **app chrome** (login, sidebar, browser tab,
PWA) and **static assets**, which are hardcoded and are *not* driven by
`CompanySettings`.

---

## Tier 1 — Must change for the demo (visible in-app)

| Location | File | What shows |
| --- | --- | --- |
| Login title, tagline, copyright, demo hint | `frontend/src/pages/LoginPage.tsx` (L64 H1, L65 tagline, L171 copyright, L33 & L160 `admin@pulseservice.com` hint) | First screen the client sees |
| Sidebar brand text | `frontend/src/components/layout/Sidebar.tsx:229` | Persistent on every page |
| Browser tab title + iOS web-app title | `frontend/index.html:20-21` | Tab / bookmark / home-screen |
| PWA manifest name/short_name/description | `frontend/vite.config.ts:22-24` | "Add to home screen" install |
| Header page-title fallback | `frontend/src/components/layout/Header.tsx:49` | Top bar when a route has no title |
| **Seeded company name** | `prisma/seed.js:88` (or just edit via Settings → Company) | Drives all documents (see above) |
| Logo mark (⚡ `BoltIcon`) + favicon / PWA icons | `Sidebar.tsx`, `LoginPage.tsx`, `frontend/public/*` icons | Visual identity |

> **Note:** `index.html`, the manifest, and `push-sw.js` are **static** — they
> only update after a frontend rebuild (`docker compose up -d --build`), exactly
> like the button change we just shipped.

---

## Tier 2 — Should change (front-facing but secondary)

| Location | File | Notes |
| --- | --- | --- |
| Help Center intro + user-mgmt help copy | `frontend/src/pages/HelpCenterPage.tsx:90`, `frontend/src/content/pageHelp.ts:826` | Says "…what each page in PulseService does" |
| QuickBooks tab explainer | `frontend/src/components/settings/QuickBooksTab.tsx:31` | "PulseService is the system of record…" |
| Error-report copy header | `frontend/src/lib/toast.tsx:13` | Shown in the "copy error" text |
| Push notification default title | `frontend/public/push-sw.js:13`, `backend/src/controllers/push.controller.js:53` | Notification banner |
| Email `From` fallback | `backend/src/services/email.service.js:47` | Prefer setting `SMTP_FROM` env instead |
| Document fallback strings | `pdf.service.js:49 & 283`, `invoices/estimates/agreements.controller.js` | Moot once `CompanySettings.name` is set, but change for consistency |
| Demo seed branding | `prisma/seed.js` (`@pulseservice.com` users, L2053 demo SMS "this is PulseService", credentials banner), `prisma/seed-demo.js` | Visible if the client browses demo data / messages |

---

## Tier 3 — Leave as-is (internal; changing risks breakage, not front-facing)

- **Package names** — `frontend/package.json`, `backend/package.json`, both lockfiles (`pulseservice-frontend`/`-backend`).
- **Docker image/container names** — `docker-compose.yml` (`pulseservice-backend`, etc.). Renaming orphans the current containers/volume.
- **QuickBooks defaults** — `QuickBooksSettings` `webConnectorUsername` / `appId` / `appName` / `pulseservice.qwc` filename. Only seen by an admin configuring QuickBooks, and editable in-app; skip for the demo.
- **Geocode User-Agent** — `geocode.service.js` (sent to Nominatim only).
- **Backend API landing page** — `backend/src/app.js` HTML (dev-only page at the API root; not part of the app UI).
- **Dev-secret fallbacks & code identifiers** — `publicToken.js` (`pulseservice-dev-secret`), JWT default, comments, docstrings, schema comments, test fixtures (`soap.util.test.js`). Not user-visible.

---

## Recommended approach

**Option A — targeted replace (fastest, demo-focused).**
Edit `CompanySettings` (Phase 0), then find-and-replace Tier 1 (+ optionally
Tier 2) strings and swap the logo/icons. Lowest effort; good enough for a demo.

**Option B — centralize the brand (recommended if white-labeling more clients).**
Introduce a single source of truth so future rebrands are one edit:
- Frontend: `src/config/brand.ts` exporting `BRAND_NAME`, `BRAND_TAGLINE`, referenced by `LoginPage`, `Sidebar`, `Header`, toast, help copy.
- Static files: inject via Vite `define`/`%VITE_*%` HTML env for `index.html`, and generate the manifest name from the same env in `vite.config.ts`.
- Backend: a `BRAND` constant (or reuse `CompanySettings`) for push/email fallbacks.

Given the notes suggest this platform may be shown to multiple HVAC shops, Option
B is worth the small extra investment — but Option A unblocks the demo now.

---

## Phased plan & effort

| Phase | Work | Effort |
| --- | --- | --- |
| **0** | Edit `CompanySettings` via Settings → Company: name, address, phone, email, website, logo. Rebrands **all documents** immediately, no deploy. | ~5 min |
| **1** | Tier 1 app-chrome strings + static assets (login, sidebar, tab title, manifest, header) + logo/favicon swap. Rebuild frontend. | ~2–3 h |
| **2** | Tier 2 secondary strings + reseed/scrub demo data so nothing reads "PulseService". | ~1–2 h |
| **3** *(optional)* | Option B centralization + theme accent color to match Prime's brand. | ~1 day |

---

## Demo-readiness checklist

- [ ] `CompanySettings` shows Prime Comfort Solutions (name/address/phone/email/website/logo, license `#CAC1823441`).
- [ ] Login screen: title, tagline, copyright, and demo-credential hint updated.
- [ ] Sidebar + browser tab + favicon show Prime Comfort.
- [ ] Generate an invoice / estimate / **agreement** PDF → header shows Prime Comfort.
- [ ] Send a document email → `From`, subject, and body show Prime Comfort.
- [ ] Public estimate approval link → shows Prime Comfort.
- [ ] Browse demo customers/messages → no stray "PulseService" text.
- [ ] Frontend rebuilt (`docker compose up -d --build`) so static assets refreshed.

---

## Gotchas

- **Static-asset caching:** changing the manifest/service-worker name can leave a
  stale PWA cache; bump/clear it or hard-refresh after rebuild.
- **Demo login emails:** credentials use `@pulseservice.com`. If you reseed users
  to `@primecomfortac.com`, the login you use for the demo changes too — decide
  before reseeding. (Leaving them is fine; only admins see those addresses.)
- **Don't rename Docker containers/volume** for the demo — you'd lose the seeded
  data currently in Postgres.
- Two logos to source: the in-app mark (replaces the ⚡ `BoltIcon`) and the
  favicon/PWA icon set in `frontend/public/`.
