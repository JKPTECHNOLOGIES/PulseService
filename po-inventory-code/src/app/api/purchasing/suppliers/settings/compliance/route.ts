/**
 * Supplier Compliance Settings API
 *
 * GET /api/purchasing/suppliers/settings/compliance
 *   Returns the current compliance settings, with code-level defaults filled
 *   in for any field that is absent or empty in the database.
 *
 * PUT /api/purchasing/suppliers/settings/compliance
 *   Upserts the single compliance settings row.
 *   Requires purchasing:update permission.
 *
 * SINGLETON PATTERN:
 *   There is exactly one SupplierComplianceSettings row, identified by the
 *   stable id "global". Using `upsert({ where: { id: "global" }, ... })`
 *   is race-safe (atomic) and does not require a separate unique constraint.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { success } from "@/lib/api-response";
import {
  createGetHandler,
  createApiHandler,
  BaseApiContext,
} from "@/lib/api-middleware-v2";
import {
  getComplianceConfig,
  DEFAULT_REQUIRED_DOC_TYPES,
  DEFAULT_REMINDER_THRESHOLDS,
  DEFAULT_RECIPIENT_PERMISSION,
} from "@/services/compliance/supplier-compliance.service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Stable singleton row ID — never changes
// ---------------------------------------------------------------------------

const SINGLETON_ID = "global";

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const updateComplianceSettingsSchema = z.object({
  requiredDocumentTypes: z.array(z.string()).optional(),
  reminderThresholds: z
    .array(z.number().int().positive())
    .max(5)
    .optional(),
  recipientPermission: z.string().optional(),
});

type UpdateComplianceSettingsInput = z.infer<
  typeof updateComplianceSettingsSchema
>;

// ---------------------------------------------------------------------------
// GET — return current compliance settings (with defaults filled in)
// ---------------------------------------------------------------------------

export const GET = createGetHandler(
  async (_req: NextRequest, _context: BaseApiContext) => {
    const config = await getComplianceConfig(prisma);

    return success(
      {
        ...config,
        defaults: {
          requiredDocumentTypes: DEFAULT_REQUIRED_DOC_TYPES,
          reminderThresholds: DEFAULT_REMINDER_THRESHOLDS,
          recipientPermission: DEFAULT_RECIPIENT_PERMISSION,
        },
      },
      "Compliance settings retrieved successfully",
    );
  },
);

// ---------------------------------------------------------------------------
// PUT — upsert compliance settings (requires purchasing:update)
// ---------------------------------------------------------------------------

export const PUT = createApiHandler(
  {
    bodySchema: updateComplianceSettingsSchema,
    permission: "purchasing:update" as const,
  },
  async (
    _req: NextRequest,
    context: { serviceContext: BaseApiContext["serviceContext"]; data: UpdateComplianceSettingsInput },
  ) => {
    void context.serviceContext; // auth verified by middleware

    const { requiredDocumentTypes, reminderThresholds, recipientPermission } =
      context.data;

    // Build the update payload — only include provided fields
    const updateData: {
      requiredDocumentTypes?: string[];
      reminderThresholds?: number[];
      recipientPermission?: string;
    } = {};

    if (requiredDocumentTypes !== undefined) {
      updateData.requiredDocumentTypes = requiredDocumentTypes;
    }
    if (reminderThresholds !== undefined) {
      updateData.reminderThresholds = reminderThresholds;
    }
    if (recipientPermission !== undefined) {
      updateData.recipientPermission = recipientPermission;
    }

    // Atomic upsert using a stable singleton ID.
    // This is race-safe: if two concurrent PUT requests arrive simultaneously,
    // both will upsert on the same id="global" key — one will create and the
    // other will update, with no duplicate-row risk.
    await prisma.supplierComplianceSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...updateData },
      update: updateData,
    });

    // Return merged config (with defaults for any field still absent)
    const config = await getComplianceConfig(prisma);

    return success(
      {
        ...config,
        defaults: {
          requiredDocumentTypes: DEFAULT_REQUIRED_DOC_TYPES,
          reminderThresholds: DEFAULT_REMINDER_THRESHOLDS,
          recipientPermission: DEFAULT_RECIPIENT_PERMISSION,
        },
      },
      "Compliance settings updated successfully",
    );
  },
);
