/**
 * GET /api/purchasing/suppliers/next-vendor-code
 *
 * Returns a preview of the next auto-generated internal vendor code.
 * Read-only — does NOT reserve or consume the code.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import { createApiHandler, BaseApiContext } from "@/lib/api-middleware-v2";
import { generateNextVendorCode } from "@/lib/vendor-code-generator";

export const GET = createApiHandler(
  {},
  async (_req: NextRequest, _context: BaseApiContext) => {
    const nextCode = await generateNextVendorCode();
    return success({ nextVendorCode: nextCode }, "Next vendor code retrieved");
  }
);
