# Inventory API Reference

All routes are Next.js App Router handlers under `src/app/api/inventory/**/route.ts`
(base path `/api/inventory`). There are **106** route files. Each `route.ts` may export
several HTTP verbs (`GET`/`POST`/`PATCH`/`PUT`/`DELETE`); consult the individual file for the
exact verbs and payload. Dynamic segments use `[param]`.

Conventions (per project standards):
- Dynamic routes use `createGetHandlerWithParams<{ id: string }>`; static routes use `createGetHandler`.
- Query params parsed with `parseQueryParams(request, zodSchema)`.
- All handlers set `export const dynamic = "force-dynamic"`.
- Errors thrown as `ApiError` (400/404) / `ValidationError`.

---

## Items — collection & stats
| Path | Purpose |
|------|---------|
| `/api/inventory` | List / create items (search, filter, pagination) |
| `/api/inventory/stats` | Aggregate stats (counts, value, SKU breakdown, low/out-of-stock) |
| `/api/inventory/status` | Module/system status |
| `/api/inventory/stock` … `/stock/[id]` | Stock records |
| `/api/inventory/stock-out` | Out-of-stock listing |
| `/api/inventory/low-stock` | Low-stock listing |
| `/api/inventory/total-value` | Total inventory valuation |
| `/api/inventory/attention-items` | Items needing attention |
| `/api/inventory/categories` | Categories lookup |
| `/api/inventory/bulk` | Bulk operations |
| `/api/inventory/export` | Export items |
| `/api/inventory/labels` | Print/label generation |

## Item — single (`/api/inventory/[id]/...`)
| Path | Purpose |
|------|---------|
| `[id]` | Get / update / archive item |
| `[id]/adjust` | Stock adjustment (+GL) |
| `[id]/count` | Physical count (+variance GL) |
| `[id]/issue` | Issue stock (+GL) |
| `[id]/receive` | Receive stock |
| `[id]/transfer` | Store-to-store transfer |
| `[id]/bin-transfer` | Bin-to-bin transfer within a store |
| `[id]/bins` | Bins for item |
| `[id]/archive` | Archive/unarchive |
| `[id]/transactions` | Item transaction history |
| `[id]/reservations` | Item reservations |
| `[id]/total-reserved` | Total reserved qty |
| `[id]/requisitions` | Linked requisitions |
| `[id]/purchase-orders` | Linked POs |
| `[id]/work-orders` | Linked work orders |
| `[id]/relationships` | Related records |
| `[id]/serial-numbers` | Repairable serials |
| `[id]/next-repairable-serials` | Next serial allocation |
| `[id]/assembly-bom` | Assembly BOM |
| `[id]/long-text` | Long-text field |

## Items sub-resources (`/api/inventory/items/[id]/...`)
| Path | Purpose |
|------|---------|
| `items/[id]/direct-issues` | Direct issues for item |
| `items/[id]/lead-time` | Lead-time management |
| `items/[id]/documents` (+ `/[docId]`, `/[docId]/download`) | Item documents |
| `items/[id]/suppliers` (+ `/[supplierId]`, `/[supplierId]/delivery`) | Per-item suppliers & delivery perf |
| `items/[id]/suppliers/compare` | Compare suppliers |
| `items/[id]/suppliers/select-best` | Pick best supplier |

## Stores
| Path | Purpose |
|------|---------|
| `/api/inventory/stores` … `/stores/[id]` | Storerooms CRUD |

## Suppliers (module-level)
| Path | Purpose |
|------|---------|
| `/api/inventory/suppliers/[id]/performance` | Supplier performance |
| `/api/inventory/suppliers/bulk-assign` | Bulk supplier assignment |

## Transactions
| Path | Purpose |
|------|---------|
| `/api/inventory/transactions` | List/create transactions |
| `/api/inventory/transactions/export` | Export ledger |
| `/api/inventory/transactions/[id]/verify` | Verify a transaction |
| `/api/inventory/transactions/[id]/reverse` | Reverse a transaction |

## Direct issues
| Path | Purpose |
|------|---------|
| `/api/inventory/direct-issues` | List/create direct issues |
| `/api/inventory/direct-issues/summary` | Summary |
| `/api/inventory/direct-issues/[id]` | Detail |
| `/api/inventory/direct-issues/[id]/return` | Return a direct issue |

## Reservations
| Path | Purpose |
|------|---------|
| `/api/inventory/reservations` | List/create |
| `/api/inventory/reservations/[id]` | Detail |
| `/api/inventory/reservations/[id]/confirm` | Confirm |
| `/api/inventory/reservations/[id]/consume` | Consume |
| `/api/inventory/reservations/[id]/cancel` | Cancel |
| `/api/inventory/reservations/[id]/review-history` | Review log |
| `/api/inventory/reservations/bulk-confirm` | Bulk confirm |
| `/api/inventory/reservations/create-with-requisition` | Reserve + auto-raise REQ on shortage |
| `/api/inventory/reservations/expired` | Expired reservations |
| `/api/inventory/reservations/pending-review` (+ `/summary`) | Review queue |
| `/api/inventory/reservations/transparency-check` | Consistency check |
| `/api/inventory/reservations/validate-lead-time` | Lead-time validation |
| `/api/inventory/reservations-summary` | Global summary |

## Cycle counts (`/api/inventory/cycle-count/...`)
| Path | Purpose |
|------|---------|
| `cycle-count` | List/create counts |
| `cycle-count/create-from-abc` | Generate from ABC schedule |
| `cycle-count/[id]` | Detail |
| `cycle-count/[id]/summary` / `variance` / `audit` / `search` | Views |
| `cycle-count/[id]/bins` (+ `/[bin]`) | Bin-level counting |
| `cycle-count/[id]/items` (+ `/[itemId]/count`, `/recount`, `/verify`) | Item counting |
| `cycle-count/[id]/submit` / `review` / `approve` / `reject` / `complete` / `post` | Workflow + GL post |

## ABC classification (`/api/inventory/abc-classification/...`)
| Path | Purpose |
|------|---------|
| `abc-classification` | Overview |
| `abc-classification/calculate` | Run classification |
| `abc-classification/distribution` | Class distribution |
| `abc-classification/due` | Items due for reclassification |
| `abc-classification/items` | Classified items |
| `abc-classification/report` | Report |
| `abc-classification/settings` | Thresholds/config |
| `abc-classification/history/[itemId]` | Per-item history |

## Reorder / monitoring / availability
| Path | Purpose |
|------|---------|
| `/api/inventory/reorder/dashboard` | Reorder dashboard |
| `/api/inventory/reorder-suggestions` | Suggestions |
| `/api/inventory/monitor/execute` | Run low-stock monitor / auto-req |
| `/api/inventory/parts-availability` | Parts availability |
| `/api/inventory/parts-on-order` | On-order parts |
| `/api/inventory/pending-receipts` | Pending receipts |

## Assembly BOM
| Path | Purpose |
|------|---------|
| `/api/inventory/assembly-bom/[bomId]` | Assembly BOM entry |

## Data integrity
| Path | Purpose |
|------|---------|
| `/api/inventory/integrity/scan` | Scan for drift/issues |
| `/api/inventory/integrity/execute` | Apply fixes / self-heal |
| `/api/inventory/integrity/runs` | Run history |
| `/api/inventory/integrity/status` | Status |
