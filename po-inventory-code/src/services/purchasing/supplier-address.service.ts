/**
 * Supplier Address Service
 *
 * Manages supplier addresses (CRUD, default management, PO snapshots).
 * Uses direct Prisma operations following the same patterns as SupplierServiceV2.
 *
 * FLAT FIELD SYNC
 * ---------------
 * The Supplier table still carries legacy flat address columns
 * (billingAddress/City/State/Zip/Country, shippingAddress/…, remittanceAddress/…).
 * These are consumed by the PO PDF generator, the onboarding-form route, and the
 * inventory service.  After every mutating operation on SupplierAddress records
 * we call syncFlatFields() to rewrite those flat columns from the current defaults:
 *
 *   billingAddress/*  ← isDefaultMailing (or first isMailingAddress)
 *   shippingAddress/* ← isDefaultShipping (or first isShippingAddress)
 *   remittanceAddress/* ← isDefaultRemittance (or first isRemittanceAddress)
 *
 * This ensures the legacy consumers stay accurate without any code changes to them.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
} from "@/lib/api-errors";

import type {
  CreateSupplierAddressInput,
  UpdateSupplierAddressInput,
  POAddressSnapshot,
  AddressDefaultType,
} from "./supplier-address.types";

// ============================================================================
// Helpers
// ============================================================================

/** Map a default-type string to the corresponding Prisma boolean field names. */
function defaultFieldsFor(type: AddressDefaultType) {
  const map: Record<AddressDefaultType, { isDefault: string; isType: string }> = {
    mailing: { isDefault: "isDefaultMailing", isType: "isMailingAddress" },
    remittance: { isDefault: "isDefaultRemittance", isType: "isRemittanceAddress" },
    shipping: { isDefault: "isDefaultShipping", isType: "isShippingAddress" },
  };
  return map[type];
}

/** Pick address fields from a SupplierAddress record for the flat-field sync. */
function flatFieldsFromAddress(addr: {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
} | null, prefix: "billing" | "shipping" | "remittance"): Record<string, string | null> {
  if (!addr) {
    return {
      [`${prefix}Address`]: null,
      [`${prefix}Address2`]: null,
      [`${prefix}City`]: null,
      [`${prefix}State`]: null,
      [`${prefix}Zip`]: null,
      [`${prefix}Country`]: null,
    };
  }
  return {
    [`${prefix}Address`]: addr.address1 ?? null,
    [`${prefix}Address2`]: addr.address2 ?? null,
    [`${prefix}City`]: addr.city ?? null,
    [`${prefix}State`]: addr.state ?? null,
    [`${prefix}Zip`]: addr.zip ?? null,
    [`${prefix}Country`]: addr.country ?? "USA",
  };
}

// ============================================================================
// Service Class
// ============================================================================

