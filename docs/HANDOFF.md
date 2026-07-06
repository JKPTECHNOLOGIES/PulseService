# PulseService — Handoff

Read this first if you're picking the project up. For architecture/how‑it‑works,
see **[`TECHNICAL.md`](./TECHNICAL.md)**.

---

## 1. Where things run (important)

| Machine | Role |
| --- | --- |
| **`10.4.4.23:8080`** | **The shared environment the team uses.** All testing happens here. |
| `10.4.4.52` | The dev/automation machine where code is edited and pushed to GitHub. **Not** used for testing. |

⚠️ **These are two different machines.** Code written on `.52` reaches `.23`
**only through GitHub**: push to GitHub, then on the `.23` host run
`git pull && docker compose up --build -d`. There is no direct deploy from `.52`
to `.23`, and `.52`'s running stack is irrelevant.

---

## 2. GitHub & credentials

- **Repo:** https://github.com/JKPTECHNOLOGIES/PulseService — **public**.
- **Account:** username **`Jax-JKP`**, email **`jax@jkp.technology`** (a
  collaborator with push access; the invite was accepted).
- **Password:** **not stored in this repo on purpose** (the repo is public —
  committing it would leak it). It lives in a git‑ignored file on the dev machine:
  **`PulseService/HANDOFF-CREDENTIALS.local.md`**. Get it from there or the team
  lead / password manager.
- **Pushing works without the password** on the working machines because git is
  authenticated via the **Windows Credential Manager**. (GitHub rejects the raw
  password over HTTPS anyway — it needs a PAT/SSH; the credential manager already
  holds a valid credential.)

> Security recommendation: rotate the password and switch to a **Personal Access
> Token** stored only in the credential manager.

### App logins (seeded demo users)
- Admin: `admin@pulseservice.com` / `admin123`
- Others (`pass123`): `dispatcher@`, `tech1@`, `tech2@`, `tech3@`, `csr@pulseservice.com`

---

## 3. Git workflow (agreed with the team)

There are **two developers** plus this automation, all pushing. To stay in sync:

1. **Before any change:** `git fetch` and fast‑forward/rebase onto the latest.
2. Make the change; **verify** (`tsc` + ESLint — see §6).
3. **Commit and push automatically** (no need to ask).
4. If the push is rejected (someone else pushed), `git fetch` + `git rebase
   origin/main`, then push again.
5. Push to **both `main` and `develop`** (they are kept identical:
   `git push origin main` then `git push origin main:develop`).

Branches: **`main`** and **`develop`** currently point at the same commit. There
is no long‑lived feature branch (an old `feat/postgres-db-driven-strict` was
deleted after merge). Consider consolidating to `main`‑only if the team agrees.

Running git from this repo on Windows (git not on PATH):
```sh
export PATH="/c/Program Files/Git/cmd:$PATH"
git -C PulseService <cmd>
```
Read‑only git commands are fine; expect harmless "LF will be replaced by CRLF"
warnings on commit.

---

## 4. Deploying to `10.4.4.23`

On the `.23` host, in the repo:
```sh
git pull
docker compose up --build -d      # rebuilds backend + frontend
```
Then **hard refresh** the browser (Ctrl + Shift + R).

- **Backend start auto‑syncs lookups** (`sync-lookups.js`), so new dropdown
  options/enums show up **without** a reseed.
- **Full reseed** (`docker compose down -v && docker compose up --build -d`) is
  only needed to reload **seed rows** (demo data / sample equipment / sample
  calls). ⚠️ It **erases entered data** — only do it if that's acceptable.
- If a page shows **"Failed to fetch dynamically imported module"**, that's a
  stale code‑split chunk; a hard refresh fixes it (and the app now auto‑reloads
  on that error). If it persists, unregister the service worker once
  (DevTools → Application → Service Workers).

---

## 5. Current status / what's been done

The app is in active build‑out. Highlights completed in recent work (newest
first, all on `main` + `develop`):

