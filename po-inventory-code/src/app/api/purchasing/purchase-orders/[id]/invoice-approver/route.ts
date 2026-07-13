/**
 * API Route: Get PO Invoice Approver Information
 * 
 * Returns information about whether a PO has service lines and who the designated
 * invoice approver is (if set). Used by the invoice upload form to determine
 * whether to show/disable the approver selection field.
 */

import { NextRequest, NextResponse } from 'next/server';
import { POInvoiceApproverService } from '@/services/purchasing/po-invoice-approver.service';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { error: 'PO ID is required' },
        { status: 400 }
      );
    }

    // Get PO invoice approver information
    const approverInfo = await POInvoiceApproverService.getPOInvoiceApproverInfo(id);

    return NextResponse.json({
      success: true,
      data: approverInfo,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('[API] Failed to get PO invoice approver info:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = errorMessage.includes('not found') ? 404 : 500;

    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage 
      },
      { status: statusCode }
    );
  }
}