class SupplierAddressService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  // --------------------------------------------------------------------------
  // CORE CRUD
  // --------------------------------------------------------------------------

  /**
   * Get all addresses for a supplier
   */
  async getBySupplier(supplierId: string) {
    // Verify supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new NotFoundError("Supplier", supplierId);
    }

    return this.prisma.supplierAddress.findMany({
      where: { supplierId },
      orderBy: { addressCode: "asc" },
    });
  }

  /**
   * Get a single address by ID
   */
  async getById(id: string) {
    const address = await this.prisma.supplierAddress.findUnique({
      where: { id },
    });
    if (!address) {
      throw new NotFoundError("SupplierAddress", id);
    }
    return address;
  }

  /**
   * Create a new address for a supplier
   */
  async create(supplierId: string, data: CreateSupplierAddressInput) {
    // Verify supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new NotFoundError("Supplier", supplierId);
    }

    // Build create payload
    const createData: Prisma.SupplierAddressCreateInput = {
      supplier: { connect: { id: supplierId } },
      addressCode: data.addressCode,
      label: data.label ?? null,
      address1: data.address1 ?? null,
      address2: data.address2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      country: data.country ?? "USA",
      phone: data.phone ?? null,
      email: data.email ?? null,
      isMailingAddress: data.isMailingAddress,
      isRemittanceAddress: data.isRemittanceAddress,
      isShippingAddress: data.isShippingAddress,
      isDefaultMailing: data.isDefaultMailing,
      isDefaultRemittance: data.isDefaultRemittance,
      isDefaultShipping: data.isDefaultShipping,
    };

    // If setting any defaults, clear existing defaults in a transaction
    const needsDefaultClear =
      data.isDefaultMailing === true || data.isDefaultRemittance === true || data.isDefaultShipping === true;

    let result;
    if (needsDefaultClear) {
      result = await this.prisma.$transaction(async (tx) => {
        if (data.isDefaultMailing) {
          await tx.supplierAddress.updateMany({
            where: { supplierId, isDefaultMailing: true },
            data: { isDefaultMailing: false },
          });
        }
        if (data.isDefaultRemittance) {
          await tx.supplierAddress.updateMany({
            where: { supplierId, isDefaultRemittance: true },
            data: { isDefaultRemittance: false },
          });
        }
        if (data.isDefaultShipping) {
          await tx.supplierAddress.updateMany({
            where: { supplierId, isDefaultShipping: true },
            data: { isDefaultShipping: false },
          });
        }

        return tx.supplierAddress.create({ data: createData });
      });
    } else {
      result = await this.prisma.supplierAddress.create({ data: createData });
    }

    // Sync flat fields on the Supplier record to reflect the newly created address
    await this.syncFlatFields(supplierId);

    return result;
  }

  /**
   * Update an existing address
   */
  async update(id: string, data: UpdateSupplierAddressInput) {
    // Verify address exists
    const existing = await this.prisma.supplierAddress.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundError("SupplierAddress", id);
    }

    // Build update payload dynamically (only set provided fields)
    const updateData: Record<string, unknown> = {};
    if (data.addressCode !== undefined) updateData.addressCode = data.addressCode;
    if (data.label !== undefined) updateData.label = data.label;
    if (data.address1 !== undefined) updateData.address1 = data.address1;
    if (data.address2 !== undefined) updateData.address2 = data.address2;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.zip !== undefined) updateData.zip = data.zip;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.isMailingAddress !== undefined) updateData.isMailingAddress = data.isMailingAddress;
    if (data.isRemittanceAddress !== undefined) updateData.isRemittanceAddress = data.isRemittanceAddress;
    if (data.isShippingAddress !== undefined) updateData.isShippingAddress = data.isShippingAddress;
    if (data.isDefaultMailing !== undefined) updateData.isDefaultMailing = data.isDefaultMailing;
    if (data.isDefaultRemittance !== undefined) updateData.isDefaultRemittance = data.isDefaultRemittance;
    if (data.isDefaultShipping !== undefined) updateData.isDefaultShipping = data.isDefaultShipping;

    // If toggling any default ON, clear existing defaults first
    const needsDefaultClear =
      data.isDefaultMailing === true || data.isDefaultRemittance === true || data.isDefaultShipping === true;

    let result;
    if (needsDefaultClear) {
      result = await this.prisma.$transaction(async (tx) => {
        if (data.isDefaultMailing) {
          await tx.supplierAddress.updateMany({
            where: { supplierId: existing.supplierId, isDefaultMailing: true, id: { not: id } },
            data: { isDefaultMailing: false },
          });
        }
        if (data.isDefaultRemittance) {
          await tx.supplierAddress.updateMany({
            where: { supplierId: existing.supplierId, isDefaultRemittance: true, id: { not: id } },
            data: { isDefaultRemittance: false },
          });
        }
        if (data.isDefaultShipping) {
          await tx.supplierAddress.updateMany({
            where: { supplierId: existing.supplierId, isDefaultShipping: true, id: { not: id } },
            data: { isDefaultShipping: false },
          });
        }

        return tx.supplierAddress.update({
          where: { id },
          data: updateData as Prisma.SupplierAddressUpdateInput,
        });
      });
    } else {
      result = await this.prisma.supplierAddress.update({
        where: { id },
        data: updateData as Prisma.SupplierAddressUpdateInput,
      });
    }

    // Sync flat fields to keep legacy consumers (PDF, onboarding form, inventory) accurate
    await this.syncFlatFields(existing.supplierId);

    return result;
  }

  /**
   * Delete an address
   */
  async delete(id: string): Promise<void> {
    const existing = await this.prisma.supplierAddress.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundError("SupplierAddress", id);
    }

    await this.prisma.supplierAddress.delete({ where: { id } });

    // Sync flat fields: deleted address may have been a default — recalculate
    await this.syncFlatFields(existing.supplierId);
  }

  // --------------------------------------------------------------------------
  // DEFAULT MANAGEMENT
  // --------------------------------------------------------------------------

  /**
   * Set an address as the default for a given type (mailing, remittance, or shipping).
   * Clears the default flag from ALL other addresses of the same supplier for that type.
   */
  async setDefault(id: string, type: AddressDefaultType) {
    const address = await this.prisma.supplierAddress.findUnique({
      where: { id },
    });
    if (!address) {
      throw new NotFoundError("SupplierAddress", id);
    }

    const { isDefault } = defaultFieldsFor(type);

    const result = await this.prisma.$transaction(async (tx) => {
      // Clear the default flag from all addresses of this supplier
      await tx.supplierAddress.updateMany({
        where: { supplierId: address.supplierId, [isDefault]: true },
        data: { [isDefault]: false },
      });

      // Set this address as the new default
      return tx.supplierAddress.update({
        where: { id },
        data: { [isDefault]: true },
      });
    });

    // Sync flat fields so legacy consumers reflect the new default
    await this.syncFlatFields(address.supplierId);

    return result;
  }

  // --------------------------------------------------------------------------
  // FLAT FIELD SYNC (legacy compatibility)
  // --------------------------------------------------------------------------

  /**
   * Sync the Supplier table's legacy flat address columns from the current
   * default SupplierAddress records.
   *
   * Mapping:
   *   billingAddress/*   ← isDefaultMailing=true (fallback: first isMailingAddress)
   *   shippingAddress/*  ← isDefaultShipping=true (fallback: first isShippingAddress)
   *   remittanceAddress/*← isDefaultRemittance=true (fallback: first isRemittanceAddress)
   *
   * This keeps the PO PDF generator, onboarding form, and inventory service
   * consistent without any changes to those consumers.
   */
  private async syncFlatFields(supplierId: string): Promise<void> {
    const addresses = await this.prisma.supplierAddress.findMany({
      where: { supplierId },
      select: {
        address1: true,
        address2: true,
        city: true,
        state: true,
        zip: true,
        country: true,
        isMailingAddress: true,
        isRemittanceAddress: true,
        isShippingAddress: true,
        isDefaultMailing: true,
        isDefaultRemittance: true,
        isDefaultShipping: true,
      },
    });

    // Pick best address for each type
    const mailingAddr =
      addresses.find((a) => a.isDefaultMailing) ??
      addresses.find((a) => a.isMailingAddress) ??
      null;

    const shippingAddr =
      addresses.find((a) => a.isDefaultShipping) ??
      addresses.find((a) => a.isShippingAddress) ??
      null;

    const remittanceAddr =
      addresses.find((a) => a.isDefaultRemittance) ??
      addresses.find((a) => a.isRemittanceAddress) ??
      null;

    const updateData = {
      ...flatFieldsFromAddress(mailingAddr, "billing"),
      ...flatFieldsFromAddress(shippingAddr, "shipping"),
      ...flatFieldsFromAddress(remittanceAddr, "remittance"),
    };

    await this.prisma.supplier.update({
      where: { id: supplierId },
      data: updateData,
    });
  }

  /**
   * Get the default address for a supplier by type
   */
  async getDefault(supplierId: string, type: AddressDefaultType) {
    const { isDefault } = defaultFieldsFor(type);

    const address = await this.prisma.supplierAddress.findFirst({
      where: {
        supplierId,
        [isDefault]: true,
      },
    });

    return address;
  }

  // --------------------------------------------------------------------------
  // PO SNAPSHOT
  // --------------------------------------------------------------------------

  /**
   * Snapshot an address for use on a PO.
   * Returns a flat object with vendor* fields suitable for embedding on a PO record.
   */
  async snapshotForPO(addressId: string): Promise<POAddressSnapshot> {
    const address = await this.prisma.supplierAddress.findUnique({
      where: { id: addressId },
      include: {
        supplier: { select: { name: true } },
      },
    });

    if (!address) {
      throw new NotFoundError("SupplierAddress", addressId);
    }

    return {
      supplierAddressId: address.id,
      vendorName: address.supplier.name,
      vendorAddress1: address.address1,
      vendorAddress2: address.address2,
      vendorCity: address.city,
      vendorState: address.state,
      vendorZip: address.zip,
      vendorCountry: address.country,
    };
  }

  /**
   * Get the best address for a PO:
   *   1. Default mailing address
   *   2. First mailing address
   *   3. First available address
   *   4. null if no addresses exist
   */
  async getDefaultForPO(supplierId: string) {
    // 1. Try default mailing
    const defaultMailing = await this.prisma.supplierAddress.findFirst({
      where: { supplierId, isDefaultMailing: true },
    });
    if (defaultMailing) return defaultMailing;

    // 2. Try any mailing address
    const anyMailing = await this.prisma.supplierAddress.findFirst({
      where: { supplierId, isMailingAddress: true },
      orderBy: { addressCode: "asc" },
    });
    if (anyMailing) return anyMailing;

    // 3. First available address
    const firstAddress = await this.prisma.supplierAddress.findFirst({
      where: { supplierId },
      orderBy: { addressCode: "asc" },
    });

    return firstAddress;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

const globalForSupplierAddress = globalThis as unknown as {
  supplierAddressService: SupplierAddressService | undefined;
};

export const supplierAddressService =
  globalForSupplierAddress.supplierAddressService ??
  (globalForSupplierAddress.supplierAddressService = new SupplierAddressService(prisma));
