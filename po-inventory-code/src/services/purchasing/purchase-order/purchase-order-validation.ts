/**
 * Purchase Order Validation
 *
 * Validation helpers and business rules for purchase order operations.
 * These functions validate data integrity and enforce business constraints.
 */

import { PrismaClient } from "@prisma/client";
import {
  ValidationError,
  NotFoundError,
  BadRequestError,
} from "@/lib/api-errors";
import {
  PurchaseOrderCreateDTO,
  PurchaseOrderUpdateDTO,
  PurchaseOrderStatus,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
} from "./purchase-order.types";

/**
 * Validate purchase order creation data
 * Checks schema validity, supplier existence, and inventory items
 * @param data - Purchase order creation DTO
 * @param prisma - Prisma client instance
 * @throws ValidationError if validation fails
 */
export async function validatePOCreate(
  data: PurchaseOrderCreateDTO,
  prisma: PrismaClient,
): Promise<void> {
  // Validate with Zod schema
  const validation = purchaseOrderCreateSchema.safeParse(data);
  if (!validation.success) {
    const errors = validation.error.issues.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    throw new ValidationError("Validation failed", errors);
  }

  // Validate supplier exists and is active
  const supplier = await prisma.supplier.findUnique({
    where: { id: data.supplierId },
  });

  if (!supplier) {
    throw new ValidationError("Supplier not found", [
      {
        field: "supplierId",
        message: "Supplier not found",
      },
    ]);
  }

  // Validate inventory items exist
  await validateInventoryItems(data.items, prisma);
}

/**
 * Validate purchase order update data
 * Checks schema validity, edit permissions, and data integrity
 * @param id - Purchase order ID
 * @param data - Purchase order update DTO
 * @param prisma - Prisma client instance
 * @throws ValidationError if validation fails
 */
export async function validatePOUpdate(
  id: string,
  data: PurchaseOrderUpdateDTO,
  prisma: PrismaClient,
): Promise<void> {
  // Validate with Zod schema
  const validation = purchaseOrderUpdateSchema.safeParse(data);
  if (!validation.success) {
    const errors = validation.error.issues.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    throw new ValidationError("Validation failed", errors);
  }

  // Get existing PO
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
  });

  if (!po) {
    throw new NotFoundError("PurchaseOrder", id);
  }

  // POs are editable until they reach RECEIVED, CLOSED, or CANCELLED status.
  // Exception: "notes" (Special Instructions) is a non-financial annotation field
  // and may be updated on any PO regardless of status. If the payload contains
  // only "notes" (and no structural/financial fields), skip the status lock.
  const financialOrStructuralFields: Array<keyof PurchaseOrderUpdateDTO> = [
    "supplierId",
    "supplierAddressId",
    "buyerId",
    "invoiceApproverId",
    "onBehalfOfId",
    "orderDate",
    "expectedDeliveryDate",
    "items",
    "shippingCost",
    "tax",
    "deliveryTerms",
    "paymentTermsOverride",
  ];

  const hasFinancialOrStructuralChanges = financialOrStructuralFields.some(
    (field) => field in data && data[field] !== undefined,
  );

  const lockedStatuses: string[] = [
    PurchaseOrderStatus.RECEIVED,
    PurchaseOrderStatus.CLOSED,
    PurchaseOrderStatus.CANCELLED,
  ];

  if (hasFinancialOrStructuralChanges && lockedStatuses.includes(po.status)) {
    throw new ValidationError("Invalid status", [
      {
        field: "status",
        message:
          "Purchase order cannot be edited after it is received, closed, or cancelled",
      },
    ]);
  }

  // Validate supplier if changed
  if (data.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: data.supplierId },
    });

    if (!supplier) {
      throw new ValidationError("Supplier not found", [
        {
          field: "supplierId",
          message: "Supplier not found",
        },
      ]);
    }
  }

  // Validate inventory items if provided
  if (data.items) {
    await validateInventoryItems(data.items, prisma);
  }
}

