# Sample CSVs

## Export samples — one per "Export CSV" exporter

Each file mirrors the exact column headers and value formatting produced by the
**Export CSV** button on the corresponding list page's `DataTable` (dates render
as `MMM d, yyyy`, amounts as raw numbers, cells with commas are quoted). Use
them to eyeball the export format or as fixtures for testing.

| File | Page (Export CSV button) |
| --- | --- |
| `customers.csv` | Customers |
| `jobs.csv` | Jobs |
| `estimates.csv` | Estimates |
| `invoices.csv` | Invoices |
| `payments.csv` | Payments |
| `equipment.csv` | Equipment |
| `agreements.csv` | Service Agreements |
| `inventory.csv` | Inventory |
| `serialized-units.csv` | Serialized Units |
| `stock-locations.csv` | Inventory → Locations |
| `pricing-tiers.csv` | Pricing Tiers |
| `purchase-orders.csv` | Purchase Orders |
| `suppliers.csv` | Suppliers |
| `campaigns.csv` | Marketing → Campaigns |
| `calls.csv` | Marketing → Calls |
| `messages.csv` | Marketing → Messages |

Note: these match the **Export CSV** toolbar button (all displayed columns). The
bulk **Export selected** action on some pages uses a slightly different column
set.

## Import fixture (different format from export)

`inventory-import.csv` is for the **Inventory → Import** button — its columns are
what the importer expects, not what the export produces:

`sku, name, unit, quantity, unitCost, reorderPoint, reorderQuantity, supplierName, locationCode, serialized`

Details that make it import cleanly:

- **sku / name** are required; every row has both.
- **locationCode** uses real seeded codes: `WH` (default warehouse), `TRK101`,
  `TRK102`. A blank locationCode falls back to the default warehouse.
- **serialized** accepts `true` / `yes` / `y` / `1` for true; anything else
  (e.g. `no`) is false. The sample mixes these to exercise the parser.
- **supplierName** is matched to an existing supplier or created if new, so any
  name works (blank is allowed).
- SKUs are prefixed `IMP-` so they don't collide with seeded items. Importing
  the same file twice will conflict on those SKUs (expected — they already exist).
