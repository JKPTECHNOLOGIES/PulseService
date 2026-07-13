/**
 * POST /api/purchasing/requisitions/notify-pending-approvers
 *
 * One-time backfill endpoint: sends approval-request emails to the current-level
 * approvers for every requisition that is presently in a PENDING or PARTIALLY_APPROVED
 * state.  This is used after the approval-notification feature was deployed to catch up
 * all pre-existing pending requisitions whose approvers never received an email.
 *
 * Protection: Admin-only.  The caller must be authenticated with the "Admin" role,
 * OR must supply the internal `x-backfill-secret` header whose value matches the
 * NEXTAUTH_SECRET environment variable (allows the root-level Node.js backfill script
 * to call this endpoint without an interactive session).
 *
 * Email failures for individual recipients do NOT abort the batch — each error is
 * collected and returned in the JSON summary.
 *
 * Response shape:
 * {
 *   sent:    number,
 *   skipped: number,
 *   errors:  string[],
 *   reqs: [{ reqNumber: string, level: number, approverEmails: string[] }]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RequisitionApprovalStatus } from "@prisma/client";
import { graphEmailService } from "@/lib/email/graph-email.service";
import { renderRequisitionApprovalRequestedEmail } from "@/lib/email/templates/critical/requisition-approval-requested.template";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReqResult {
  reqNumber: string;
  level: number;
  approverEmails: string[];
}

interface ResponseBody {
  sent: number;
  skipped: number;
  errors: string[];
  reqs: ReqResult[];
}

// ---------------------------------------------------------------------------
// Helper — verify internal backfill secret header
// ---------------------------------------------------------------------------
function isBackfillSecretValid(request: NextRequest): boolean {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    logger.warn("[notify-pending-approvers] NEXTAUTH_SECRET is not set in the server environment — backfill secret auth cannot succeed.");
    return false;
  }
  const header = request.headers.get("x-backfill-secret");
  if (!header) {
    logger.warn("[notify-pending-approvers] x-backfill-secret header is missing from the request.");
    return false;
  }
  const match = header === secret;
  if (!match) {
    // Log lengths only — never log the actual secret values.
    logger.warn(
      `[notify-pending-approvers] x-backfill-secret mismatch: ` +
      `header length=${header.length}, expected length=${secret.length}. ` +
      `Check that the script's NEXTAUTH_SECRET matches the server's NEXTAUTH_SECRET exactly (no extra whitespace or quotes).`
    );
  }
  return match;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth guard ────────────────────────────────────────────────────────────
  // Accept either:
  //   1. An authenticated Admin session (interactive browser / API client)
  //   2. The x-backfill-secret header matching NEXTAUTH_SECRET (script usage)
  let isAuthorized = false;

  if (isBackfillSecretValid(request)) {
    isAuthorized = true;
  } else {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      // Check if the authenticated user has the Admin role
      const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { role: true },
      });
      if (dbUser?.role.name === "Admin") {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Forbidden — Admin role or backfill secret required" },
      { status: 403 },
    );
  }

  // ── Main batch logic ──────────────────────────────────────────────────────
  const errors: string[] = [];
  const reqs: ReqResult[] = [];
  let sent = 0;
  let skipped = 0;

  try {
    // 1. Find all requisitions that are currently awaiting approval.
    //
    //    Prisma query:
    //      requisition.findMany WHERE
    //        approvalStatus IN ('PENDING', 'PARTIALLY_APPROVED')
    //        AND requiresApproval = true
    //        AND currentApprovalLevel IS NOT NULL
    //      include:
    //        requestedBy (for email template "requesterName")
    //        approvals WHERE status = 'PENDING' (to know which level is active)
    //          include approvalLevel (for levelName)
    //        lines (to compute totalValue for the email template)
    const pendingReqs = await prisma.requisition.findMany({
      where: {
        approvalStatus: {
          in: [
            RequisitionApprovalStatus.PENDING,
            RequisitionApprovalStatus.PARTIALLY_APPROVED,
          ],
        },
        requiresApproval: true,
        currentApprovalLevel: { not: null },
      },
      include: {
        requestedBy: {
          select: { firstName: true, lastName: true },
        },
        lines: {
          select: { quantity: true, estimatedPrice: true },
        },
        approvals: {
          where: { status: "PENDING" },
          include: {
            approvalLevel: true,
          },
          orderBy: { levelNumber: "asc" },
        },
      },
      orderBy: { submittedForApprovalAt: "asc" },
    });

    logger.info(
      `[notify-pending-approvers] Found ${pendingReqs.length} pending requisition(s) to notify.`,
    );

    for (const req of pendingReqs) {
      // The active approval record is the PENDING one at currentApprovalLevel.
      // currentApprovalLevel is guaranteed non-null by the WHERE clause above.
      if (req.currentApprovalLevel === null) continue;
      const currentLevel = req.currentApprovalLevel;
      const activeApproval = req.approvals.find(
        (a) => a.levelNumber === currentLevel,
      );

      if (!activeApproval) {
        skipped++;
        const msg = `REQ ${req.reqNumber}: No PENDING approval record found at currentApprovalLevel=${currentLevel} — skipped.`;
        errors.push(msg);
        logger.warn(`[notify-pending-approvers] ${msg}`);
        continue;
      }

      // 2. Find ALL eligible approvers at the current level via UserApprovalAuthority.
      //    This mirrors the logic in requisition-approval.service.ts (getApprovalSummary).
      const authorities = await prisma.userApprovalAuthority.findMany({
        where: {
          approvalLevelId: activeApproval.approvalLevelId,
          isActive: true,
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (authorities.length === 0) {
        skipped++;
        const msg =
          `REQ ${req.reqNumber}: No active UserApprovalAuthority entries for level ${currentLevel} ` +
          `(approvalLevelId=${activeApproval.approvalLevelId}) — skipped.`;
        errors.push(msg);
        logger.warn(`[notify-pending-approvers] ${msg}`);
        continue;
      }

      // 3. Compute total value from lines (matches the approval-service pattern).
      const totalValue = req.lines.reduce((sum, line) => {
        return sum + Number(line.quantity) * Number(line.estimatedPrice);
      }, 0);

      const submittedAtStr = req.submittedForApprovalAt
        ? req.submittedForApprovalAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

      const levelName = activeApproval.approvalLevel.name;
      const reqApproverEmails: string[] = [];

      // 4. Send the approval-requested email (scenario: 'new') to each eligible approver.
      for (const authority of authorities) {
        const user = authority.user;
        if (!user.email) {
          skipped++;
          logger.warn(
            `[notify-pending-approvers] REQ ${req.reqNumber}: approver userId=${authority.userId} has no email — skipped.`,
          );
          continue;
        }

        try {
          const emailBody = renderRequisitionApprovalRequestedEmail({
            recipientName: `${user.firstName} ${user.lastName}`,
            reqNumber: req.reqNumber,
            description: req.description ?? "",
            requesterName: `${req.requestedBy.firstName} ${req.requestedBy.lastName}`,
            justification: req.justification ?? undefined,
            totalValue,
            levelNumber: currentLevel,
            levelName,
            submittedAt: submittedAtStr,
            purchaseOrderNumber: req.purchaseOrderNumber ?? undefined,
            requisitionId: req.id,
            purchaseOrderId: req.purchaseOrderId ?? undefined,
            scenario: "new",
          });

          const emailSubject =
            `Requisition ${req.reqNumber} Requires Your Approval \u2014 Level ${currentLevel}`;

          await graphEmailService.sendEmail({
            to: user.email,
            subject: emailSubject,
            body: emailBody,
            isHtml: true,
          });

          sent++;
          reqApproverEmails.push(user.email);

          logger.info(
            `[notify-pending-approvers] Sent to ${user.email} for REQ ${req.reqNumber} (Level ${currentLevel}).`,
          );
        } catch (emailErr) {
          const errMsg =
            `REQ ${req.reqNumber} → ${user.email}: ` +
            (emailErr instanceof Error ? emailErr.message : String(emailErr));
          errors.push(errMsg);
          logger.error(`[notify-pending-approvers] Email send failed: ${errMsg}`);
          // Do NOT abort — continue with next approver / next req
        }
      }

      if (reqApproverEmails.length > 0) {
        reqs.push({
          reqNumber: req.reqNumber,
          level: currentLevel,
          approverEmails: reqApproverEmails,
        });
      }
    }
  } catch (fatalErr) {
    const msg =
      fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    logger.error(`[notify-pending-approvers] Fatal error: ${msg}`);
    return NextResponse.json(
      { error: "Internal server error", detail: msg },
      { status: 500 },
    );
  }

  const body: ResponseBody = { sent, skipped, errors, reqs };

  logger.info(
    `[notify-pending-approvers] Done. sent=${sent}, skipped=${skipped}, errors=${errors.length}.`,
  );

  return NextResponse.json(body, { status: 200 });
}