- **Docs:** this `docs/` folder; `samples/inventory-import-example.csv`.
- **NumberInput:** fixed controlled `type=number` fields that snapped back to `0`
  (couldn't be cleared) across pricing tiers, line items, inventory, agreements,
  job detail, purchase orders. New `components/ui/NumberInput.tsx`.
- **Stale‑chunk auto‑recovery** (`vite:preloadError` reload in `main.tsx`).
- **Job status timeline** visual fix (clean check icon, line layering/inset).
- **Dispatch board:** single‑technician assignment (no more duplicate cards),
  drag horizontally to reschedule time, drag to Unassigned to remove, job modal
  with assign/remove/**delete job** and a **Status** badge; cards colored by
  **status** (DB‑driven).
- **Serialized units:** uninstall (remove from job / return to stock).
- **Equipment / asset tracking** tab (serial, warranty, per‑unit service
  history) with free‑text `equipmentType` + DB‑driven `equipmentCondition`.
- **Notifications** bell → dedicated `/notifications` page.
- **Campaigns:** create + edit (incl. notes); **Calls** logging.
- **Clickable table rows** across Customers/Jobs/Estimates/Invoices; removed eye
  buttons; customer type colors (residential = blue, commercial = red).
- **Foundational:** SQLite → **PostgreSQL** migration; **DB‑driven enum** system
  (`Lookup` + `/metadata` + `sync-lookups`); typed axios client + `getErrorMessage`;
  strict ESLint (both packages pass clean); case‑insensitive Postgres search;
  nginx `no‑cache` for `index.html`.
- A partner has added large modules in parallel: **RBAC/permissions + audit**,
  **suppliers/purchasing/POs**, **serialized units**, **stock locations + cycle
  count**, **recurring jobs**, **attachments/signatures**, **time tracking**,
  **My Day**, **pricing tiers**, **customer messaging**, **QuickBooks sync
  (structured)**, **maps/geocode**, **dark mode**, **PWA/offline + push**,
  **CSV import/export**, **Vitest tests**, and multi‑device sync scripts.

---

## 6. How to verify before pushing

From the repo root (`Training`), using the dev machine's installed deps:
```sh
# Backend lint
npm --prefix PulseService/backend run lint

# Frontend type-check (what the Docker build runs) + lint
node PulseService/frontend/node_modules/typescript/bin/tsc -p PulseService/frontend/tsconfig.json --noEmit
npm --prefix PulseService/frontend run lint
```
All three must be clean. (If `tsc` complains about missing test type defs, run
`npm --prefix PulseService/frontend install` — a teammate may have added deps.)

Prisma schema check: `npm --prefix PulseService/backend exec -- prisma validate
--schema=PulseService/backend/prisma/schema.prisma` (needs a `DATABASE_URL` env).

---

## 7. Suggested next steps / open ideas

- Surface a customer's **equipment** inline on the Customer detail page; add an
  "add equipment from a job" shortcut.
- Make the job **status editable** from the dispatch modal (respecting the
  allowed `STATUS_TRANSITIONS`).
- Consider whether to keep **`develop`** or go `main`‑only; set up branch
  protection / PR flow to reduce push races between the two devs.
- **Rotate the GitHub credential** and move to a PAT (see §2).
- Harden the **service worker** cache‑busting so redeploys never serve stale
  chunks (currently mitigated by auto‑reload + hard refresh).

---

## 8. Gotchas cheat‑sheet

- New enum/dropdown empty on `.23`? → rebuild (`sync-lookups` fills it); no
  `down -v` needed.
- Feature "doesn't work" on `.23`? → it's almost always **not rebuilt/pulled**
  there yet, or a **stale tab** (hard refresh).
- Number field won't clear the `0`? → it's a raw controlled input; swap to
  `NumberInput`.
- Editor **format‑on‑save** may reflow files (quotes) — harmless; keep lint green.
