import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import type { ApiResponse } from "../types";

export function useRevenueReport(params: { months?: number } = {}) {
  return useQuery({
    queryKey: ["reports", "revenue", params],
    queryFn: async () => {
      const res = await api.get<
        ApiResponse<
          {
            month: string;
            revenue: number;
            invoiceCount: number;
          }[]
        >
      >("/reports/revenue", { params });
      return res.data;
    },
  });
}

export function useJobsReport() {
  return useQuery({
    queryKey: ["reports", "jobs"],
    queryFn: async () => {
      const res = await api.get<
        ApiResponse<{
          total: number;
          completed: number;
          cancelled: number;
          byStatus: { status: string; count: number }[];
          byType: { type: string; count: number }[];
          avgDuration: number;
        }>
      >("/reports/jobs");
      return res.data;
    },
  });
}

export function useTechniciansReport() {
  return useQuery({
    queryKey: ["reports", "technicians"],
    queryFn: async () => {
      const res = await api.get<
        ApiResponse<
          {
            technicianId: string;
            name: string;
            jobsCompleted: number;
            revenue: number;
            avgJobsPerWeek: number;
          }[]
        >
      >("/reports/technicians");
      return res.data;
    },
  });
}

export function useCustomersReport() {
  return useQuery({
    queryKey: ["reports", "customers"],
    queryFn: async () => {
      const res = await api.get<
        ApiResponse<{
          total: number;
          newThisMonth: number;
          avgRevenue: number;
          topCustomers: {
            id: string;
            name: string;
            jobs: number;
            revenue: number;
          }[];
        }>
      >("/reports/customers");
      return res.data;
    },
  });
}
