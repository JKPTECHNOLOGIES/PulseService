/**
 * Requisition Detail API Routes
 *
 * GET /api/purchasing/requisitions/:id - Get requisition details
 * PUT /api/purchasing/requisitions/:id - Update requisition
 * DELETE /api/purchasing/requisitions/:id - Delete requisition
 */

// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { success, noContent } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  createPutHandler,
  createDeleteHandler,
  ApiContextWithParams,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { requisitionService, requisitionUpdateSchema, RequisitionUpdateDTO } from "@/services/purchasing/requisition";

/**
 * GET /api/purchasing/requisitions/:id
 * Get a single requisition by ID
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    const requisition = await requisitionService.getById(
      context.serviceContext,
      context.params.id
    );

    return success(requisition, "Requisition retrieved successfully");
  }
);

/**
 * PUT /api/purchasing/requisitions/:id
 * Update a requisition
 */
export const PUT = createPutHandler(
  requisitionUpdateSchema,
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<{ id: string }, RequisitionUpdateDTO>,
  ) => {
    // Check if requisition was approved before update
    const existingRequisition = await requisitionService.getById(
      context.serviceContext,
      context.params.id
    );
    
    const wasApproved = existingRequisition.approvalStatus === "APPROVED";
    
    const requisition = await requisitionService.update(
      context.serviceContext,
      context.params.id,
      context.data
    );

    // Return warning if requisition was reset from APPROVED to DRAFT
    const message = wasApproved && requisition.approvalStatus === "DRAFT"
      ? "Requisition updated successfully. Note: This requisition was previously approved and has been reset to DRAFT status. It will require re-approval before conversion to a purchase order."
      : "Requisition updated successfully";

    return success(requisition, message);
  }
);

/**
 * DELETE /api/purchasing/requisitions/:id
 * Delete a requisition
 */
export const DELETE = createDeleteHandler(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    await requisitionService.delete(context.serviceContext, context.params.id);
    return noContent();
  }
);
