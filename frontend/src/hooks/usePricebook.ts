import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { PricebookCategory, PricebookItem } from '../types';
import toast from 'react-hot-toast';

export function usePricebookCategories() {
  return useQuery({
    queryKey: ['pricebook', 'categories'],
    queryFn: async () => {
      const data = await api.get('/pricebook/categories');
      return (data as any).data as PricebookCategory[];
    },
  });
}

export function usePricebookItems(params: { categoryId?: string; search?: string } = {}) {
  return useQuery({
    queryKey: ['pricebook', 'items', params],
    queryFn: async () => {
      const data = await api.get('/pricebook/items', { params });
      return (data as any).data as PricebookItem[];
    },
  });
}

export function useCreatePricebookItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PricebookItem>) =>
      api.post('/pricebook/items', payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricebook'] });
      toast.success('Item created successfully');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to create item');
    },
  });
}

export function useUpdatePricebookItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<PricebookItem> & { id: string }) =>
      api.put(`/pricebook/items/${id}`, payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricebook'] });
      toast.success('Item updated successfully');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update item');
    },
  });
}

export function useCreatePricebookCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PricebookCategory>) =>
      api.post('/pricebook/categories', payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricebook', 'categories'] });
      toast.success('Category created');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to create category');
    },
  });
}
