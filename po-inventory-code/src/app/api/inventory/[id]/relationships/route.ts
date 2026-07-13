// Enable caching for GET requests
export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds

import { NextRequest } from "next/server";
import { createGetHandlerWithParams, ApiContextWithParams } from "@/lib/api-middleware-v2";
import { success } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
/**
 * GET /api/inventory/[id]/relationships
 * 
 * Fetches all relationships for an inventory item:
 * - BOMs that include this item
 * - Equipment linked via hierarchy
 */
export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    const itemId = context.params.id;

    // Fetch BOM relationships
    const bomLines = await prisma.equipmentBOMLine.findMany({
      where: {
        inventoryItemId: itemId,
      },
      include: {
        bom: {
          include: {
            equipmentLinks: {
              include: {
                equipment: {
                  include: {
                    location: true,
                  },
                },
              },
            },
            // Include parent BOMs that use this BOM as a child
            parentLines: {
              include: {
                bom: {
                  include: {
                    equipmentLinks: {
                      include: {
                        equipment: {
                          include: {
                            location: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        bom: {
          bomNumber: 'asc',
        },
      },
    });

    // Fetch BOM alternates where this item is an alternate
    const bomAlternates = await prisma.equipmentBOMAlternate.findMany({
      where: {
        inventoryItemId: itemId,
      },
      include: {
        bomLine: {
          include: {
            bom: {
              include: {
                equipmentLinks: {
                  include: {
                    equipment: {
                      include: {
                        location: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        preferenceOrder: 'asc',
      },
    });

    // Fetch direct equipment linkage (Equipment that has this inventory item as its default linked item)
    // Note: InventoryItem has an optional equipmentId field, and Equipment has inventoryItems[] relation
    const directEquipmentResult = await prisma.inventoryItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        equipment: {
          include: {
            location: true,
          },
        },
      },
    });

    // Process BOM data to get unique BOMs and their equipment
    const bomRelationships = bomLines.map((line) => {
      // Collect equipment from this BOM's direct links
      const directEquipment = line.bom.equipmentLinks.map((link) => ({
        id: link.equipment.id,
        tag: link.equipment.tag,
        description: link.equipment.description,
        status: link.equipment.status,
        criticality: link.equipment.criticality,
        isPrimary: link.isPrimary,
        location: {
          id: link.equipment.location.id,
          name: link.equipment.location.name,
          code: link.equipment.location.code,
        },
      }));

      // If this BOM is used as a child BOM in parent BOMs, collect equipment from parent BOMs
      const parentEquipment = line.bom.parentLines.flatMap((parentLine) =>
        parentLine.bom.equipmentLinks.map((link) => ({
          id: link.equipment.id,
          tag: link.equipment.tag,
          description: link.equipment.description,
          status: link.equipment.status,
          criticality: link.equipment.criticality,
          isPrimary: link.isPrimary,
          location: {
            id: link.equipment.location.id,
            name: link.equipment.location.name,
            code: link.equipment.location.code,
          },
        }))
      );

      // Combine and deduplicate equipment by ID
      const allEquipment = [...directEquipment, ...parentEquipment];
      const uniqueEquipment = Array.from(
        new Map(allEquipment.map((eq) => [eq.id, eq])).values()
      );

      return {
        bomId: line.bom.id,
        bomNumber: line.bom.bomNumber,
        bomName: line.bom.name,
        bomType: line.bom.bomType,
        bomDescription: line.bom.description,
        isActive: line.bom.isActive,
        lineNumber: line.lineNumber,
        quantity: line.quantity,
        unit: line.unit,
        isCritical: line.isCritical,
        isOptional: line.isOptional,
        equipment: uniqueEquipment,
      };
    });

    // Process alternate BOM data
    const alternateRelationships = bomAlternates.map((alt) => ({
      bomId: alt.bomLine.bom.id,
      bomNumber: alt.bomLine.bom.bomNumber,
      bomName: alt.bomLine.bom.name,
      bomType: alt.bomLine.bom.bomType,
      bomDescription: alt.bomLine.bom.description,
      isActive: alt.bomLine.bom.isActive,
      lineNumber: alt.bomLine.lineNumber,
      isAlternate: true,
      preferenceOrder: alt.preferenceOrder,
      quantity: alt.bomLine.quantity,
      unit: alt.bomLine.unit,
      equipment: alt.bomLine.bom.equipmentLinks.map((link) => ({
        id: link.equipment.id,
        tag: link.equipment.tag,
        description: link.equipment.description,
        status: link.equipment.status,
        criticality: link.equipment.criticality,
        isPrimary: link.isPrimary,
        location: {
          id: link.equipment.location.id,
          name: link.equipment.location.name,
          code: link.equipment.location.code,
        },
      })),
    }));

    // Process equipment hierarchy - single equipment if linked
    const equipmentHierarchy = directEquipmentResult?.equipment ? [{
      id: directEquipmentResult.equipment.id,
      tag: directEquipmentResult.equipment.tag,
      description: directEquipmentResult.equipment.description,
      status: directEquipmentResult.equipment.status,
      criticality: directEquipmentResult.equipment.criticality,
      location: {
        id: directEquipmentResult.equipment.location.id,
        name: directEquipmentResult.equipment.location.name,
        code: directEquipmentResult.equipment.location.code,
      },
    }] : [];

    // Calculate statistics
    const stats = {
      totalBOMs: new Set([
        ...bomRelationships.map((b) => b.bomId),
        ...alternateRelationships.map((b) => b.bomId),
      ]).size,
      totalEquipmentFromBOMs: new Set([
        ...bomRelationships.flatMap((b) => b.equipment.map((e) => e.id)),
        ...alternateRelationships.flatMap((b) => b.equipment.map((e) => e.id)),
      ]).size,
      directEquipmentLinks: equipmentHierarchy.length,
      totalAlternatePositions: alternateRelationships.length,
    };

    return success({
      bomRelationships,
      alternateRelationships,
      equipmentHierarchy,
      stats,
    });
  }
);
