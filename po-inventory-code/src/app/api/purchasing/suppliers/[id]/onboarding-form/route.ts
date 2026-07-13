/**
 * Vendor Onboarding Form API Route
 *
 * GET /api/purchasing/suppliers/:id/onboarding-form - Get vendor onboarding form data
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { success } from "@/lib/api-response";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { supplierService } from "@/services/purchasing";

/**
 * GET /api/purchasing/suppliers/:id/onboarding-form
 * Get vendor onboarding form data for printing
 */
export const GET = createGetHandlerWithParams(
  async (_req: NextRequest, context: ApiContextWithParams) => {
    // Get supplier with all related data
    const supplier = await supplierService.getById(
      context.serviceContext,
      context.params.id,
      ["purchaseOrders", "inventoryItems"]
    );

    // Get supplier statistics
    const stats = await supplierService.getStats(
      context.serviceContext,
      context.params.id
    );

    // Format data for onboarding form
    const onboardingData = {
      // Header Information
      formTitle: "Vendor Onboarding Form",
      generatedDate: new Date().toISOString(),
      generatedBy: context.serviceContext.userName || "System",

      // Vendor Identification
      identification: {
        internalVendorCode: supplier.internalVendorCode,
        legacyCode: supplier.code,
        name: supplier.name,
        isSupplier: supplier.isSupplier,
        isContractor: supplier.isContractor,
        isActive: supplier.isActive,
      },

      // Contact Information
      contact: {
        contactPerson: supplier.contactPerson,
        email: supplier.email,
        phone: supplier.phone,
        fax: supplier.fax,
        website: supplier.website,
      },

      // Billing Address
      billingAddress: {
        address: supplier.billingAddress,
        address2: supplier.billingAddress2,
        city: supplier.billingCity,
        state: supplier.billingState,
        zip: supplier.billingZip,
        country: supplier.billingCountry,
      },

      // Shipping Address
      shippingAddress: {
        address: supplier.shippingAddress,
        address2: supplier.shippingAddress2,
        city: supplier.shippingCity,
        state: supplier.shippingState,
        zip: supplier.shippingZip,
        country: supplier.shippingCountry,
      },

      // Financial Information
      financial: {
        taxId: supplier.taxId,
        ein: supplier.ein,
        paymentTerms: supplier.paymentTerms,
        paymentMethod: supplier.paymentMethod,
        creditLimit: supplier.creditLimit,
        creditTermsDays: supplier.creditTermsDays,
        discountPercent: supplier.discountPercent,
        accountNumber: supplier.accountNumber,
      },

      // Performance Metrics
      performance: {
        rating: supplier.rating,
        onTimeDeliveryRate: supplier.onTimeDeliveryRate,
        qualityRating: supplier.qualityRating,
        leadTimeDays: supplier.leadTimeDays,
        minimumOrderAmount: supplier.minimumOrderAmount,
        shippingMethod: supplier.shippingMethod,
      },

      // Contractor-Specific Information
      contractor: supplier.isContractor
        ? {
            defaultRate: supplier.defaultRate,
            rateUnit: supplier.rateUnit,
          }
        : null,

      // Statistics
      statistics: {
        totalOrders: stats.totalOrders,
        openOrders: stats.openOrders,
        completedOrders: stats.completedOrders,
        totalOrderValue: stats.totalOrderValue,
        averageOrderValue: stats.averageOrderValue,
        onTimeDeliveryRate: stats.onTimeDeliveryRate,
        averageLeadTime: stats.averageLeadTime,
        lastOrderDate: stats.lastOrderDate,
        itemsSupplied: stats.itemsSupplied,
      },

      // Additional Information
      additional: {
        notes: supplier.notes,
        parentSupplierId: supplier.parentSupplierId,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
      },

      // Approval Section (for finance team to fill out)
      approval: {
        reviewedBy: null,
        reviewedDate: null,
        approvedBy: null,
        approvedDate: null,
        status: "Pending Review",
        comments: null,
      },
    };

    return success(
      onboardingData,
      "Vendor onboarding form data retrieved successfully"
    );
  }
);
