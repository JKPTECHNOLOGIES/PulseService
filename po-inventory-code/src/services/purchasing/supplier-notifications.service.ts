/**
 * Supplier Notification Helpers
 *
 * Centralised functions for firing supplier-related notifications to the
 * Finance Manager and Purchasing Manager roles.
 *
 * Two events are covered:
 *  1. New supplier created  → supplier.created
 *  2. Restricted document added / deleted / reclassified → supplier.secured_document_changed
 */

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { ServiceContext } from "@/types/service-types";
import { NotificationCategory, NotificationPriority } from "@/services/notifications/notification.types";
import { SUPPLIER_NOTIFICATIONS } from "@/services/notifications/notification-types-registry";
import { notificationService } from "@/services/notifications";
import { graphEmailService } from "@/lib/email/graph-email.service";
import { RoleName } from "@/types/permissions";

/** Roles that should receive supplier financial notifications */
const SUPPLIER_FINANCE_ROLES = [
  RoleName.FINANCE_MANAGER,
  RoleName.PURCHASING_MANAGER,
  RoleName.ADMIN,
] as const;

/**
 * Returns the AP / finance notification email override from FinanceSettings.
 * When set, supplier notification EMAILS are sent here instead of to individual users.
 * In-app Pulse notifications are always delivered to individual users regardless.
 */
