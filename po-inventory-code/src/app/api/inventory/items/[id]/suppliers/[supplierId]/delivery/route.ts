/**
 * Supplier Delivery Performance API Route
 *
 * Endpoint for recording delivery performance metrics.
 */

import { success } from "@/lib/api-response";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { inventoryItemSupplierService } from "@/services/inventory";
import {
  deliveryPerformanceSchema,
  DeliveryPerformanceDTO,
} from "@/services/inventory/inventory-item-supplier.types";
import { NextRequest } from "next/server";
/**
 * Route params type
 */
type RouteParams = {
  id: string;
  supplierId: string;
};

/**
 * POST /api/inventory/items/[id]/suppliers/[supplierId]/delivery
 * Record delivery performance for a supplier
 */
export const POST = createApiHandler<DeliveryPerformanceDTO, RouteParams>(
  { bodySchema: deliveryPerformanceSchema, hasParams: true },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<RouteParams, DeliveryPerformanceDTO>,
  ) => {
    const supplier =
      await inventoryItemSupplierService.recordDeliveryPerformance(
        context.serviceContext,
        context.params.supplierId,
        context.data
      );
    return success(supplier, "Delivery performance recorded successfully");
  }
);
