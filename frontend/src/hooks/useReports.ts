import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";

export function useRevenueReport(params: { months?: number } = {}) {
  return useQuery({
    queryKey: ["reports", "revenue", params],
    queryFn: async () => {
      const data = await api.get("/reports/revenue", { params });
      return (data as any).data as {
        month: string;
        revenue: number;
        invoiceCount: number;
      }[];
    },
  });
}

export function useJobsReport() {
  return useQuery({
    queryKey: ["reports", "jobs"],
    queryFn: async () => {
      const data = await api.get("/reports/jobs");
      return (data as any).data as {
        total: number;
        completed: number;
        cancelled: number;
        byStatus: { status: string; count: number }[];
        byType: { type: string; count: number }[];
        avgDuration: number;
      };
    },
  });
}

export function useTechniciansReport() {
  return useQuery({
    queryKey: ["reports", "technicians"],
    queryFn: async () => {
      const data = await api.get("/reports/technicians");
      return (data as any).data as {
        technicianId: string;
        name: string;
        jobsCompleted: number;
        revenue: number;
        avgJobsPerWeek: number;
      }[];
    },
  });
}

export function useCustomersReport() {
  return useQuery({
    queryKey: ["reports", "customers"],
    queryFn: async () => {
      const data = await api.get("/reports/customers");
      return (data as any).data as {
        total: number;
        newThisMonth: number;
        avgRevenue: number;
        topCustomers: {
          id: string;
          name: string;
          jobs: number;
          revenue: number;
        }[];
      };
    },
  });
}
