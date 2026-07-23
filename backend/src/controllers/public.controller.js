const prisma = require("../config/database");
const { verifyPublicToken } = require("../utils/publicToken");
const { recordTimelineEvent } = require("../utils/timeline");

// These endpoints are intentionally UNAUTHENTICATED — they back the public
// "review & approve your estimate" link emailed to a customer. Access is gated
// by an unguessable HMAC token (see utils/publicToken) rather than a login.

const loadVerified = async (req, res) => {
  const { id } = req.params;
  const token = req.query.token || req.body?.token;
  if (!verifyPublicToken("estimate", id, token)) {
    res.status(403).json({ success: false, error: "Invalid or missing token" });
    return null;
  }
  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          firstName: true,
          lastName: true,
          companyName: true,
          email: true,
        },
      },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!estimate) {
    res.status(404).json({ success: false, error: "Estimate not found" });
    return null;
  }
  return estimate;
};

// Read-only estimate for the customer. Only exposes presentation fields.
const getEstimate = async (req, res) => {
  try {
    const estimate = await loadVerified(req, res);
    if (!estimate) return;

    // First view of a sent estimate marks it "viewed" (mirrors the office flow).
    if (estimate.status === "sent") {
      await prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: "viewed", viewedAt: new Date() },
      });
      estimate.status = "viewed";

      await recordTimelineEvent({
        customerId: estimate.customerId,
        entityType: "estimate",
        entityId: estimate.id,
        entityLabel: estimate.estimateNumber,
        action: "viewed",
        description: "Customer viewed Quote",
        userId: null,
      });
    }

    const settings = await prisma.companySettings.findFirst();

    return res.json({
      success: true,
      data: {
        id: estimate.id,
        estimateNumber: estimate.estimateNumber,
        title: estimate.title,
        status: estimate.status,
        validUntil: estimate.validUntil,
        subtotal: estimate.subtotal,
        discountType: estimate.discountType,
        discountValue: estimate.discountValue,
        taxRate: estimate.taxRate,
        taxAmount: estimate.taxAmount,
        total: estimate.total,
        notes: estimate.notes,
        terms: estimate.terms,
        lineItems: estimate.lineItems.map((li) => ({
          id: li.id,
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
        })),
        customer: {
          firstName: estimate.customer?.firstName,
          lastName: estimate.customer?.lastName,
          companyName: estimate.customer?.companyName,
        },
        company: settings
          ? {
              name: settings.name,
              phone: settings.phone,
              email: settings.email,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("public.getEstimate error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const APPROVABLE = ["draft", "sent", "viewed"];

const approveEstimate = async (req, res) => {
  try {
    const estimate = await loadVerified(req, res);
    if (!estimate) return;
    if (!APPROVABLE.includes(estimate.status)) {
      return res.status(400).json({
        success: false,
        error: `Estimate can no longer be approved (status: ${estimate.status})`,
      });
    }
    await prisma.estimate.update({
      where: { id: estimate.id },
      data: { status: "approved", approvedAt: new Date() },
    });

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "approved",
      description: "Customer approved Quote online",
      userId: null,
    });

    return res.json({ success: true, data: { status: "approved" } });
  } catch (err) {
    console.error("public.approveEstimate error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const rejectEstimate = async (req, res) => {
  try {
    const estimate = await loadVerified(req, res);
    if (!estimate) return;
    if (!APPROVABLE.includes(estimate.status)) {
      return res.status(400).json({
        success: false,
        error: `Estimate can no longer be changed (status: ${estimate.status})`,
      });
    }
    const rejectionReason = req.body?.rejectionReason || null;
    await prisma.estimate.update({
      where: { id: estimate.id },
      data: {
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason,
      },
    });

    await recordTimelineEvent({
      customerId: estimate.customerId,
      entityType: "estimate",
      entityId: estimate.id,
      entityLabel: estimate.estimateNumber,
      action: "rejected",
      description: rejectionReason
        ? `Customer rejected Quote online (${rejectionReason})`
        : "Customer rejected Quote online",
      userId: null,
    });

    return res.json({ success: true, data: { status: "rejected" } });
  } catch (err) {
    console.error("public.rejectEstimate error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { getEstimate, approveEstimate, rejectEstimate };