async function getApEmail(prismaClient: PrismaClient): Promise<string | null> {
  try {
    const settings = await prismaClient.financeSettings.findFirst({
      select: { apEmail: true },
    });
    return (settings as unknown as { apEmail?: string | null })?.apEmail ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns all active users whose role is Finance Manager, Purchasing Manager, or Admin.
 * Results are de-duplicated by user ID.
 */
async function getSupplierFinanceRecipients(
  prismaClient: PrismaClient,
): Promise<Array<{ id: string }>> {
  const users = await prismaClient.user.findMany({
    where: {
      isActive: true,
      role: { name: { in: [...SUPPLIER_FINANCE_ROLES] } },
    },
    select: { id: true },
  });

  // De-duplicate (same user could theoretically match multiple role filters)
  const seen = new Set<string>();
  return users.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

// ============================================================================
// PUBLIC HELPERS
// ============================================================================

/**
 * Fire a `supplier.created` notification to all Finance Manager, Purchasing
 * Manager, and Admin users.
 *
 * Called from SupplierService.create() after the supplier record is persisted.
 * Errors are intentionally swallowed so a notification failure never rolls back
 * the supplier creation.
 */
export async function notifySupplierCreated(
  context: ServiceContext,
  supplier: {
    id: string;
    name: string;
    internalVendorCode?: string | null;
    isSupplier: boolean;
    isContractor: boolean;
  },
  prismaClient: PrismaClient = defaultPrisma,
): Promise<void> {
  try {
    const [recipients, apEmail] = await Promise.all([
      getSupplierFinanceRecipients(prismaClient),
      getApEmail(prismaClient),
    ]);
    if (recipients.length === 0) return;

    const supplierType = supplier.isSupplier && supplier.isContractor
      ? "Supplier & Contractor"
      : supplier.isSupplier
        ? "Supplier"
        : supplier.isContractor
          ? "Contractor"
          : "Vendor";

    const vendorLabel = supplier.internalVendorCode
      ? ` (Vendor #${supplier.internalVendorCode})`
      : "";

    const title = `New ${supplierType} Added: ${supplier.name}${vendorLabel}`;
    const message = `${context.userName} added a new ${supplierType.toLowerCase()} — ${supplier.name}${vendorLabel}. Finance onboarding (ACH / bank info) may be required.`;
    const notifData = {
      type: SUPPLIER_NOTIFICATIONS.SUPPLIER_CREATED.type,
      category: NotificationCategory.PURCHASING,
      title,
      message,
      priority: NotificationPriority.HIGH,
      actionUrl: `/purchasing/suppliers/${supplier.id}`,
      actionLabel: "View Supplier",
      data: {
        supplierId: supplier.id,
        supplierName: supplier.name,
        vendorCode: supplier.internalVendorCode ?? null,
        supplierType,
        createdBy: context.userName,
      },
    };

    // In-app (Pulse) notifications always go to individual role users
    // Email routing: AP inbox if configured, otherwise per-user emails
    for (const recipient of recipients) {
      await notificationService.sendNotification(context, {
        userId: recipient.id,
        ...notifData,
        // When an AP email is set, suppress per-user email — one AP email sent below
        ...(apEmail ? { channels: ["inApp", "push"] as never[] } : {}),
      });
    }

    // Send one email to the AP inbox if configured
    if (apEmail) {
      await graphEmailService.sendEmail({
        to: apEmail,
        subject: title,
        body: `<p>${message}</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/purchasing/suppliers/${supplier.id}">View Supplier</a></p>`,
        isHtml: true,
      });
    }
  } catch (err) {
    // Swallow — notification failure must not break supplier creation
    console.error("[notifySupplierCreated] failed to send notification:", err);
  }
}

/**
 * Fire a `supplier.secured_document_changed` notification to all Finance
 * Manager, Purchasing Manager, and Admin users.
 *
 * Called when:
 *  - A secured document is uploaded to a supplier     (changeType: "uploaded")
 *  - A secured document is deleted from a supplier    (changeType: "deleted")
 *  - A document's isSecured flag is toggled           (changeType: "secured" | "unsecured")
 *
 * Errors are swallowed so notification failure never blocks document operations.
 */
export async function notifySupplierSecuredDocChanged(
  context: ServiceContext,
  payload: {
    supplierId: string;
    supplierName: string;
    documentId: string;
    documentTitle: string;
    documentType: string;
    changeType: "uploaded" | "deleted" | "secured" | "unsecured";
  },
  prismaClient: PrismaClient = defaultPrisma,
): Promise<void> {
  try {
    const [recipients, apEmail] = await Promise.all([
      getSupplierFinanceRecipients(prismaClient),
      getApEmail(prismaClient),
    ]);
    if (recipients.length === 0) return;

    const actionLabel: Record<typeof payload.changeType, string> = {
      uploaded: "uploaded",
      deleted: "deleted",
      secured: "marked as restricted",
      unsecured: "restriction removed",
    };

    const label = actionLabel[payload.changeType];
    const title = `Restricted Document ${label.charAt(0).toUpperCase() + label.slice(1)}: ${payload.supplierName}`;
    const message = `${context.userName} ${label} "${payload.documentTitle}" (${payload.documentType}) on supplier ${payload.supplierName}. This document is restricted to Finance & Purchasing roles.`;
    const notifData = {
      type: SUPPLIER_NOTIFICATIONS.SUPPLIER_SECURED_DOC_CHANGED.type,
      category: NotificationCategory.PURCHASING,
      title,
      message,
      priority: NotificationPriority.HIGH,
      actionUrl: `/purchasing/suppliers/${payload.supplierId}?tab=documents`,
      actionLabel: "View Documents",
      data: {
        supplierId: payload.supplierId,
        supplierName: payload.supplierName,
        documentId: payload.documentId,
        documentTitle: payload.documentTitle,
        documentType: payload.documentType,
        changeType: payload.changeType,
        changedBy: context.userName,
      },
    };

    // In-app notifications always go to individual role users
    for (const recipient of recipients) {
      await notificationService.sendNotification(context, {
        userId: recipient.id,
        ...notifData,
        ...(apEmail ? { channels: ["inApp", "push"] as never[] } : {}),
      });
    }

    // Send one email to the AP inbox if configured
    if (apEmail) {
      await graphEmailService.sendEmail({
        to: apEmail,
        subject: title,
        body: `<p>${message}</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/purchasing/suppliers/${payload.supplierId}?tab=documents">View Documents</a></p>`,
        isHtml: true,
      });
    }
  } catch (err) {
    // Swallow — notification failure must not block document operations
    console.error("[notifySupplierSecuredDocChanged] failed to send notification:", err);
  }
}
