/**
 * Purchase Order Creator Details API Route
 *
 * Fetches creator contact information from Microsoft Graph API
 */


import { createApiHandler} from '@/lib/api-middleware-v2';
import { success } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { getUserDetailsById } from '@/lib/microsoft-graph';
import { NotFoundError } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

export const GET = createApiHandler(
  {
    hasParams: true,
    anyPermissions: ["purchasing:read", "purchasing:update"],
  },
  async (_request, context) => {
    const { id } = context.params;
    
    // Fetch the purchase order with buyer and creator info
    // Prefer buyer (assigned purchasing manager) over creator
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    
    if (!purchaseOrder) {
      throw new NotFoundError('Purchase order not found');
    }

    // Use buyer if assigned, otherwise fall back to creator
    const contactUser = purchaseOrder.buyer ?? purchaseOrder.creator;

    if (!contactUser) {
      return success({
        name: null,
        email: null,
        phone: null,
      });
    }

    // Fetch user details from Microsoft Graph
    try {
      const graphUser = await getUserDetailsById(contactUser.id);
      
      return success({
        name: graphUser.displayName,
        email: graphUser.mail ?? contactUser.email,
        phone: graphUser.businessPhones?.[0] ?? graphUser.mobilePhone ?? contactUser.phone,
      });
    } catch (_error) {
      // Fallback to database values
      return success({
        name: `${contactUser.firstName} ${contactUser.lastName}`,
        email: contactUser.email,
        phone: contactUser.phone,
      });
    }
  }
);
