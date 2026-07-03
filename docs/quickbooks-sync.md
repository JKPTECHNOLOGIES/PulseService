# QuickBooks Desktop Sync

PulseService is the system of record for invoicing/AR. QuickBooks Desktop has
no server of its own, so the only integration path is **QuickBooks Web
Connector (QBWC)** — a small Intuit app that runs next to QuickBooks Desktop
and *polls* our SOAP endpoint on a timer, pulling down whatever's queued. This
is a true pull architecture (matches "QuickBooks pulls from us"), but it also
means **there is no instant/real-time push** — the practical ceiling is
"QBWC polls automatically every few minutes," plus a manual retry from
Settings → QuickBooks whenever you don't want to wait.

## Architecture

```
Customer/Invoice/Payment change in PulseService
        │  enqueueSync(entityType, entityId)
        ▼
QuickBooksSyncQueue (status: pending)
        │
        │  QuickBooks Web Connector polls our SOAP endpoint
        ▼
POST /api/v1/quickbooks/soap  (no JWT — QBWC authenticates via `authenticate()`)
  authenticate → sendRequestXML → receiveResponseXML → ... → closeConnection
        │
        ▼
qbXML request/response  (src/services/quickbooks/qbxml.service.js)
        │
        ▼
QuickBooksMapping (entityType, entityId) ↔ (QuickBooks ListID/TxnID, EditSequence)
```

Key files:
- `src/services/quickbooks/soap.util.js` — generic SOAP 1.1 envelope parse/build.
- `src/services/quickbooks/qbxml.service.js` — qbXML request builders (Customer
  Add/Mod) + response parser. **This is where Invoice/Payment builders slot in
  later** — nothing about the SOAP session state machine needs to change.
- `src/services/quickbooks/sync-queue.service.js` — the outbound queue:
  enqueue, dequeue, mark sent/synced/error, apply a parsed response.
- `src/controllers/quickbooksSoap.controller.js` — implements the 8 QBWC SOAP
  methods.
- `src/controllers/quickbooks.controller.js` — authenticated admin API
  (settings, `.qwc` file generation, sync queue, item mappings).

## Why customer-only so far

Every QuickBooks invoice line needs a QuickBooks **Item** reference (Items
carry the GL account internally — we never need raw GL codes, just Item
names). We don't have the bookkeeper's real Item list yet, so:

- **Customer sync is fully implemented** — no Item dependency.
- **Invoice/Payment sync are not built yet.** The `QuickBooksItemMapping`
  table and its Settings UI exist and are seeded with obvious placeholders
  (`PLACEHOLDER - Sales Tax`, etc.) so that work isn't blocked on the
  bookkeeper — swapping placeholders for real values is pure data entry,
  never a code change.

## Validating without any QuickBooks software installed

`backend/scripts/mock-webconnector.js` drives a full QBWC session against a
running backend, fabricating plausible qbXML responses (fake ListIDs/
EditSequences) in place of a real QuickBooks company file — including a
deliberately-scripted duplicate-name error to prove the failure path. Run it
with the backend up and seeded:

```bash
node backend/scripts/mock-webconnector.js [baseUrl]   # defaults to http://localhost:3000/api/v1
```

It exercises: enable settings → create/enqueue a customer → Add → scripted
failure → retry → success → edit the customer → Mod (using the stored
ListID/EditSequence) → confirms the mapping updates. This validates our
protocol handling against the documented spec, but **cannot** catch quirks a
specific real QuickBooks Desktop build might have that aren't in the docs —
that residual risk is only closed by a live rehearsal (see below).

Backend unit tests (`npm test`, no DB required) cover the pure qbXML/SOAP
builder and parser functions in isolation.

## Go-live checklist (the only remaining client-dependent steps)

1. Get the bookkeeper's real QuickBooks Item names (or a minimal placeholder
   set: one per major service category, one for parts, one for sales tax) and
   enter them in Settings → QuickBooks → Item mapping.
2. Confirm which QuickBooks Desktop year/edition they run (soft confirmation
   only — qbXML version negotiation reduces the risk of guessing wrong).
3. Enable the integration, set the Web Connector username/password in
   Settings → QuickBooks, and download the `.qwc` connector file.
4. On the machine running QuickBooks Desktop: open the `.qwc` file with
   QuickBooks Web Connector, enter the password, and let it run — this is the
   first live rehearsal against real QuickBooks.
5. Confirm invoice/payment sync are built and item-mapped before enabling
   them (customer sync can go live independently, today).

## Operational notes

- QuickBooks Desktop (and Web Connector) must actually be running on that
  machine for a sync to happen. If the office closes QuickBooks at day's end,
  sync simply resumes next time it's opened — that's normal for this
  architecture.
- Sessions are tracked in memory (a single backend process) — acceptable for
  our current single-container deployment.
- `QuickBooksSyncQueue` is append-only in spirit: rows move
  `pending → sent → synced | error`; a failed row can be retried from
  Settings → QuickBooks, which simply resets it to `pending`.
