/**
 * Requisition Module
 *
 * Barrel file for requisition services and utilities.
 * This file provides a single entry point for all requisition functionality.
 */

// Utils
export * from "./requisition-utils";

// Validation (excluding conflicting exports that are also in types)
export {
  validateCreate,
  validateUpdate,
  validateSubmit,
  validateApprove,
  validateReject,
  validateCancel,
  validateConvertToPO,
  validateLineItems,
  validateStatusTransition,
} from "./requisition-validation";

// Types
export * from "./requisition.types";

// Services
export { RequisitionService, requisitionService } from "./requisition.service";
export { requisitionWorkflowService } from "./requisition-workflow.service";
export { requisitionStatisticsService } from "./requisition-statistics.service";
