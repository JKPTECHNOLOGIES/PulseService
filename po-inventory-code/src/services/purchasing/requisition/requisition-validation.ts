/**
 * Requisition Validation
 *
 * Validation helpers and business rules for requisition operations.
 * These functions validate data integrity and enforce business constraints.
 */

import { PrismaClient } from "@prisma/client";
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";
import {
  RequisitionCreateDTO,
  RequisitionUpdateDTO,
  RequisitionStatus,
  requisitionCreateSchema,
  requisitionUpdateSchema,
  RequisitionRejectDTO,
  RequisitionCancelDTO,
  RequisitionConvertToPODTO,
  requisitionConvertToPOSchema,
} from "./requisition.types";

/**
 * Validate requisition creation data
 * Checks schema validity, user existence, and inventory items
 * @param data - Requisition creation DTO
 * @param prisma - Prisma client instance
 * @throws ValidationError if validation fails
 */
export async function validateCreate(
  data: RequisitionCreateDTO,
  prisma: PrismaClient,
): Promise<void> {
  // Validate with Zod schema
  const validation = requisitionCreateSchema.safeParse(data);
  if (!validation.success) {
    const errors = validation.error.issues.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    throw new ValidationError("Validation failed", errors);
  }

  // Validate user exists
  const user = await prisma.user.findUnique({
    where: { id: data.requestedById },
  });

  if (!user) {
    throw new ValidationError("User not found", [
      {
        field: "requestedById",
        message: "User not found",
      },
    ]);
  }

  // Validate inventory items exist and quantities
  await validateLineItems(data.items, prisma);
}

/**
 * Validate requisition update data
 * Checks schema validity, edit permissions, and data integrity
 * @param id - Requisition ID
 * @param data - Requisition update DTO
 * @param prisma - Prisma client instance
 * @throws ValidationError if validation fails
 */
export async function validateUpdate(
  id: string,
  data: RequisitionUpdateDTO,
  prisma: PrismaClient,
): Promise<void> {
  // Validate with Zod schema
  const validation = requisitionUpdateSchema.safeParse(data);
  if (!validation.success) {
    const errors = validation.error.issues.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    throw new ValidationError("Validation failed", errors);
  }

  // Get existing requisition
  const requisition = await prisma.requisition.findUnique({
    where: { id },
  });

  if (!requisition) {
    throw new NotFoundError("Requisition", id);
  }

  // Check if requisition can be edited
  // Allow editing if DRAFT or APPROVED (APPROVED will be reset to DRAFT)
  // Prevent editing if already converted to PO (ORDERED status)
  const approvalStatus = (requisition as unknown as Record<string, string>).approvalStatus ?? "DRAFT";
  const status = requisition.status;
  
  // Cannot edit if already converted to PO or in final states
  if (status === "ORDERED" || status === "PARTIALLY_FULFILLED" || status === "FULFILLED") {
    throw new ValidationError("Invalid status", [
      {
        field: "status",
        message: "Cannot edit requisitions that have been converted to purchase orders or fulfilled",
      },
    ]);
  }
  
  // Cannot edit if rejected or cancelled
  if (approvalStatus === "REJECTED" || status === "CANCELLED") {
    throw new ValidationError("Invalid status", [
      {
        field: "approvalStatus",
        message: "Cannot edit rejected or cancelled requisitions",
      },
    ]);
  }
  
  // APPROVED requisitions can be edited but will be reset to DRAFT
  // This is handled in the service layer

  // Validate inventory items if provided
  if (data.items) {
    await validateLineItems(data.items, prisma);
  }
}

/**
 * @deprecated - Use new approval system instead
 * This function is obsolete and should not be used
 */
export function validateSubmit(
  _id: string,
  _prisma: PrismaClient,
): never {
  throw new Error("validateSubmit is deprecated - use new approval system");
}

/**
 * @deprecated - Use new approval system instead
 * This function is obsolete and should not be used
 */
export function validateApprove(
  _id: string,
  _prisma: PrismaClient,
): never {
  throw new Error("validateApprove is deprecated - use new approval system");
}

/**
 * @deprecated - Use new approval system instead
 * This function is obsolete and should not be used
 */
export function validateReject(
  _id: string,
  _data: RequisitionRejectDTO,
  _prisma: PrismaClient,
): never {
  throw new Error("validateReject is deprecated - use new approval system");
}

/**
 * @deprecated - Use new approval system instead
 * This function is obsolete and should not be used
 */
export function validateCancel(
  _id: string,
  _data: RequisitionCancelDTO,
  _prisma: PrismaClient,
): never {
  throw new Error("validateCancel is deprecated - use new approval system");
}

/**
 * Validate requisition can be converted to PO
 * Checks status is APPROVED and supplier exists
 * @param id - Requisition ID
 * @param data - Conversion data with supplier ID
 * @param prisma - Prisma client instance
 * @throws BadRequestError if validation fails
 */
