/**
 * Unit Tests for createRequisitionApprovalGLEntries()
 *
 * Suite 2: Tests the shared function that creates GL entries when a
 * requisition is approved. Covers allocation-based entries, work order
 * config, budget header fallback, error propagation, and Prisma Decimal handling.
 *
 * @see src/services/purchasing/requisition/requisition-utils.ts
 */

import { createRequisitionApprovalGLEntries } from "../requisition-utils";
import {
  glRuleEngineService,
  glTransactionService,
  getCurrentBudgetPeriod,
} from "@/services/gl";
import { GLEventType, type GLEntry } from "@/types/gl-rules";
import type { ServiceContext } from "@/types/service-types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("@/services/gl", () => ({
  glRuleEngineService: {
    evaluateRules: jest.fn(),
  },
  glTransactionService: {
    createTransaction: jest.fn(),
    postTransaction: jest.fn(),
  },
  getCurrentBudgetPeriod: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Typed mock accessors
// ---------------------------------------------------------------------------

const mockEvaluateRules = glRuleEngineService.evaluateRules as jest.Mock;
const mockCreateTransaction =
  glTransactionService.createTransaction as jest.Mock;
const mockPostTransaction = glTransactionService.postTransaction as jest.Mock;
const mockGetCurrentBudgetPeriod = getCurrentBudgetPeriod as jest.Mock;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const GL_ACCOUNTS = {
  ENCUMB_EXP_5110: "cml1anz6y0003vsaw309ftgtb",
  ENCUMBRANCE_2120: "cml1anz6u0001vsawubwu5bai",
} as const;

const MOCK_BUDGET_PERIOD = {
  id: "bp-test-2026",
  name: "FY2026",
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-12-31"),
  isCurrent: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockContext: ServiceContext = {
  userId: "user-test-001",
  userName: "Test User",
  userRole: "admin",
  roleId: "role-test-001",
  userEmail: "test@example.com",
  permissions: [],
};

/** Standard two-entry encumbrance result from the rule engine */
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
        entryType: "DEBIT",
        glAccountId: GL_ACCOUNTS.ENCUMB_EXP_5110,
        amount,
        description: "Encumbrance Expense",
        accountCodeId: "acct-code-test-001",
      },
      {
        entryType: "CREDIT",
        glAccountId: GL_ACCOUNTS.ENCUMBRANCE_2120,
        amount,
        description: "Reserve for Encumbrance",
      },
    ],
  };
}

/** Empty result from the rule engine (no entries generated) */
function makeEmptyRuleResult(): {
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
    totalDebits: 0,
    totalCredits: 0,
    entries: [],
  };
}

