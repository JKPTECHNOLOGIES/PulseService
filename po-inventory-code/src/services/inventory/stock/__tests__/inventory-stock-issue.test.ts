/**
 * Unit tests for inventory-stock.service.ts → issue()
 *
 * Focus: the skipReservedDecrement flag (GAP 2 fix).
 *
 * Before the fix, issuing from a PLANNED part (no reservation) called issue()
 * which decremented BOTH quantityOnHand AND quantityReserved, then a separate
 * non-atomic call re-incremented quantityReserved.  That was a race condition.
 *
 * After the fix, passing skipReservedDecrement: true makes issue() decrement
 * ONLY quantityOnHand — a single atomic operation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IssueOptions } from '../inventory-stock.types';
import type { ServiceContext } from '@/types/service-types';
// BadRequestError not used in assertions — service returns result objects, not throws

// ── Mock prisma ──────────────────────────────────────────────────────────────
const mockStockUpdate   = vi.fn();
const mockStockFindUniq = vi.fn();
const mockItemFindUniq  = vi.fn();
const mockResFind       = vi.fn();
const mockTx = {
  inventoryStock:       { findUnique: mockStockFindUniq, update: mockStockUpdate },
  inventoryItem:        { findUnique: mockItemFindUniq },
  inventoryReservation: { findUnique: mockResFind, update: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn().mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    inventoryItem: { findUnique: mockItemFindUniq },
  },
}));

// Reset mocks and set up defaults before each test
beforeEach(() => {
  vi.clearAllMocks();

  // Default item — has a unit cost
  mockItemFindUniq.mockResolvedValue({ unitCost: 25.00 });

  // Default stock record — 10 on hand, 3 reserved
  mockStockFindUniq.mockResolvedValue({
    quantityOnHand:   10,
    quantityReserved: 3,
  });

  mockStockUpdate.mockResolvedValue({});
  mockResFind.mockResolvedValue(null); // no reservation by default
});

// Import AFTER mocks
const { inventoryStockService } = await import('../inventory-stock.service');

// IssueOptions requires a full ServiceContext — supply the minimum fields needed by the
// service under test (userId + userName); other fields are not read in these code paths.
const TEST_CONTEXT: ServiceContext = {
  userId: 'user-1',
  userName: 'Test User',
  userEmail: '',
  userRole: 'test',
  roleId: '',
  permissions: [],
};

const BASE_OPTIONS: IssueOptions = {
  context: TEST_CONTEXT,
  storeId: 'store-abc',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('inventoryStockService.issue()', () => {

  describe('skipReservedDecrement flag (GAP 2 fix)', () => {
    it('decrements BOTH quantityOnHand and quantityReserved when flag is not set', async () => {
      await inventoryStockService.issue('item-1', 2, {
        ...BASE_OPTIONS,
        skipReservedCheck: true, // PLANNED part — no reservation ID
      });

      expect(mockStockUpdate).toHaveBeenCalledOnce();
      const firstCall = mockStockUpdate.mock.calls[0] as [{ data: Record<string, unknown> }];
      const updateData = firstCall[0].data;
      expect(updateData.quantityOnHand).toEqual({ decrement: 2 });
      expect(updateData.quantityReserved).toEqual({ decrement: 2 });
    });

    it('decrements ONLY quantityOnHand when skipReservedDecrement is true', async () => {
      await inventoryStockService.issue('item-1', 2, {
        ...BASE_OPTIONS,
        skipReservedCheck:    true,
        skipReservedDecrement: true, // GAP 2 fix
      });

      expect(mockStockUpdate).toHaveBeenCalledOnce();
      const firstCall = mockStockUpdate.mock.calls[0] as [{ data: Record<string, unknown> }];
      const updateData = firstCall[0].data;
      expect(updateData.quantityOnHand).toEqual({ decrement: 2 });
      // quantityReserved must NOT be present in the update when skipReservedDecrement is true
      expect(updateData.quantityReserved).toBeUndefined();
    });

    it('does not affect the onHand decrement size regardless of flag', async () => {
      const QTY = 5;

      await inventoryStockService.issue('item-1', QTY, {
        ...BASE_OPTIONS,
        skipReservedCheck:    true,
        skipReservedDecrement: true,
      });

      const firstCall = mockStockUpdate.mock.calls[0] as [{ data: Record<string, unknown> }];
      const updateData = firstCall[0].data;
      expect(updateData.quantityOnHand).toEqual({ decrement: QTY });
    });
  });

  // The stock service returns a result object { success, error } rather than throwing,
  // matching the StockOperationResult return type.  These tests verify the result shape.
  describe('stock validation — returns failure result (does not throw)', () => {
    it('returns success=false when quantity is zero', async () => {
      const result = await inventoryStockService.issue('item-1', 0, BASE_OPTIONS);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/quantity/i);
    });

    it('returns success=false when storeId is missing', async () => {
      const result = await inventoryStockService.issue('item-1', 1, {
        context: BASE_OPTIONS.context,
        storeId: '',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/store/i);
    });

    it('returns success=false when on-hand stock is insufficient', async () => {
      mockStockFindUniq.mockResolvedValue({
        quantityOnHand:   2,
        quantityReserved: 0,
      });

      const result = await inventoryStockService.issue('item-1', 5, {
        ...BASE_OPTIONS,
        skipReservedCheck: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/insufficient/i);
    });

    it('returns success=false when no stock record exists for the bin', async () => {
      mockStockFindUniq.mockResolvedValue(null);
      const result = await inventoryStockService.issue('item-1', 1, BASE_OPTIONS);
      expect(result.success).toBe(false);
    });
  });
});
