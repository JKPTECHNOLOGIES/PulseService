import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import type { ApiResponse, InventoryReport } from "../types";

export function useInventoryReport() {
  return useQuery({
    queryKey: ["reports", "inventory"],
    queryFn: async () => {
      const res =
        await api.get<ApiResponse<InventoryReport>>("/reports/inventory");
      return res.data;
    },
  });
}

export type RevenueSource = "invoiced" | "collected" | "agreements";

export interface RevenuePeriod {
  period: string;
  label: string;
  invoiced?: number;
  collected?: number;
  agreements?: number;
  total: number;
}

export interface RevenueReport {
  data: RevenuePeriod[];
  meta: {
    from: string;
    to: string;
    granularity: "day" | "week" | "month";
    sources: RevenueSource[];
  };
}

export function useRevenueReport(
  params: {
    from?: string;
    to?: string;
    granularity?: "day" | "week" | "month";
    sources?: string;
  } = {},
) {
  return useQuery({
    queryKey: ["reports", "revenue", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RevenuePeriod[]> & RevenueReport>(
        "/reports/revenue",
        { params },
      );
      return { data: res.data, meta: res.meta };
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
          }[]
        >
      >("/reports/technicians");
      return res.data;
    },
  });
}

export interface ArAgingBucket {
  key: string;
  label: string;
  count: number;
  amount: number;
}
export interface ArAgingInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  dueDate: string | null;
  balance: number;
  daysOverdue: number;
  bucket: string;
}
export interface ArAgingReport {
  totalOutstanding: number;
  buckets: ArAgingBucket[];
  invoices: ArAgingInvoice[];
}

export function useArAgingReport() {
  return useQuery({
    queryKey: ["reports", "ar-aging"],
    queryFn: async () => {
      const res =
        await api.get<ApiResponse<ArAgingReport>>("/reports/ar-aging");
      return res.data;
    },
  });
}

export interface SalesBySource {
  totalInvoiced: number;
  totalCollected: number;
  sources: {
    source: string;
    invoiceCount: number;
    invoiced: number;
    collected: number;
  }[];
}

export function useSalesBySourceReport(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["reports", "sales-by-source", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<SalesBySource>>(
        "/reports/sales-by-source",
        { params },
      );
      return res.data;
    },
  });
}

export interface EstimatePipeline {
  byStatus: { status: string; count: number; value: number }[];
  winRate: number;
  approvedValue: number;
  approvedCount: number;
  openValue: number;
}

export function useEstimatePipelineReport() {
  return useQuery({
    queryKey: ["reports", "estimate-pipeline"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<EstimatePipeline>>(
        "/reports/estimate-pipeline",
      );
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
