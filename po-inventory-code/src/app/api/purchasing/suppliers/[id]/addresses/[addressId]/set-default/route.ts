/**
 * Supplier Address Set Default API Route
 *
 * POST /api/purchasing/suppliers/:id/addresses/:addressId/set-default
 *   — Set an address as the default for a given type (mailing, remittance, or shipping)
 *   Body: { type: 'mailing' | 'remittance' | 'shipping' }
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  createApiHandler,
  ApiContextWithParamsAndData,
} from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { supplierAddressService } from "@/services/purchasing/supplier-address.service";
import {
  setDefaultSchema,
  type SetDefaultInput,
} from "@/services/purchasing/supplier-address.types";

/** Route params for this nested endpoint */
type RouteParams = { id: string; addressId: string };

/**
 * POST /api/purchasing/suppliers/:id/addresses/:addressId/set-default
 * Set an address as the default for a given type
 */
export const POST = createApiHandler<SetDefaultInput, RouteParams>(
  { hasParams: true, bodySchema: setDefaultSchema },
  async (
    _req: NextRequest,
    context: ApiContextWithParamsAndData<RouteParams, SetDefaultInput>,
  ) => {
    const address = await supplierAddressService.setDefault(
      context.params.addressId,
      context.data.type,
    );

    return success(address, `Address set as default ${context.data.type} address`);
  },
);
