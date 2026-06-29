import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Customer, PaginatedResponse } from "../types";
import toast from "react-hot-toast";

interface CustomersParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
}

export function useCustomers(params: CustomersParams = {}) {
  return useQuery({
    queryKey: ["customers", params],
    queryFn: async () => {
      const data = await api.get("/customers", { params });
      return data as unknown as PaginatedResponse<Customer>;
    },
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const data = await api.get(`/customers/${id}`);
      return (data as any).data as Customer;
    },
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Customer>) =>
      api.post("/customers", payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to create customer");
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Customer> & { id: string }) =>
      api.put(`/customers/${id}`, payload) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", vars.id] });
      toast.success("Customer updated successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update customer");
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer deleted");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to delete customer");
    },
  });
}
