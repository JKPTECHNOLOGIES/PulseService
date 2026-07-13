/**
 * Purchasing Services
 *
 * Export all purchasing-related services and types
 */

// Services
export { requisitionService } from "@/services/purchasing/requisition/requisition.service";
export { purchaseOrderService } from "@/services/purchasing/purchase-order/purchase-order.service";
export { supplierService } from "@/services/purchasing/supplier.service";
export { supplierAddressService } from "@/services/purchasing/supplier-address.service";
export { invoiceService } from "@/services/purchasing/invoice.service";

// Types - export explicitly to avoid naming conflicts
export type {
  RequisitionCreateDTO,
  RequisitionUpdateDTO,
  RequisitionFilterDTO,
  RequisitionWithRelations,
  RequisitionItemDTO,
} from "@/services/purchasing/requisition/requisition.types";

export type {
  PurchaseOrderCreateDTO,
  PurchaseOrderUpdateDTO,
  PurchaseOrderFilterDTO,
  PurchaseOrderWithRelations,
  PurchaseOrderItemDTO,
  ReceiveItemsDTO,
} from "@/services/purchasing/purchase-order/purchase-order.types";

export type {
  SupplierCreateDTO,
  SupplierUpdateDTO,
  SupplierFilterDTO,
  SupplierWithRelations,
  SupplierStats,
} from "@/services/purchasing/supplier.types";

export type {
  CreateSupplierAddressInput,
  UpdateSupplierAddressInput,
  POAddressSnapshot,
} from "@/services/purchasing/supplier-address.types";

export type {
  InvoiceCreateDTO,
  InvoiceUpdateDTO,
  InvoiceFilterDTO,
  InvoiceWithRelations,
  InvoiceLineDTO,
  InvoiceApproveDTO,
  InvoicePayDTO,
  Invoice3WayMatchDTO,
  ThreeWayMatchResult,
} from "@/services/purchasing/invoice.types";

// Enums
export {
  RequisitionStatus,
  RequisitionPriority,
} from "@/services/purchasing/requisition/requisition.types";
export { PurchaseOrderStatus } from "@/services/purchasing/purchase-order/purchase-order.types";
export {
  SupplierRating,
  PaymentTerms,
} from "@/services/purchasing/supplier.types";
export { InvoiceDisplayStatus } from "@/services/purchasing/invoice-approval.types";
