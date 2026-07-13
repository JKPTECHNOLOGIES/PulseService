/**
 * API endpoint for generating inventory labels
 * POST /api/inventory/labels
 */

import { NextRequest } from 'next/server';
import { createApiHandler, BaseApiContext } from '@/lib/api-middleware-v2';
import { success } from '@/lib/api-response';
import { ValidationError, NotFoundError, AuthorizationError, InternalServerError } from "@/lib/api-errors";
import { prisma } from '@/lib/prisma';
import { generateInventoryQRData } from '@/lib/qr-code';

export const POST = createApiHandler(
  {},
  async (request: NextRequest, _context: BaseApiContext) => {
    try {
    const body = await request.json() as Record<string, unknown>;
    const itemIds = body.itemIds as string[] | undefined;
    const quantity = (body.quantity as number | undefined) ?? 1;
    const options = (body.options as Record<string, unknown> | undefined) ?? {};

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      throw new ValidationError('Item IDs are required');
    }

    // Fetch inventory items
    const items = await prisma.inventoryItem.findMany({
      where: {
        id: {
          in: itemIds,
        },
      },
      select: {
        id: true,
        sku: true,
        description: true,
        name: true,
        category: true,
      },
    });

    if (items.length === 0) {
      throw new ValidationError('No items found');
    }

    // Generate label data
    const labels = items.flatMap((item) => {
      const labelData = [];
      for (let i = 0; i < quantity; i++) {
        labelData.push({
          sku: item.sku,
          description: item.description,
          category: item.category,
          qrData: generateInventoryQRData(item),
          ...options,
        });
      }
      return labelData;
    });

    return success({
      labels,
      count: labels.length,
    });
  
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthorizationError
      ) {
        throw error;
      }
      
      // Handle unexpected errors
      throw new InternalServerError('An error occurred while processing your request', {
        suggestion: 'Please try again. If the problem persists, contact support.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
