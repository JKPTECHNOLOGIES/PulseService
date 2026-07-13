import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/purchasing/invoices/eligible-approvers
 *
 * Returns a list of active users who are eligible to be assigned as invoice approvers
 * during the reassign-approver workflow.
 *
 * Eligibility rule: ALL active users EXCEPT those with the "Admin" or "Viewer" role.
 * - "Viewer" accounts are read-only and cannot act on invoices.
 * - "Admin" accounts are system administrators and should not be assigned as approvers
 *   in the normal workflow (they can approve via their elevated role instead).
 *
 * Access: Any authenticated user (no special permission required).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all active users EXCEPT those with "Admin" or "Viewer" roles.
    // Using notIn to exclude both system-level roles from the approver picker.
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          name: {
            notIn: ['Admin', 'Technician', 'Viewer'],
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { lastName: 'asc' },
        { firstName: 'asc' },
      ],
    });

    const approvers = users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim() || u.email,
      email: u.email,
      role: u.role.name,
    }));

    return NextResponse.json({ data: approvers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch eligible approvers' },
      { status: 500 }
    );
  }
}
