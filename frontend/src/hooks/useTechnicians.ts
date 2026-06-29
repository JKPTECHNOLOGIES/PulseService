import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { Technician, PaginatedResponse } from '../types';

export function useTechnicians() {
  return useQuery({
    queryKey: ['technicians'],
    queryFn: async () => {
      const data = await api.get('/technicians', { params: { limit: 100 } });
      return data as unknown as PaginatedResponse<Technician>;
    },
  });
}

export function useTechnician(id: string) {
  return useQuery({
    queryKey: ['technician', id],
    queryFn: async () => {
      const data = await api.get(`/technicians/${id}`);
      return (data as any).data as Technician;
    },
    enabled: !!id,
  });
}
