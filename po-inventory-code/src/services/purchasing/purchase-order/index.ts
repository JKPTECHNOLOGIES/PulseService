/**
 * Purchase Order Module
 *
 * Barrel file for purchase order services and utilities.
 * This file provides a single entry point for all purchase order functionality.
 */

// Core service
export { purchaseOrderService } from "./purchase-order.service";

// Workflow service
export { purchaseOrderWorkflowService } from "./purchase-order-workflow.service";

// Receiving services
export { purchaseOrderReceivingService } from "./purchase-order-receiving.service";
export { lineItemReceivingService } from "./line-item-receiving.service";

// Statistics service
export { purchaseOrderStatisticsService } from "./purchase-order-statistics.service";

// Requisition service
export { purchaseOrderRequisitionService } from "./purchase-order-requisition.service";

// Add Lines service
export { purchaseOrderAddLinesService } from "./purchase-order-add-lines.service";
export type {
  AddLinesToPOInput,
  AddLinesToPOResult,
} from "./purchase-order-add-lines.service";

// Line scrap service (scrap a repairable from the PO when the vendor can't fix it)
export { purchaseOrderLineScrapService } from "./purchase-order-line-scrap.service";
export type {
  ScrapRepairableLineInput,
  ScrapRepairableLineResult,
} from "./purchase-order-line-scrap.service";

// Utilities
export * from "./purchase-order-utils";
export * from "./purchase-order-validation";

// Types (re-export from types files)
export * from "./purchase-order.types";
export * from "./line-item.types";