/** Helper: build a mock db with configurable responses */
function createMockDb(overrides?: {
  allocations?: unknown[];
  budgetHeader?: unknown;
}) {
  return {
    budgetPeriod: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    requisitionLineAllocation: {
      findMany: jest.fn().mockResolvedValue(overrides?.allocations ?? []),
    },
    requisitionBudgetHeader: {
      findUnique: jest.fn().mockResolvedValue(overrides?.budgetHeader ?? null),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createRequisitionApprovalGLEntries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentBudgetPeriod.mockResolvedValue(MOCK_BUDGET_PERIOD);
    mockCreateTransaction.mockResolvedValue("gl-txn-id-mock");
    mockPostTransaction.mockResolvedValue(undefined);
  });

  // =========================================================================
  // 2.1 — Single line, single allocation
  // =========================================================================
  it("creates GL entries for requisition with single-line single-allocation", async () => {
    const allocation = {
      id: "alloc-001",
      requisitionLineId: "req-line-001",
      accountCodeId: "acct-code-test-001",
      departmentId: "dept-001",
      areaId: null,
      projectId: null,
      amount: 1500,
      accountCode: { id: "acct-code-test-001", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocation] });

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(1500));

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-test-001",
      requisitionNumber: "REQ-000100",
      lines: [
        {
          id: "req-line-001",
          description: "Test Widget",
          quantity: 10,
          estimatedPrice: 150,
          lineType: "INVENTORY",
        },
      ],
    });

    // Verify createTransaction was called with correct shape
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        transactionType: "ENCUMBRANCE",
        referenceType: "Requisition",
        referenceId: "req-test-001",
        referenceNumber: "REQ-000100",
        lines: expect.arrayContaining([
          expect.objectContaining({
            entryType: "DEBIT",
            glAccountId: GL_ACCOUNTS.ENCUMB_EXP_5110,
            amount: 1500,
          }) as unknown,
          expect.objectContaining({
            entryType: "CREDIT",
            glAccountId: GL_ACCOUNTS.ENCUMBRANCE_2120,
            amount: 1500,
          }) as unknown,
        ]) as unknown,
      }),
    );
    expect(mockPostTransaction).toHaveBeenCalledWith(
      mockContext,
      "gl-txn-id-mock",
    );

    expect(result).toEqual({
      glTransactionId: "gl-txn-id-mock",
      totalAmount: 1500,
      entryCount: 2,
      fiscalPeriodId: MOCK_BUDGET_PERIOD.id,
    });
  });

  // =========================================================================
  // 2.2 — Multiple lines and allocations
  // =========================================================================
  it("creates GL entries for requisition with multiple lines and allocations", async () => {
    const allocLine1a = {
      id: "alloc-l1a",
      requisitionLineId: "line-001",
      accountCodeId: "acct-001",
      departmentId: "dept-001",
      amount: 500,
      accountCode: { id: "acct-001", code: "5100" },
    };
    const allocLine1b = {
      id: "alloc-l1b",
      requisitionLineId: "line-001",
      accountCodeId: "acct-002",
      departmentId: "dept-002",
      amount: 500,
      accountCode: { id: "acct-002", code: "5200" },
    };
    const allocLine2 = {
      id: "alloc-l2",
      requisitionLineId: "line-002",
      accountCodeId: "acct-003",
      departmentId: "dept-001",
      amount: 300,
      accountCode: { id: "acct-003", code: "5300" },
    };

    const mockDb = createMockDb();
    // Line 1 returns two allocations, line 2 returns one
    mockDb.requisitionLineAllocation.findMany
      .mockResolvedValueOnce([allocLine1a, allocLine1b])
      .mockResolvedValueOnce([allocLine2]);

    // Three evaluateRules calls — one per allocation
    mockEvaluateRules
      .mockResolvedValueOnce(makeRuleResult(500))
      .mockResolvedValueOnce(makeRuleResult(500))
      .mockResolvedValueOnce(makeRuleResult(300));

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-002",
      requisitionNumber: "REQ-000200",
      lines: [
        {
          id: "line-001",
          description: "Widget A",
          quantity: 10,
          estimatedPrice: 100,
        },
        {
          id: "line-002",
          description: "Widget B",
          quantity: 3,
          estimatedPrice: 100,
        },
      ],
    });

    expect(mockEvaluateRules).toHaveBeenCalledTimes(3);
    // 3 allocations × 2 entries each = 6 lines
    expect(result.entryCount).toBe(6);
    // totalAmount = (10×100) + (3×100) = 1300
    expect(result.totalAmount).toBe(1300);
    expect(result.glTransactionId).toBe("gl-txn-id-mock");
  });

  // =========================================================================
  // 2.3 — Work order config
  // =========================================================================
  it("handles work order config when provided", async () => {
    const mockDb = createMockDb();

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(750));

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-wo-001",
      requisitionNumber: "REQ-WO-001",
      lines: [
        {
          id: "line-wo-001",
          description: "WO Part",
          quantity: 5,
          estimatedPrice: 150,
        },
      ],
      workOrderConfig: {
        accountCodeId: "wo-acct-001",
        departmentId: "wo-dept-001",
      },
    });

    // Allocation DB lookup should NOT have been called
    expect(mockDb.requisitionLineAllocation.findMany).not.toHaveBeenCalled();

    // evaluateRules called once with work order context
    expect(mockEvaluateRules).toHaveBeenCalledTimes(1);
    expect(mockEvaluateRules).toHaveBeenCalledWith(
      mockContext,
      GLEventType.REQ_APPROVE,
      expect.objectContaining({
        accountCodeId: "wo-acct-001",
        departmentId: "wo-dept-001",
        sourceType: "WORK_ORDER",
        amount: 750,
      }),
    );

    expect(result.glTransactionId).toBe("gl-txn-id-mock");
    expect(result.totalAmount).toBe(750);
  });

  // =========================================================================
  // 2.4 — fallbackToBudgetHeader: true
  // =========================================================================
  it("uses fallbackToBudgetHeader: true to find account code", async () => {
    const mockDb = createMockDb({
      allocations: [], // no allocations
      budgetHeader: {
        id: "bh-001",
        requisitionId: "req-fb-001",
        accountCodeId: "bh-acct-001",
      },
    });

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(400));

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-fb-001",
      requisitionNumber: "REQ-FB-001",
      lines: [
        {
          id: "line-fb-001",
          description: "Fallback Item",
          quantity: 4,
          estimatedPrice: 100,
          lineType: "SERVICE",
        },
      ],
      fallbackToBudgetHeader: true,
    });

    // Budget header lookup should have been called
    expect(mockDb.requisitionBudgetHeader.findUnique).toHaveBeenCalledWith({
      where: { requisitionId: "req-fb-001" },
    });

    // evaluateRules should have been called with budget header accountCodeId
    expect(mockEvaluateRules).toHaveBeenCalledWith(
      mockContext,
      GLEventType.REQ_APPROVE,
      expect.objectContaining({
        accountCodeId: "bh-acct-001",
        amount: 400,
      }),
    );

    expect(result.glTransactionId).toBe("gl-txn-id-mock");
    expect(result.entryCount).toBe(2);
  });

  // =========================================================================
  // 2.5 — fallbackToBudgetHeader: false throws when no allocations
  // =========================================================================
  it("uses fallbackToBudgetHeader: false and throws when no allocations", async () => {
    const mockDb = createMockDb({ allocations: [] });

    await expect(
      createRequisitionApprovalGLEntries({
        context: mockContext,
        db: mockDb,
        requisitionId: "req-no-alloc",
        requisitionNumber: "REQ-NONE",
        lines: [
          {
            id: "line-no-alloc",
            description: "No Alloc",
            quantity: 1,
            estimatedPrice: 50,
            lineType: "SERVICE",
          },
        ],
        fallbackToBudgetHeader: false,
      }),
    ).rejects.toThrow("has no budget allocations");
  });

  // =========================================================================
  // 2.6 — Returns null when no GL entries generated
  // =========================================================================
  it("returns null glTransactionId when no GL entries are generated", async () => {
    const allocation = {
      id: "alloc-empty",
      requisitionLineId: "line-empty",
      accountCodeId: "acct-empty",
      amount: 200,
      accountCode: { id: "acct-empty", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocation] });

    // Rule engine returns empty entries
    mockEvaluateRules.mockResolvedValueOnce(makeEmptyRuleResult());

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-empty",
      requisitionNumber: "REQ-EMPTY",
      lines: [
        {
          id: "line-empty",
          description: "Empty Result",
          quantity: 2,
          estimatedPrice: 100,
        },
      ],
    });

    expect(result).toEqual({
      glTransactionId: null,
      totalAmount: 200,
      entryCount: 0,
      fiscalPeriodId: MOCK_BUDGET_PERIOD.id,
    });
    // createTransaction should NOT have been called
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 2.7 — getCurrentBudgetPeriod called with the provided db
  // =========================================================================
  it("calls getCurrentBudgetPeriod with the provided db client", async () => {
    const allocation = {
      id: "alloc-db",
      requisitionLineId: "line-db",
      accountCodeId: "acct-db",
      amount: 100,
      accountCode: { id: "acct-db", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocation] });

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(100));

    await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-db",
      requisitionNumber: "REQ-DB",
      lines: [
        {
          id: "line-db",
          description: "DB Test",
          quantity: 1,
          estimatedPrice: 100,
        },
      ],
    });

    expect(mockGetCurrentBudgetPeriod).toHaveBeenCalledWith(mockDb);
  });

  // =========================================================================
  // 2.8 — createTransaction then postTransaction call order
  // =========================================================================
  it("calls glTransactionService.createTransaction then postTransaction", async () => {
    const allocation = {
      id: "alloc-order",
      requisitionLineId: "line-order",
      accountCodeId: "acct-order",
      amount: 600,
      accountCode: { id: "acct-order", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocation] });

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(600));

    const callOrder: string[] = [];
    mockCreateTransaction.mockImplementation(() => {
      callOrder.push("createTransaction");
      return Promise.resolve("gl-txn-order");
    });
    mockPostTransaction.mockImplementation(() => {
      callOrder.push("postTransaction");
      return Promise.resolve(undefined);
    });

    await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-order",
      requisitionNumber: "REQ-ORDER",
      lines: [
        {
          id: "line-order",
          description: "Order Test",
          quantity: 6,
          estimatedPrice: 100,
        },
      ],
    });

    expect(callOrder).toEqual(["createTransaction", "postTransaction"]);
    expect(mockPostTransaction).toHaveBeenCalledWith(
      mockContext,
      "gl-txn-order",
    );
  });

  // =========================================================================
  // 2.9 — Error propagation from rule engine
  // =========================================================================
  it("propagates errors from rule engine", async () => {
    const allocation = {
      id: "alloc-err",
      requisitionLineId: "line-err",
      accountCodeId: "acct-err",
      amount: 100,
      accountCode: { id: "acct-err", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocation] });

    mockEvaluateRules.mockRejectedValueOnce(new Error("Rule engine exploded"));

    await expect(
      createRequisitionApprovalGLEntries({
        context: mockContext,
        db: mockDb,
        requisitionId: "req-err",
        requisitionNumber: "REQ-ERR",
        lines: [
          {
            id: "line-err",
            description: "Error Test",
            quantity: 1,
            estimatedPrice: 100,
          },
        ],
      }),
    ).rejects.toThrow("Rule engine exploded");
  });

  // =========================================================================
  // 2.10 — Returns early with null when no fiscal period found
  // =========================================================================
  it("returns null when no fiscal period found", async () => {
    mockGetCurrentBudgetPeriod.mockRejectedValueOnce(
      new Error("No active budget period found"),
    );

    const mockDb = createMockDb();

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-no-period",
      requisitionNumber: "REQ-NOPERIOD",
      lines: [
        {
          id: "line-np",
          description: "No Period",
          quantity: 1,
          estimatedPrice: 50,
        },
      ],
    });

    expect(result).toEqual({
      glTransactionId: null,
      totalAmount: 0,
      entryCount: 0,
      fiscalPeriodId: null,
    });
    // Should not proceed to evaluate rules
    expect(mockEvaluateRules).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 2.11 — Calculates totalAmount from quantity × estimatedPrice
  // =========================================================================
  it("calculates totalAmount from quantity × estimatedPrice across lines", async () => {
    const alloc1 = {
      id: "alloc-c1",
      requisitionLineId: "line-c1",
      accountCodeId: "acct-c1",
      amount: 300,
      accountCode: { id: "acct-c1", code: "5100" },
    };
    const alloc2 = {
      id: "alloc-c2",
      requisitionLineId: "line-c2",
      accountCodeId: "acct-c2",
      amount: 800,
      accountCode: { id: "acct-c2", code: "5200" },
    };

    const mockDb = createMockDb();
    mockDb.requisitionLineAllocation.findMany
      .mockResolvedValueOnce([alloc1])
      .mockResolvedValueOnce([alloc2]);

    mockEvaluateRules
      .mockResolvedValueOnce(makeRuleResult(300))
      .mockResolvedValueOnce(makeRuleResult(800));

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-calc",
      requisitionNumber: "REQ-CALC",
      lines: [
        {
          id: "line-c1",
          description: "Item A",
          quantity: 3,
          estimatedPrice: 100,
        },
        {
          id: "line-c2",
          description: "Item B",
          quantity: 8,
          estimatedPrice: 100,
        },
      ],
    });

    // totalAmount = (3 × 100) + (8 × 100) = 1100
    expect(result.totalAmount).toBe(1100);
  });

  // =========================================================================
  // 2.12 — Handles Prisma Decimal values for quantity / estimatedPrice
  // =========================================================================
  it("handles Prisma Decimal values for quantity and estimatedPrice", async () => {
    const allocation = {
      id: "alloc-dec",
      requisitionLineId: "line-dec",
      accountCodeId: "acct-dec",
      amount: 750,
      accountCode: { id: "acct-dec", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocation] });

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(750));

    // Simulate Prisma Decimal objects
    const decimalQuantity = { toNumber: () => 5 };
    const decimalPrice = { toNumber: () => 150 };

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-dec",
      requisitionNumber: "REQ-DEC",
      lines: [
        {
          id: "line-dec",
          description: "Decimal Test",
          quantity: decimalQuantity,
          estimatedPrice: decimalPrice,
        },
      ],
    });

    // 5 × 150 = 750
    expect(result.totalAmount).toBe(750);
    expect(result.glTransactionId).toBe("gl-txn-id-mock");
  });

  // =========================================================================
  // 2.13 — Skips allocations without accountCodeId
  // =========================================================================
  it("skips allocations without accountCodeId", async () => {
    const allocNoAcct = {
      id: "alloc-no-acct",
      requisitionLineId: "line-skip",
      accountCodeId: null, // no account code
      amount: 200,
      accountCode: null,
    };
    const allocWithAcct = {
      id: "alloc-with-acct",
      requisitionLineId: "line-skip",
      accountCodeId: "acct-valid",
      amount: 300,
      accountCode: { id: "acct-valid", code: "5100" },
    };
    const mockDb = createMockDb({ allocations: [allocNoAcct, allocWithAcct] });

    mockEvaluateRules.mockResolvedValueOnce(makeRuleResult(300));

    const result = await createRequisitionApprovalGLEntries({
      context: mockContext,
      db: mockDb,
      requisitionId: "req-skip",
      requisitionNumber: "REQ-SKIP",
      lines: [
        {
          id: "line-skip",
          description: "Skip Test",
          quantity: 5,
          estimatedPrice: 100,
        },
      ],
    });

    // Only one evaluateRules call — the one without accountCodeId is skipped
    expect(mockEvaluateRules).toHaveBeenCalledTimes(1);
    expect(result.entryCount).toBe(2);
  });
});