/**
 * Validate inventory items exist in the database
 * @param items - Array of purchase order items
 * @param prisma - Prisma client instance
 * @throws ValidationError if any item is not found
 */
export async function validateInventoryItems(
  items: Array<{ inventoryItemId?: string | null; description: string }>,
  prisma: PrismaClient,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.inventoryItemId) {
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
  }
}

/**
 * Validate item quantities are positive and within limits
 * @param items - Array of purchase order items
 * @throws ValidationError if quantities are invalid
 */
export function validateItemQuantities(
  items: Array<{ quantity: number; unitPrice: number }>,
): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item) continue;

    if (item.quantity <= 0) {
      throw new ValidationError("Invalid quantity", [
        {
          field: `items[${i}].quantity`,
          message: "Quantity must be positive",
        },
      ]);
    }

    if (item.unitPrice < 0) {
      throw new ValidationError("Invalid unit price", [
        {
          field: `items[${i}].unitPrice`,
          message: "Unit price must be non-negative",
        },
      ]);
    }
  }
}

/**
 * Validate status transition is allowed
 * @param currentStatus - Current PO status
 * @param newStatus - Desired new status
 * @throws BadRequestError if transition is not allowed
 */
export function validateStatusTransition(
  currentStatus: PurchaseOrderStatus,
  newStatus: PurchaseOrderStatus,
): void {
  const validTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
    [PurchaseOrderStatus.DRAFT]: [
      PurchaseOrderStatus.SUBMITTED,
      PurchaseOrderStatus.CANCELLED,
    ],
    [PurchaseOrderStatus.SUBMITTED]: [
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.CANCELLED,
    ],
    [PurchaseOrderStatus.APPROVED]: [
      PurchaseOrderStatus.ORDERED,
      PurchaseOrderStatus.CANCELLED,
    ],
    [PurchaseOrderStatus.ORDERED]: [
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      PurchaseOrderStatus.RECEIVED,
      PurchaseOrderStatus.CLOSED,
      PurchaseOrderStatus.CANCELLED,
    ],
    [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [
      PurchaseOrderStatus.RECEIVED,
      PurchaseOrderStatus.CLOSED,
    ],
    [PurchaseOrderStatus.RECEIVED]: [
      PurchaseOrderStatus.INVOICED,
      PurchaseOrderStatus.CLOSED,
    ],
    [PurchaseOrderStatus.INVOICED]: [PurchaseOrderStatus.CLOSED],
    [PurchaseOrderStatus.CLOSED]: [],
    [PurchaseOrderStatus.CANCELLED]: [],
  };

  const allowedTransitions = validTransitions[currentStatus];

  if (!allowedTransitions.includes(newStatus)) {
    throw new BadRequestError(
      `Cannot transition from ${currentStatus} to ${newStatus}`,
    );
  }
}

// Status validation helpers

/**
 * Check if PO can be submitted
 */
export function canSubmit(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.DRAFT;
}

/**
 * Check if PO can be approved
 */
export function canApprove(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.SUBMITTED;
}

/**
 * Check if PO can be sent to supplier
 */
export function canSend(status: PurchaseOrderStatus): boolean {
  return status === PurchaseOrderStatus.APPROVED;
}

/**
 * Check if PO can receive items
 */
export function canReceive(status: PurchaseOrderStatus): boolean {
  return [
    PurchaseOrderStatus.ORDERED,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
  ].includes(status);
}

/**
 * Check if PO can be closed
 */
export function canClose(status: PurchaseOrderStatus): boolean {
  return [
    PurchaseOrderStatus.ORDERED,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
    PurchaseOrderStatus.RECEIVED,
  ].includes(status);
}

/**
 * Check if PO can be cancelled
 */
export function canCancel(status: PurchaseOrderStatus): boolean {
  return [
    PurchaseOrderStatus.DRAFT,
    PurchaseOrderStatus.SUBMITTED,
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.ORDERED,
  ].includes(status);
}
