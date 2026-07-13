# Purchasing API Reference

Routes are Next.js App Router handlers under `src/app/api/purchasing/**/route.ts`
(base path `/api/purchasing`). Each `route.ts` may export several HTTP verbs; consult the file for
exact verbs and payloads. Dynamic segments use `[param]`. There are 127 purchasing route files;
the PO + receiving subset (38 files) is listed in full below, followed by the invoicing/config areas.

Conventions: dynamic routes use `createGetHandlerWithParams<{ id: string }>`; static routes use
`createGetHandler`; query params via `parseQueryParams(request, zodSchema)`; all set
`export const dynamic = "force-dynamic"`; errors via `ApiError` / `ValidationError`.

---

## Purchase orders — collection
| Path | Purpose |
|------|---------|
| `/api/purchasing/purchase-orders` | List / create POs (`purchaseOrderCreateSchema`) |
| `/api/purchasing/purchase-orders/stats` | PO dashboard stats |
| `/api/purchasing/pending` | Pending purchasing items |

## Purchase order — single (`/api/purchasing/purchase-orders/[id]/...`)
| Path | Purpose |
|------|---------|
| `[id]` | Get / update / delete PO |
| `[id]/status` | Read/set status |
| `[id]/submit` | Draft → Submitted |
| `[id]/approve` | Submitted → Approved |
| `[id]/reject` | Reject back to Draft |
| `[id]/send` | Send PO to supplier (→ Ordered) |
| `[id]/close` (+ `/close-info`) | Close PO / closeability info |
| `[id]/cancel` | Cancel PO (`purchaseOrderCancelSchema`) |
| `[id]/cancel-for-edit` | Cancel to allow editing (id-based line matching) |
| `[id]/add-lines` | Add lines to existing PO |
| `[id]/lines/[lineId]/allocations` | Charge allocations for a line |
| `[id]/lines/[lineId]/long-text` | PO-specific long text |
| `[id]/lines/[lineId]/scrap` | Cancel/scrap a single line |
| `[id]/receive-items` | **Batch receive (assigns `storeId` per line)** — `receiveItemsSchema` |
| `[id]/receive` | Receive (alternate entry) |
| `[id]/partial-receive` | Partial receive |
| `[id]/receipts` | List receipts for PO |
| `[id]/receipts/[receiptId]` | Receipt detail |
| `[id]/receipts/[receiptId]/reverse` | Reverse a receipt |
| `[id]/receiving-history` | Receiving history |
| `[id]/repairable-serials` | Serials for repairable lines |
| `[id]/invoices` | Invoices linked to PO |
| `[id]/invoice-approver` / `default-invoice-approver` | Invoice approver assignment |
| `[id]/account-code` / `project` / `budget-type` | GL coding on the PO |
| `[id]/reclass-je` | Reclass journal entry |
| `[id]/link-work-order` | Link a work order |
| `[id]/creator` | Creator info |
| `[id]/history` | Audit/change history |
| `[id]/pdf` | Rendered PO PDF |
| `[id]/documents` (+ `/[docId]`, `/[docId]/download`) | PO attachments |

## Requisitions (optional upstream — feeds POs)
| Path | Purpose |
|------|---------|
| `/api/purchasing/approval-levels` (+ `/[id]`) | Requisition approval levels |
| `/api/purchasing/approval-settings` | Approval thresholds/config |
| (requisition CRUD/convert routes live under the requisitions area/service `requisition/**`) | |

## Invoicing / 3-way match (optional in target)
| Path | Purpose |
|------|---------|
| `/api/purchasing/invoices` (+ `/[id]`) | Invoice CRUD |
| `/api/purchasing/invoices/upload` / `extract-pdf-data` | Upload + PDF parse |
| `/api/purchasing/invoices/[id]/approve` / `reject` / `void` / `pay` | Invoice workflow |
| `/api/purchasing/invoices/[id]/match` / `match-receipts` | Match invoice ↔ receipts |
| `/api/purchasing/invoices/[id]/finance-review` / `reassign-approver` | Review/routing |
| `/api/purchasing/invoices/[id]/approval-history` / `pdf` | History / PDF |
| `/api/purchasing/invoices/[id]/documents` (+ `/[docId]`, `/download`) | Invoice attachments |
| `/api/purchasing/invoices/aging` (+ `/export/{excel,pdf,copies}`) | AP aging |
| `/api/purchasing/invoices/pending-approvals` / `on-hold` / `check-duplicate` / `eligible-approvers` / `export` | Queues & utilities |
| `/api/purchasing/invoice-approvers` | Approver directory |

## Admin / settings (relevant to purchasing)
| Path | Purpose |
|------|---------|
| `/api/admin/inventory/settings` | Inventory module settings |
| `/api/inventory/stores` (+ `/[id]`) | **Stores CRUD — create the warehouse & each truck here** |

> Minimal target-system surface: to reproduce "create PO → receive to truck/warehouse" you only need
> `purchase-orders` (list/create/[id]), `[id]/receive-items`, `[id]/receipts` (+ reverse), and
> `inventory/stores`. Everything under invoicing/RMA/requisitions/approval is optional.