export async function validateConvertToPO(
  id: string,
  data: RequisitionConvertToPODTO,
  prisma: PrismaClient,
): Promise<void> {

  // Validate with Zod schema
  const validation = requisitionConvertToPOSchema.safeParse(data);
  if (!validation.success) {
    const errors = validation.error.issues.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    throw new ValidationError("Validation failed", errors);
  }

  // Get requisition
  const requisition = await prisma.requisition.findUnique({
    where: { id },
  });

  if (!requisition) {
    throw new NotFoundError("Requisition", id);
  }


  // CRITICAL: Prevent duplicate PO creation if requisition is already linked to a PO
  // This guards against the cancel-for-edit scenario where PO is reset to Draft but linkage preserved
  if (requisition.purchaseOrderId) {
    throw new BadRequestError(
      `Requisition ${requisition.reqNumber} is already linked to a Purchase Order. ` +
      `Navigate to the existing PO to advance it through the workflow.`
    );
  }

  // Validate can convert (must be APPROVED in approvalStatus field)
  // Check the new approvalStatus field instead of the old status field
  if (requisition.approvalStatus !== "APPROVED") {
    throw new BadRequestError(
      `Requisition cannot be converted to PO - approval status is ${requisition.approvalStatus}`,
    );
  }

  // Validate supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: data.supplierId },
  });

  if (!supplier) {
    throw new NotFoundError("Supplier", data.supplierId);
  }


}

/**
 * Validate line items exist in the database and have valid quantities
 * @param items - Array of requisition items
 * @param prisma - Prisma client instance
 * @throws ValidationError if any item is invalid
 */
export async function validateLineItems(
  items: Array<{
    inventoryItemId?: string | null;
    description: string;
    quantity: number;
    estimatedPrice: number;
  }>,
  prisma: PrismaClient,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item) continue;

    // Validate inventory item exists if provided
    if (item.inventoryItemId) {
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { id: item.inventoryItemId },
      });

      if (!inventoryItem) {
        throw new ValidationError("Inventory item not found", [
          {
            field: `items[${i}].inventoryItemId`,
            message: "Inventory item not found",
          },
        ]);
      }
    }

    // Validate quantity is positive
    if (item.quantity <= 0) {
      throw new ValidationError("Invalid quantity", [
        {
          field: `items[${i}].quantity`,
          message: "Quantity must be positive",
        },
      ]);
    }

    // Validate estimated price is non-negative
    if (item.estimatedPrice < 0) {
      throw new ValidationError("Invalid estimated price", [
        {
          field: `items[${i}].estimatedPrice`,
          message: "Estimated price must be non-negative",
        },
      ]);
    }
  }
}

/**
 * Validate status transition is allowed
 * @param currentStatus - Current requisition status
 * @param newStatus - Desired new status
 * @throws BadRequestError if transition is not allowed
 */
export function validateStatusTransition(
  currentStatus: RequisitionStatus,
  newStatus: RequisitionStatus,
): void {
  const validTransitions: Record<RequisitionStatus, RequisitionStatus[]> = {
    [RequisitionStatus.DRAFT]: [
      RequisitionStatus.SUBMITTED,
      RequisitionStatus.CANCELLED,
    ],
    [RequisitionStatus.SUBMITTED]: [
      RequisitionStatus.APPROVED,
      RequisitionStatus.REJECTED,
      RequisitionStatus.CANCELLED,
    ],
    [RequisitionStatus.APPROVED]: [
      RequisitionStatus.ORDERED,
      RequisitionStatus.CANCELLED,
    ],
    [RequisitionStatus.ORDERED]: [
      RequisitionStatus.PARTIALLY_FULFILLED,
      RequisitionStatus.FULFILLED,
    ],
    [RequisitionStatus.PARTIALLY_FULFILLED]: [RequisitionStatus.FULFILLED],
    [RequisitionStatus.FULFILLED]: [],
    [RequisitionStatus.REJECTED]: [],
    [RequisitionStatus.CANCELLED]: [],
  };

  const allowedTransitions = validTransitions[currentStatus];

  if (!allowedTransitions.includes(newStatus)) {
    throw new BadRequestError(
      `Cannot transition from ${currentStatus} to ${newStatus}`,
    );
  }
}

// Status validation helpers
// @deprecated - These check the old status field and should not be used
// Use approvalStatus field instead

/**
 * @deprecated - Use approvalStatus field instead
 */
export function canSubmit(status: RequisitionStatus): boolean {
  // Deprecated - use approvalStatus field
  return status === RequisitionStatus.DRAFT;
}

/**
 * @deprecated - Use approvalStatus field instead
 */
export function canApprove(status: RequisitionStatus): boolean {
  // Deprecated - use approvalStatus field
  return status === RequisitionStatus.SUBMITTED;
}

/**
 * @deprecated - Use approvalStatus field instead
 */
export function canReject(status: RequisitionStatus): boolean {
  // Deprecated - use approvalStatus field
  return status === RequisitionStatus.SUBMITTED;
}

/**
 * @deprecated - Use approvalStatus field instead
 */
export function canCancel(status: RequisitionStatus): boolean {
  // Deprecated - use approvalStatus field
  return [
    RequisitionStatus.DRAFT,
    RequisitionStatus.SUBMITTED,
    RequisitionStatus.APPROVED,
  ].includes(status);
}

/**
 * Check if requisition can be converted to PO
 * Uses approvalStatus field (correct)
 */
export function canConvertToPO(approvalStatus: string): boolean {
  return approvalStatus === "APPROVED";
}

/**
 * @deprecated - Use approvalStatus field instead
 */
export function canEdit(status: RequisitionStatus): boolean {
  // Deprecated - use approvalStatus field
  return status === RequisitionStatus.DRAFT;
}
