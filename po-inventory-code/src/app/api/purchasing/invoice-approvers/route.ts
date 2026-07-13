/**
 * API Route: Get Available Invoice Approvers
 * 
 * Returns a list of users who can be designated as invoice approvers for POs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { POInvoiceApproverService } from '@/services/purchasing/po-invoice-approver.service';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function GET(_request: NextRequest) {
  try {
    // Get user session
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get available invoice approvers
    const approvers = await POInvoiceApproverService.getAvailableInvoiceApprovers();

    return NextResponse.json({
      success: true,
      data: approvers,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('[API] Failed to get available invoice approvers:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage 
      },
      { status: 500 }
    );
  }
}