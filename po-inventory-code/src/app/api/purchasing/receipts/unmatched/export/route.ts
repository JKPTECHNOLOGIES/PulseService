import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { financeSettingsService } from "@/services/finance/finance-settings.service";

interface ReceiptRow {
  receiptNumber: string;
  poNumber: string;
  supplier: string;
  supplierCode: string;
  description: string;
  sku: string;
  quantityReceived: number;
  unitCost: number;
  totalCost: number;
  receivedAt: string;
  receivedBy: string;
  daysOld: number;
  glAccount: string;
  glAccountName: string;
  department: string;
  area: string;
  project: string;
  allocationPercentage: number;
  allocationAmount: number;
}

/**
 * GET /api/purchasing/receipts/unmatched/export
 * 
 * Export unmatched receipts to XLSX grouped by GL account
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Apply the same go-live floor as the main unmatched endpoint so the
    // export never includes pre-cutover Tabware receipts.
    const { goLiveDate } = await financeSettingsService.getGoLiveConfig();

    // Fetch all unmatched receipts with GL account allocations
    const receipts = await prisma.pOLineReceipt.findMany({
      where: {
        invoiceId: null,
        isReturn: false,
        ...(goLiveDate ? { receivedAt: { gte: goLiveDate } } : {}),
      },
      orderBy: { receivedAt: "desc" },
      include: {
        poLine: {
          include: {
            purchaseOrder: {
              include: {
                supplier: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
              },
            },
            inventoryItem: {
              select: {
                id: true,
                sku: true,
                description: true,
              },
            },
            chargeAllocations: {
              include: {
                accountCode: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    category: true,
                  },
                },
                department: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
                area: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
                project: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Group receipts by GL account
    const groupedByGL = new Map<string, ReceiptRow[]>();
    const noGLAccount: ReceiptRow[] = [];

    interface AllocationWithRelations {
      accountCode: { code: string; name: string } | null;
      department: { name: string } | null;
      area: { name: string } | null;
      project: { name: string } | null;
      percentage: { toNumber(): number };
      amount: { toNumber(): number };
    }

    receipts.forEach((receipt) => {
      const allocations = receipt.poLine.chargeAllocations as unknown as AllocationWithRelations[];
      
      if (allocations.length === 0) {
        // No GL account allocation
        noGLAccount.push({
          receiptNumber: receipt.receiptNumber,
          poNumber: receipt.poLine.purchaseOrder.poNumber,
          supplier: receipt.poLine.purchaseOrder.supplier.name,
          supplierCode: receipt.poLine.purchaseOrder.supplier.code ?? "",
          description: receipt.poLine.description,
          sku: receipt.poLine.inventoryItem?.sku ?? "",
          quantityReceived: Number(receipt.quantityReceived),
          unitCost: Number(receipt.unitCost),
          totalCost: Number(receipt.totalCost),
          receivedAt: receipt.receivedAt.toISOString().split("T")[0] ?? "",
          receivedBy: `${receipt.receiver.firstName} ${receipt.receiver.lastName}`,
          daysOld: Math.floor((Date.now() - receipt.receivedAt.getTime()) / (1000 * 60 * 60 * 24)),
          glAccount: "NO GL ACCOUNT",
          glAccountName: "NO GL ACCOUNT",
          department: "",
          area: "",
          project: "",
          allocationPercentage: 100,
          allocationAmount: Number(receipt.totalCost),
        });
      } else {
        // Has GL account allocations
        allocations.forEach((allocation) => {
          // If allocation exists but accountCode is null, add to noGLAccount array
          if (!allocation.accountCode) {
            noGLAccount.push({
              receiptNumber: receipt.receiptNumber,
              poNumber: receipt.poLine.purchaseOrder.poNumber,
              supplier: receipt.poLine.purchaseOrder.supplier.name,
              supplierCode: receipt.poLine.purchaseOrder.supplier.code ?? "",
              description: receipt.poLine.description,
              sku: receipt.poLine.inventoryItem?.sku ?? "",
              quantityReceived: Number(receipt.quantityReceived),
              unitCost: Number(receipt.unitCost),
              totalCost: Number(receipt.totalCost),
              receivedAt: receipt.receivedAt.toISOString().split("T")[0] ?? "",
              receivedBy: `${receipt.receiver.firstName} ${receipt.receiver.lastName}`,
              daysOld: Math.floor((Date.now() - receipt.receivedAt.getTime()) / (1000 * 60 * 60 * 24)),
              glAccount: "NO GL ACCOUNT",
              glAccountName: "NO GL ACCOUNT",
              department: allocation.department?.name ?? "",
              area: allocation.area?.name ?? "",
              project: allocation.project?.name ?? "",
              allocationPercentage: allocation.percentage.toNumber(),
              allocationAmount: allocation.amount.toNumber(),
            });
          } else {
            // Has valid GL account
            const glKey = `${allocation.accountCode.code} - ${allocation.accountCode.name}`;
            
            if (!groupedByGL.has(glKey)) {
              groupedByGL.set(glKey, []);
            }

            const glGroup = groupedByGL.get(glKey);
            if (glGroup) {
              glGroup.push({
                receiptNumber: receipt.receiptNumber,
                poNumber: receipt.poLine.purchaseOrder.poNumber,
                supplier: receipt.poLine.purchaseOrder.supplier.name,
                supplierCode: receipt.poLine.purchaseOrder.supplier.code ?? "",
                description: receipt.poLine.description,
                sku: receipt.poLine.inventoryItem?.sku ?? "",
                quantityReceived: Number(receipt.quantityReceived),
                unitCost: Number(receipt.unitCost),
                totalCost: Number(receipt.totalCost),
                receivedAt: receipt.receivedAt.toISOString().split("T")[0] ?? "",
                receivedBy: `${receipt.receiver.firstName} ${receipt.receiver.lastName}`,
                daysOld: Math.floor((Date.now() - receipt.receivedAt.getTime()) / (1000 * 60 * 60 * 24)),
                glAccount: allocation.accountCode.code,
                glAccountName: allocation.accountCode.name,
                department: allocation.department?.name ?? "",
                area: allocation.area?.name ?? "",
                project: allocation.project?.name ?? "",
                allocationPercentage: allocation.percentage.toNumber(),
                allocationAmount: allocation.amount.toNumber(),
              });
            }
          }
        });
      }
    });

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Add summary sheet
    const summaryData: (string | number)[][] = [
      ["Unmatched Receipts Export"],
      ["Generated:", new Date().toISOString()],
      ["Total Receipts:", receipts.length],
      ["Total Value:", receipts.reduce((sum, r) => sum + Number(r.totalCost), 0).toFixed(2)],
      [],
      ["GL Account", "Receipt Count", "Total Amount"],
    ];

    // Add GL account summaries
    const sortedGLAccounts = Array.from(groupedByGL.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedGLAccounts.forEach(([glAccount, items]) => {
      const totalAmount = items.reduce((sum, item) => sum + item.allocationAmount, 0);
      summaryData.push([glAccount, items.length, totalAmount.toFixed(2)]);
    });

    if (noGLAccount.length > 0) {
      const totalAmount = noGLAccount.reduce((sum, item) => sum + item.allocationAmount, 0);
      summaryData.push(["NO GL ACCOUNT", noGLAccount.length, totalAmount.toFixed(2)]);
    }

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    // Add sheet for each GL account
    sortedGLAccounts.forEach(([glAccount, items]) => {
      const sheetData: (string | number)[][] = [
        ["GL Account:", glAccount],
        ["Receipt Count:", items.length],
        ["Total Amount:", items.reduce((sum, item) => sum + item.allocationAmount, 0).toFixed(2)],
        [],
        [
          "Receipt #",
          "PO #",
          "Supplier",
          "Supplier Code",
          "Description",
          "SKU",
          "Qty Received",
          "Unit Cost",
          "Total Cost",
          "Received Date",
          "Received By",
          "Days Old",
          "GL Account",
          "GL Account Name",
          "Department",
          "Area",
          "Project",
          "Allocation %",
          "Allocation Amount",
        ],
      ];

      items.forEach((item) => {
        sheetData.push([
          item.receiptNumber,
          item.poNumber,
          item.supplier,
          item.supplierCode,
          item.description,
          item.sku,
          item.quantityReceived,
          item.unitCost,
          item.totalCost,
          item.receivedAt,
          item.receivedBy,
          item.daysOld,
          item.glAccount,
          item.glAccountName,
          item.department,
          item.area,
          item.project,
          item.allocationPercentage,
          item.allocationAmount,
        ]);
      });

      // Sanitize sheet name (max 31 chars, no special chars)
      const sheetName = glAccount.substring(0, 31).replace(/[:\\/?*\[\]]/g, "_");
      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    });

    // Add sheet for receipts without GL account
    if (noGLAccount.length > 0) {
      const sheetData: (string | number)[][] = [
        ["GL Account:", "NO GL ACCOUNT"],
        ["Receipt Count:", noGLAccount.length],
        ["Total Amount:", noGLAccount.reduce((sum, item) => sum + item.allocationAmount, 0).toFixed(2)],
        [],
        [
          "Receipt #",
          "PO #",
          "Supplier",
          "Supplier Code",
          "Description",
          "SKU",
          "Qty Received",
          "Unit Cost",
          "Total Cost",
          "Received Date",
          "Received By",
          "Days Old",
        ],
      ];

      noGLAccount.forEach((item) => {
        sheetData.push([
          item.receiptNumber,
          item.poNumber,
          item.supplier,
          item.supplierCode,
          item.description,
          item.sku,
          item.quantityReceived,
          item.unitCost,
          item.totalCost,
          item.receivedAt,
          item.receivedBy,
          item.daysOld,
        ]);
      });

      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, sheet, "NO GL ACCOUNT");
    }

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    // Return file
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="unmatched-receipts-${new Date().toISOString().split("T")[0]}.xlsx"`,
      },
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to export unmatched receipts" },
      { status: 500 }
    );
  }
}
