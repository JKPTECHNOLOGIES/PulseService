/**
 * POST  /api/purchasing/suppliers/[id]/assign-vendor-code
 *   Assigns the next available sequential vendor code to a supplier
 *   that does not yet have one. Codes start at 12000 and increment.
 *
 * PATCH /api/purchasing/suppliers/[id]/assign-vendor-code
 *   ADMIN-ONLY override. Changes an already-assigned vendor code to a
 *   specific value (used to correct Finance/ERP mistakes). Validates the
 *   new code's format and uniqueness, and writes an audit trail to the log.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateNextVendorCode } from "@/lib/vendor-code-generator";
import { logger } from "@/lib/logger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Load supplier
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true, name: true, internalVendorCode: true },
    });

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 },
      );
    }

    // Already has a code — do not overwrite
    if (supplier.internalVendorCode) {
      return NextResponse.json(
        {
          error: `Supplier already has vendor code ${supplier.internalVendorCode}`,
        },
        { status: 409 },
      );
    }

    // Generate and assign next code atomically
    const nextCode = await generateNextVendorCode();

    const updated = await prisma.supplier.update({
      where: { id },
      data: { internalVendorCode: nextCode },
      select: { id: true, name: true, internalVendorCode: true },
    });

    logger.info(
      `[VendorCode] Assigned code ${nextCode} to supplier "${supplier.name}" (${id}) by ${session.user.email}`,
    );

    return NextResponse.json({
      success: true,
      vendorCode: updated.internalVendorCode,
      message: `Vendor code ${nextCode} assigned to ${supplier.name}`,
    });
  } catch (error) {
    logger.error("[VendorCode] Failed to assign vendor code:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to assign vendor code",
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/purchasing/suppliers/[id]/assign-vendor-code
 *
 * ADMIN-ONLY. Overrides an already-assigned vendor code with a specific
 * value. Intended for correcting mistakes (e.g. Finance assigned the wrong
 * code). The normal supplier PUT path keeps the code immutable; this is the
 * only sanctioned way to change it.
 *
 * Body: { vendorCode: string }  // numeric string, no leading zeros
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the authenticated user has the Admin role (server-side check)
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { role: true },
    });
    if (dbUser?.role.name !== "Admin") {
      return NextResponse.json(
        { error: "Only administrators can change an assigned vendor code" },
        { status: 403 },
      );
    }

    const { id } = await params;

    const body = (await request.json()) as { vendorCode?: unknown };
    const rawCode =
      typeof body.vendorCode === "string" ? body.vendorCode.trim() : "";

    // Validate format: digits only, no leading zeros, positive integer
    if (!/^[1-9][0-9]*$/.test(rawCode)) {
      return NextResponse.json(
        {
          error:
            "Vendor code must be a positive whole number with no leading zeros",
        },
        { status: 400 },
      );
    }

    // Load supplier
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true, name: true, internalVendorCode: true },
    });

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 },
      );
    }

    // No-op if unchanged
    if (supplier.internalVendorCode === rawCode) {
      return NextResponse.json({
        success: true,
        vendorCode: rawCode,
        message: "Vendor code unchanged",
      });
    }

    // Ensure the code is not already used by a different supplier
    const existing = await prisma.supplier.findUnique({
      where: { internalVendorCode: rawCode },
      select: { id: true, name: true },
    });
    if (existing && existing.id !== id) {
      return NextResponse.json(
        {
          error: `Vendor code ${rawCode} is already used by "${existing.name}"`,
        },
        { status: 409 },
      );
    }

    const previousCode = supplier.internalVendorCode;

    const updated = await prisma.supplier.update({
      where: { id },
      data: { internalVendorCode: rawCode },
      select: { id: true, name: true, internalVendorCode: true },
    });

    logger.warn(
      `[VendorCode] ADMIN OVERRIDE — changed vendor code for supplier "${supplier.name}" (${id}) from ${previousCode ?? "(none)"} to ${rawCode} by ${session.user.email}`,
    );

    return NextResponse.json({
      success: true,
      vendorCode: updated.internalVendorCode,
      previousVendorCode: previousCode,
      message: `Vendor code changed to ${rawCode} for ${supplier.name}`,
    });
  } catch (error) {
    logger.error("[VendorCode] Failed to change vendor code:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to change vendor code",
      },
      { status: 500 },
    );
  }
}
