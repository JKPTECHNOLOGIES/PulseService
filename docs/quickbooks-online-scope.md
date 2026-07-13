# QuickBooks Online — Integration & One-Time Import Scope

Scoping document for two distinct, independently-shippable pieces of work:

1. **QuickBooks Online (QBO) live integration** — an OAuth/REST equivalent of the
   existing QuickBooks *Desktop* (QBWC/SOAP) sync.
2. **One-time QBO data import** — a bulk pull of Customers / Items / open Invoices
   *out of* QuickBooks Online *into* PulseService, for clients migrating away from
   QuickBooks (see `PrimeComfortSolutions7-2.txt`: "what they're trying to do is
   UNTIE from quickbooks").

> **Why this is net-new work, not a "connect an account" task.** Everything
> shipped today (`docs/quickbooks-sync.md`) targets QuickBooks **Desktop** via the
> Web Connector: SOAP 1.1 + qbXML, a `.qwc` connector file, and Web-Connector
> username/password auth. QuickBooks **Online** is a completely different product
> surface: OAuth 2.0 + a JSON REST API at `quickbooks.api.intuit.com`. None of the
> Desktop transport code applies. The good news is that our sync is already
> layered so that roughly half of it — the part that decides *what* to sync — is
> transport-agnostic and reusable.

---

## 1. What we can reuse vs. what must be rebuilt

The current design already splits into an **enqueue side** (what changed, in what
order, with what dependencies) and a **drain side** (how it gets to QuickBooks).
Only the drain side is Desktop-specific.

| Layer | File(s) today | QBO reuse |
| --- | --- | --- |
| Enqueue on change | `enqueueSync()` calls in `customers.controller.js`, `invoices.controller.js`, `payments.controller.js` | ✅ **Reuse as-is.** Transport-agnostic — just writes queue rows. |
| Work queue | `QuickBooksSyncQueue` model + `sync-queue.service.js` (enqueue, dedupe, void-supersede) | ✅ **Reuse as-is.** `requestId` semantics carry over. |
| Dependency gating | `isReady()` / `getNextPending()` (customer→invoice→payment ordering) | ✅ **Reuse as-is.** Same ordering constraints apply in QBO. |
| Identity map | `QuickBooksMapping` (`quickbooksId`, `editSequence`) | ✅ **Reuse the table.** `quickbooksId` ← QBO entity `Id`; `editSequence` ← QBO `SyncToken`. No migration needed; column semantics just shift. |
| Item mapping | `QuickBooksItemMapping` + `item-mapping.service.js` + `ItemMappingCard` | 🟡 **Reuse structure; adapt values.** QBO invoice lines reference an Item **`Id`**, not a name — either store the QBO Id in `quickbooksItemName` or add a nullable `quickbooksItemId`. Add a "pull Items from QBO" helper so mapping is picklist-driven instead of hand-typed. |
| Request builders | `qbxml.service.js` (qbXML XML) | ⛔ **Rebuild.** Replace with JSON payload builders (`Customer`, `Invoice`, `Payment`/`SalesReceipt`, void via `Invoice?operation=void`). |
| Transport | `soap.util.js`, `quickbooksSoap.controller.js` (8 QBWC SOAP methods) | ⛔ **Rebuild.** Replace with an authenticated REST client + a push worker. |
| Connection setup | `.qwc` file (`downloadConnectorFile`), WebConnector user/pass in `QuickBooksSettings` | ⛔ **Rebuild.** Replace with OAuth 2.0 "Connect to QuickBooks" flow + token storage. |
| Settings UI | `QuickBooksTab.tsx` (Connection / Sync Queue / Item Mapping cards) | 🟡 **Reuse two of three cards.** Swap the Connection card's `.qwc`/username/password UI for Connect/Disconnect + connection status; Sync Queue + Item Mapping cards stay. |

**Bottom line:** the "which record, in what order, is it ready" brain is done.
The QBO work is a new *transport* (OAuth + REST + a pusher) bolted onto the
existing queue.

---

## 2. The one architectural gap QBO forces: a push driver

QBWC **polls us** — it calls our SOAP endpoint on its own timer, so we never
needed a background worker. QBO is the opposite: **we must push to Intuit**, and
there is currently **no scheduler/worker anywhere in the backend.** Even
`recurring.controller.js` drains via a `POST /recurring/run-due` endpoint that
something external has to call — there is no in-process `setInterval`/cron.

So QBO needs a driver for the queue. Two options, in order of preference:

- **Option A — `POST /quickbooks/flush` endpoint (recommended first cut).**
  Mirror the existing `recurring/run-due` pattern: an authenticated endpoint (and
  a "Sync now" button) that drains pending queue rows to QBO, driven by an
  external scheduler (host cron, container cron, or a platform scheduled task).
  Zero new in-process infrastructure; consistent with what's already here.
- **Option B — in-process scheduler** (`node-cron`/`setInterval`) that flushes on
  a timer. More "hands-off," but it's new always-on infrastructure and the current
  deployment is explicitly a single container with in-memory session state
  (`docs/quickbooks-sync.md`, "Operational notes"). Defer until multi-instance
  concerns are addressed.

Either way, the drain logic is the same; only the trigger differs.

---

## 3. QBO live integration — work breakdown

Scope parity with today's Desktop sync: **one-way push** of Customers, Invoices,
and Payments, with voids. (Two-way is a separate add-on, section 5.)

| # | Workstream | Notes | Est. |
| --- | --- | --- | --- |
| 1 | Intuit app registration + OAuth 2.0 authorization-code flow | `Connect` redirect → callback → token exchange; store `realmId` (company id); `Disconnect`/revoke. Sandbox + production credentials. | 3–4 d |
| 2 | Encrypted token storage + settings model | Access token (~1 h) + refresh token (~100 d, rolling) encrypted at rest; extend `QuickBooksSettings` (or a new `QuickBooksOAuth` row) for `realmId`, tokens, expiry, environment. | 1–2 d |
| 3 | REST client | Base-URL/env switch, minor-version param, bearer-token injection, **401 → refresh-and-retry**, rate-limit backoff (429; QBO caps ~500 req/min/realm), `Intuit-TID` capture for support. | 2–3 d |
| 4 | JSON payload builders + response apply | Replace `qbxml.service.js`: `Customer`, `Invoice` (line items + tax + discount, reusing `item-mapping.service.js`), `Payment`, void. Map response `Id`/`SyncToken` into `QuickBooksMapping`. Reuse `sync-queue.service.js` enqueue/dedupe/`isReady`. | 4–6 d |
| 5 | Push driver | `POST /quickbooks/flush` + "Sync now" (Option A above), one-at-a-time drain with the existing dependency gating. | 2–3 d |
| 6 | Item mapping adaptation | Reference QBO Item `Id`; add "pull Items/Accounts/Tax codes from QBO" so mappings become picklists, not free text. | 2 d |
| 7 | Frontend | Swap Connection card to OAuth Connect/Disconnect + status/last-sync; keep Sync Queue + Item Mapping cards; new copy (no more "Web Connector"). | 2–3 d |
| 8 | Sandbox QA, error paths, docs | Full run against an Intuit sandbox company; token-expiry, revoked-grant, duplicate-name, unmapped-item paths; write a `quickbooks-online.md`. | 3–4 d |

**Estimated total: ~19–27 engineer-days (≈ 4–5.5 weeks / ~1–1.5 months) for one
engineer**, excluding Intuit production-app review lead time (see risks).

---

## 4. One-time QBO data import — work breakdown

Direction is **inbound** (QBO → PulseService), the opposite of the sync. Ideal for
clients migrating *off* QuickBooks who need their history seeded once. Two paths;
they can coexist.

### Path A — CSV/Excel import (recommended for "untie from QuickBooks" clients)
No Intuit app, no OAuth. Client exports Customers, Items, and open Invoices from
QBO to CSV; we ingest.

- Import service with per-entity column mapping, validation, and de-dupe (match on
  email / name / invoice number).
- **Dry-run preview** ("would create X, update Y, N warnings") before commit.
- Upsert Customers → Pricebook Items → open Invoices (+ balances), respecting the
  same customer→invoice ordering.
- Simple upload UI (reuse existing table/EmptyState/Card components).
- Fits the Prime Comfort note "we scrub manually and export it from there / just
  under 1k items."

**Est. ~5–8 engineer-days.** Cheapest, fastest, no Intuit dependency.

### Path B — API one-time pull (higher fidelity)
Requires the OAuth app + REST **read** client (a subset of section 3, items 1–3).

- Query endpoints with pagination (`SELECT * FROM Customer STARTPOSITION n
  MAXRESULTS 1000`) for Customer, Item, Invoice, Payment.
- Map + upsert into our schema; record source `Id`s in `QuickBooksMapping` so a
  later switch to live sync doesn't duplicate records.
- Same dry-run preview + ordering as Path A.

**Est. ~8–12 engineer-days**, but **~4–5 of those days are shared** with the live
integration's OAuth + REST client if both are built — so doing the import first
de-risks and front-loads reusable work for the full sync.

---

## 5. Optional add-on — two-way sync (the thing Desktop can't do)

QBO can push **to us** via webhooks + Change Data Capture, enabling what
`DESKTOP-REVIEW` flagged as impossible on Desktop: pulling **payments recorded
directly in QuickBooks** and AR reconciliation back into PulseService. This is the
genuine capability upgrade of Online over Desktop.

- Webhook receiver (verifier-token validated) + CDC polling fallback.
- Inbound mapping for Payment/Invoice changes → update our records.
- Conflict policy (who wins when both sides edit).

**Est. ~1.5–3 additional weeks.** Recommend deferring until one-way + import are
proven.

---

## 6. Risks & dependencies

- **Intuit production-app approval** is an external gate. Sandbox is immediate;
  moving to production requires Intuit review of the app + OAuth/security posture.
  Start this early — it's calendar time, not engineering time.
- **Token lifecycle is unforgiving.** Refresh tokens rotate and expire (~100 d of
  inactivity); a missed refresh silently breaks sync. The 401→refresh→retry path
  and a "reconnect needed" banner are must-haves, not polish.
- **Item/account/tax mapping is still client-dependent**, exactly as with Desktop
  (`docs/quickbooks-sync.md` go-live checklist). QBO lets us turn free-text into
  picklists, which reduces error but doesn't remove the setup step.
- **Push driver decision** (section 2) should be settled up front; Option A keeps
  us consistent with the existing `run-due` pattern and adds no new infra.
- **Line-item edits after sync** carry the same documented limitation as Desktop
  unless we invest in full line reconciliation.

---

## 7. Recommended sequencing

1. **One-time import, Path A (CSV)** — fastest value, unblocks "untie from
   QuickBooks" clients, no Intuit dependency. *(~1–1.5 wk)*
2. **OAuth + REST read client** (shared foundation) → **Path B API import** if
   higher fidelity is needed. *(builds the reusable half of the live sync)*
3. **Live one-way QBO sync** (section 3) reusing the queue + mapping + item-mapping
   already in place. *(~1–1.5 mo)*
4. **Two-way / webhooks** (section 5) only if the client needs QBO-side payments
   and AR flowing back. *(~1.5–3 wk)*
