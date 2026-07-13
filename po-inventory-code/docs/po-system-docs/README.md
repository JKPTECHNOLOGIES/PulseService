# Purchase Order (PO) System — Technical Documentation Package

Technical documentation for the **Purchasing / Purchase Order** module of the CRN Plant
Management application (`pulseplant`), assembled for porting into a simpler target system.

## Target-system context (read this first)

The receiving company is simpler than the source plant:
- They have **one internal warehouse** plus **several trucks that also act as warehouses**.
- They do **not** use bins.
- They **create the PO**, and **when receiving they assign the received goods to a truck or
  the internal warehouse**.

Good news: this maps onto the existing model with almost no schema change.
**Each stocking location (the warehouse and every truck) = one `Store` record.**
Receiving already takes a `storeId` per received line — so "assign to truck X" just means
selecting that truck's Store on the receive screen. **Bins can be dropped** (the code already
defaults `bin` to `"MAIN"`). See `04-receiving-and-locations-adaptation.md` for the full plan.

## Contents

| File | Description |
|------|-------------|
| `01-po-technical-reference.md` | Architecture, PO lifecycle, line types, services, receiving flow |
| `02-data-model.md` | Prisma data model for PO, POLine, POLineReceipt and related tables |
| `03-api-reference.md` | The purchasing REST endpoints (PO + receiving + invoices) |
| `04-receiving-and-locations-adaptation.md` | **How to adapt to warehouse + trucks-as-Stores, no bins** |
| `purchasing.prisma` | Verbatim copy of the purchasing Prisma schema (source of truth) |
| `requisitions.prisma` | Requisitions schema — the *optional* upstream that feeds POs |

## System at a glance
- **Stack:** Next.js (App Router) + TypeScript, Prisma ORM, PostgreSQL, NextAuth.
- **Layering:** pages → API route handlers (`src/app/api/purchasing/**`) → service layer
  (`src/services/purchasing/**`) → Prisma → PostgreSQL.
- **PO can be created directly** (supplier + line items) or converted from a Requisition.
- **Receiving** creates `POLineReceipt` rows, assigns a `storeId`, moves stock, and posts GL.
- **Financials:** receiving/invoicing post to the GL and update budgets (can be simplified/omitted
  in the target system — see the adaptation guide).

> Generated from the live codebase; `.prisma` files and the API list reflect the actual schema
> and route tree at time of export.
