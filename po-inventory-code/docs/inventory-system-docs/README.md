# Inventory System — Technical Documentation Package

This package contains technical documentation for the **Inventory Management** module
of the CRN Plant Management application (internal name: `pulseplant`).

It was assembled to hand the inventory subsystem off to / integrate it with another system.

## Contents

| File | Description |
|------|-------------|
| `01-inventory-technical-reference.md` | Full technical reference: architecture, data model, services, API surface, business rules |
| `02-data-model.md` | Prisma data model reference for every inventory table, field, enum and relation |
| `03-api-reference.md` | Complete list of the 106 inventory REST endpoints grouped by area |
| `04-business-rules-and-gotchas.md` | Costing (WAC), reservations, GL posting, and known edge cases |
| `inventory.prisma` | Verbatim copy of the inventory Prisma schema (source of truth for the data model) |
| `WAC-HOW-IT-WORKS.md` | Existing operator/finance doc for Weighted Average Costing |

## System at a glance

- **Stack:** Next.js (App Router) + TypeScript, Prisma ORM, PostgreSQL, NextAuth.
- **Layering:** React pages/components → Next.js API route handlers (`src/app/api/inventory/**`)
  → service layer (`src/services/inventory/**`) → Prisma → PostgreSQL.
- **Financial integration:** Every stock-moving operation (issue, return, adjustment, count
  variance) posts to the General Ledger through `inventory-gl.service.ts` and updates budget
  encumbrances/actuals.
- **Costing:** Monthly Weighted Average Cost (WAC) run recalculates `unitCost`; all cost
  changes are journaled in `InventoryItemCostHistory`.

> Generated from the live codebase. The `.prisma` file and `03-api-reference.md`
> reflect the actual schema and route tree at time of export.
