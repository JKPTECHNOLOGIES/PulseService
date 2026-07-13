/**
 * Unit Tests for createInvoiceMatchTransaction()
 *
 * Suite 3: Tests the InvoiceGLService method that creates GL entries
 * when an invoice is matched to receipts (3-way match confirmation).
 *
 * Covers rule evaluation context, transaction creation, posting,
 * error handling for unmatched rules and unbalanced entries,
 * description formatting, and error propagation.
 *
 * @see src/services/purchasing/invoice-gl.service.ts
 */

import { glTransactionService, getCurrentBudgetPeriod } from '@/services/gl';
import { glRuleEngineService } from '@/services/gl/gl-rule-engine.service';
import { GLEventType, type GLEntry } from '@/types/gl-rules';
import type { ServiceContext } from '@/types/service-types';
import { BadRequestError } from '@/lib/api-errors';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('@/services/gl', () => ({
  glTransactionService: {
    createTransaction: jest.fn(),
    postTransaction: jest.fn(),
  },
  getCurrentBudgetPeriod: jest.fn(),
}));

jest.mock('@/services/gl/gl-rule-engine.service', () => ({
  glRuleEngineService: {
    evaluateRules: jest.fn(),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {},
}));

// ---------------------------------------------------------------------------
// Typed mock accessors
// ---------------------------------------------------------------------------

const mockEvaluateRules = glRuleEngineService.evaluateRules as jest.Mock;
const mockCreateTransaction = glTransactionService.createTransaction as jest.Mock;
const mockPostTransaction = glTransactionService.postTransaction as jest.Mock;
const mockGetCurrentBudgetPeriod = getCurrentBudgetPeriod as jest.Mock;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const GL_ACCOUNTS = {
  AP_2110: 'cmkc1g7zn0005vsw0pk2t3cvx',
  RECV_NOT_INV_2111: 'cml183rep0018vsw08ov8x4w3',
} as const;

const MOCK_BUDGET_PERIOD = {
  id: 'bp-test-2026',
  name: 'FY2026',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  isCurrent: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockContext: ServiceContext = {
  userId: 'user-test-001',
  userName: 'Test User',
  userRole: 'admin',
  roleId: 'role-test-001',
  userEmail: 'test@example.com',
  permissions: [],
};

const MOCK_INVOICE_PARAMS = {
  invoiceId: 'inv-test-001',
  invoiceNumber: 'INV-2026-001',
  invoiceDate: new Date('2026-03-15'),
  totalAmount: 1500.00,
  supplierId: 'supplier-test-001',
  supplierName: 'Test Supplier Co',
  purchaseOrderId: 'po-test-001',
  poNumber: 'PO-000050',
};

/** Standard two-entry invoice match result from the rule engine */
function makeRuleResult(amount: number): {
  success: boolean;
  matched: boolean;
  entries: GLEntry[];
  isBalanced: boolean;
  totalDebits: number;
  totalCredits: number;
} {
  return {
    success: true,
    matched: true,
    isBalanced: true,
    totalDebits: amount,
    totalCredits: amount,
    entries: [
      {
        entryType: 'DEBIT',
        glAccountId: GL_ACCOUNTS.RECV_NOT_INV_2111,
        amount,
        description: 'AP-Tabware Received Not Invoiced',
      },
      {
        entryType: 'CREDIT',
        glAccountId: GL_ACCOUNTS.AP_2110,
        amount,
        description: 'Accounts Payable',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Import the service under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { invoiceGLService } from '../invoice-gl.service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createInvoiceMatchTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentBudgetPeriod.mockResolvedValue(MOCK_BUDGET_PERIOD);
    mockCreateTransaction.mockResolvedValue('gl-txn-invoice-001');
    mockPostTransaction.mockResolvedValue(undefined);
  });

  // =========================================================================
  // 3.1 — Creates INVOICE_MATCH GL transaction with correct context
  // =========================================================================
  it('creates INVOICE_MATCH GL transaction with correct context', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(mockEvaluateRules).toHaveBeenCalledWith(
      mockContext,
      GLEventType.INVOICE_MATCH,
      expect.objectContaining({
        amount: 1500.00,
        invoiceId: 'inv-test-001',
        invoiceNumber: 'INV-2026-001',
        referenceType: 'Invoice',
        referenceId: 'inv-test-001',
        referenceNumber: 'INV-2026-001',
      }),
    );
  });

  // =========================================================================
  // 3.2 — Builds correct rule evaluation context
  // =========================================================================
  it('builds correct rule evaluation context with all required fields', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    const ruleContext = (mockEvaluateRules.mock.calls as unknown[][])[0]?.[2] as Record<string, unknown>;

    // Verify all required RuleEvaluationContext fields
    expect(ruleContext).toEqual(
      expect.objectContaining({
        amount: 1500.00,
        invoiceId: 'inv-test-001',
        invoiceNumber: 'INV-2026-001',
        invoiceDate: MOCK_INVOICE_PARAMS.invoiceDate,
        supplierId: 'supplier-test-001',
        supplierName: 'Test Supplier Co',
        poId: 'po-test-001',
        poNumber: 'PO-000050',
        referenceType: 'Invoice',
        referenceId: 'inv-test-001',
        referenceNumber: 'INV-2026-001',
        transactionDate: expect.any(Date) as unknown,
      }),
    );
  });

  // =========================================================================
  // 3.3 — Creates transaction with RECEIPT type
  // =========================================================================
  it('creates transaction with RECEIPT type and correct entries', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(mockCreateTransaction).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        transactionType: 'RECEIPT',
        referenceType: 'Invoice',
        referenceId: 'inv-test-001',
        referenceNumber: 'INV-2026-001',
        fiscalPeriodId: MOCK_BUDGET_PERIOD.id,
        lines: expect.arrayContaining([
          expect.objectContaining({
            entryType: 'DEBIT',
            glAccountId: GL_ACCOUNTS.RECV_NOT_INV_2111,
            amount: 1500,
          }) as unknown,
          expect.objectContaining({
            entryType: 'CREDIT',
            glAccountId: GL_ACCOUNTS.AP_2110,
            amount: 1500,
          }) as unknown,
        ]) as unknown,
      }),
    );
  });

  // =========================================================================
  // 3.4 — Posts transaction after creation
  // =========================================================================
  it('posts transaction after creation', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    const callOrder: string[] = [];
    mockCreateTransaction.mockImplementation(() => {
      callOrder.push('createTransaction');
      return Promise.resolve('gl-txn-invoice-001');
    });
    mockPostTransaction.mockImplementation(() => {
      callOrder.push('postTransaction');
      return Promise.resolve(undefined);
    });

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(callOrder).toEqual(['createTransaction', 'postTransaction']);
    expect(mockPostTransaction).toHaveBeenCalledWith(
      mockContext,
      'gl-txn-invoice-001',
    );
  });

  // =========================================================================
  // 3.5 — Returns correct result
  // =========================================================================
  it('returns correct result with glTransactionId and budgetPeriodId', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    const result = await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(result).toEqual({
      glTransactionId: 'gl-txn-invoice-001',
      budgetPeriodId: MOCK_BUDGET_PERIOD.id,
    });
  });

  // =========================================================================
  // 3.6 — Throws BadRequestError when no rule matches
  // =========================================================================
  it('throws BadRequestError when no GL rule matches', async () => {
    const noMatchResult = {
      success: false,
      matched: false,
      isBalanced: true,
      totalDebits: 0,
      totalCredits: 0,
      entries: [],
    };

    mockEvaluateRules.mockResolvedValueOnce(noMatchResult);

    const promise = invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    await expect(promise).rejects.toThrow(BadRequestError);

    mockEvaluateRules.mockResolvedValueOnce(noMatchResult);

    await expect(
      invoiceGLService.createInvoiceMatchTransaction(
        mockContext,
        MOCK_INVOICE_PARAMS,
      ),
    ).rejects.toThrow('No GL rule matched for INVOICE_MATCH');

    // createTransaction should NOT have been called
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 3.7 — Throws BadRequestError when entries not balanced
  // =========================================================================
  it('throws BadRequestError when GL entries are not balanced', async () => {
    const unbalancedResult = {
      success: true,
      matched: true,
      isBalanced: false,
      totalDebits: 1500,
      totalCredits: 1200,
      entries: [
        {
          entryType: 'DEBIT' as const,
          glAccountId: GL_ACCOUNTS.RECV_NOT_INV_2111,
          amount: 1500,
          description: 'AP-Tabware Received Not Invoiced',
        },
        {
          entryType: 'CREDIT' as const,
          glAccountId: GL_ACCOUNTS.AP_2110,
          amount: 1200,
          description: 'Accounts Payable',
        },
      ],
    };

    mockEvaluateRules.mockResolvedValueOnce(unbalancedResult);

    const promise = invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    await expect(promise).rejects.toThrow(BadRequestError);

    mockEvaluateRules.mockResolvedValueOnce(unbalancedResult);

    await expect(
      invoiceGLService.createInvoiceMatchTransaction(
        mockContext,
        MOCK_INVOICE_PARAMS,
      ),
    ).rejects.toThrow('GL entries not balanced');

    // createTransaction should NOT have been called
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 3.8 — Uses getCurrentBudgetPeriod for fiscal period
  // =========================================================================
  it('uses getCurrentBudgetPeriod for fiscal period', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(mockGetCurrentBudgetPeriod).toHaveBeenCalledTimes(1);
    // Verify the budget period ID is used in the transaction
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        fiscalPeriodId: 'bp-test-2026',
      }),
    );
  });

  // =========================================================================
  // 3.9 — Propagates errors from rule engine
  // =========================================================================
  it('propagates errors from rule engine', async () => {
    mockEvaluateRules.mockRejectedValueOnce(
      new Error('Rule engine exploded'),
    );

    await expect(
      invoiceGLService.createInvoiceMatchTransaction(
        mockContext,
        MOCK_INVOICE_PARAMS,
      ),
    ).rejects.toThrow('Rule engine exploded');
  });

  // =========================================================================
  // 3.10 — Includes PO number in description when provided
  // =========================================================================
  it('includes PO number in description when provided', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(mockCreateTransaction).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        description: expect.stringContaining('PO PO-000050') as unknown,
      }),
    );
  });

  // =========================================================================
  // 3.11 — Includes supplier name in description when provided
  // =========================================================================
  it('includes supplier name in description when provided', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      MOCK_INVOICE_PARAMS,
    );

    expect(mockCreateTransaction).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        description: expect.stringContaining('Test Supplier Co') as unknown,
      }),
    );
  });

  // =========================================================================
  // 3.12 — Description omits PO info when poNumber not provided
  // =========================================================================
  it('omits PO info from description when poNumber not provided', async () => {
    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(800));

    const paramsWithoutPO = {
      invoiceId: 'inv-test-002',
      invoiceNumber: 'INV-2026-002',
      totalAmount: 800,
      supplierId: 'supplier-test-001',
    };

    await invoiceGLService.createInvoiceMatchTransaction(
      mockContext,
      paramsWithoutPO,
    );

    const callArgs = (mockCreateTransaction.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(callArgs.description).toContain('Invoice match: INV-2026-002');
    expect(callArgs.description).not.toContain('PO');
  });

  // =========================================================================
  // 3.13 — Propagates errors from getCurrentBudgetPeriod
  // =========================================================================
  it('propagates errors from getCurrentBudgetPeriod', async () => {
    mockGetCurrentBudgetPeriod.mockRejectedValueOnce(
      new BadRequestError('No active budget period found'),
    );

    await expect(
      invoiceGLService.createInvoiceMatchTransaction(
        mockContext,
        MOCK_INVOICE_PARAMS,
      ),
    ).rejects.toThrow('No active budget period found');

    // Rule engine and transaction should NOT have been called
    expect(mockEvaluateRules).not.toHaveBeenCalled();
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });
});
