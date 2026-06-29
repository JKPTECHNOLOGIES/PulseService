import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { InventoryItem, InventoryTransaction } from '../types';
import toast from 'react-hot-toast';

export function useInventoryItems() {
  return useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: async () => {
      const data = await api.get('/inventory/items');
      return (data as any).data as InventoryItem[];
    },
  });
}

export function useInventoryItem(id: string) {
  return useQuery({
    queryKey: ['inventory', 'item', id],
    queryFn: async () => {
      const data = await api.get(`/inventory/items/${id}`);
      return (data as any).data as InventoryItem;
    },
    enabled: !!id,
  });
}

export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      quantity,
      type,
      notes,
    }: {
      itemId: string;
      quantity: number;
      type: 'add' | 'remove' | 'adjust';
      notes?: string;
    }) => api.post(`/inventory/items/${itemId}/adjust`, { quantity, type, notes }) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Inventory adjusted successfully');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to adjust inventory');
    },
  });
}

export function useInventoryTransactions(itemId: string) {
  return useQuery({
    queryKey: ['inventory', 'transactions', itemId],
    queryFn: async () => {
      const data = await api.get(`/inventory/items/${itemId}/transactions`);
      return (data as any).data as InventoryTransaction[];
    },
    enabled: !!itemId,
  });
}
