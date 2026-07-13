/**
 * Shared utility for generating unique tracking IDs for repairable items.
 *
 * Format: REP-{SKU}-{N}  (N is a continuously-incrementing integer, never resets)
 *
 * This logic was originally private inside DirectIssueService. It is extracted
 * here so that InventoryStockService (and any future callers) can reuse the same
 * ID-generation algorithm without duplicating code.
 *
 * The function uses an optimistic-locking retry loop:
 *  1. Fetch all existing serial numbers that start with the prefix "REP-{SKU}-".
 *  2. Derive the next sequential integer (ignoring timestamp-based outliers > 999).
 *  3. Verify the candidate is not already taken before returning it.
 *  4. Back-off and retry up to MAX_RETRIES times on collision.
 */

import { PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/api-errors";

const MAX_RETRIES = 10;

/**
 * Minimal Prisma interface required by this generator.
 * Both PrismaClient and Prisma transaction clients (PrismaTx) satisfy this type
 * because they both expose the same model accessors — transaction clients merely
 * omit the top-level management methods ($connect, $transaction, etc.).
 *
 * Accepting this union allows callers inside a $transaction to pass the `tx`
 * client so that reads can see their own pending writes (critical when creating
 * multiple serials in a single transaction loop).
 */
type PrismaLike = Pick<PrismaClient, "inventoryItem" | "repairableItem">;

/**
 * Generate a unique repairable-item tracking ID for the given inventory item.
 *
 * Can be called with either the global PrismaClient or a Prisma interactive-
 * transaction client. When called from inside a $transaction, always pass the
 * `tx` client so that reads see pending writes from earlier in the same loop
 * (prevents duplicate-serial errors when receiving qty > 1).
 *
 * @param prismaClient - PrismaClient or transaction client
 * @param inventoryItemId - ID of the InventoryItem whose SKU forms the prefix
 * @returns A unique tracking ID string, e.g. "REP-PUMP-42"
 * @throws NotFoundError if the inventory item does not exist
 * @throws Error if a unique ID cannot be generated after MAX_RETRIES attempts
 */
export async function generateRepairableTrackingId(
  prismaClient: PrismaLike,
  inventoryItemId: string,
): Promise<string> {
  // Resolve the SKU for the prefix
  const inventoryItem = await prismaClient.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    select: { sku: true },
  });

  if (!inventoryItem) {
    throw new NotFoundError("Inventory Item", inventoryItemId);
  }

  const prefix = `REP-${inventoryItem.sku}-`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Fetch all existing tracking IDs with this prefix so we can find the max
    const allItems = await prismaClient.repairableItem.findMany({
      where: { serialNumber: { startsWith: prefix } },
      select: { serialNumber: true },
    });

    let nextNumber = 1;
    if (allItems.length > 0) {
      // Extract the numeric suffix from each serial number.
      // Numbers > 999 are assumed to be legacy timestamp-based values and are
      // ignored so we don't accidentally skip a large chunk of the sequence.
      const numbers = allItems
        .map((item) => {
          const parts = item.serialNumber.split("-");
          // The suffix is the third segment (index 2)
          const num = parts[2] ? parseInt(parts[2], 10) : 0;
          return isNaN(num) ? 0 : num;
        })
        .filter((num) => num > 0 && num < 1000);

      if (numbers.length > 0) {
        nextNumber = Math.max(...numbers) + 1;
      }
    }

    const candidate = `${prefix}${nextNumber}`;

    // Guard against a race-condition where another process just created this ID
    const existing = await prismaClient.repairableItem.findUnique({
      where: { serialNumber: candidate },
    });

    if (!existing) {
      return candidate;
    }

    // Exponential back-off before the next attempt
    const backoffMs = Math.min(1000, 50 * Math.pow(2, attempt));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, backoffMs);
    });
  }

  throw new Error(
    `Failed to generate unique repairable tracking ID after ${MAX_RETRIES} attempts for item ${inventoryItemId}. Please try again.`,
  );
}
