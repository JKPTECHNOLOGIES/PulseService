import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  Contact,
  Customer,
  Location,
  PaginatedResponse,
} from "../types";
import toast from "../lib/toast";

/** Write payload for creating/updating a customer. `locations`/`contacts` use
 * a create shape (no customerId, id optional), so they're kept separate from
 * the read model. */
type CustomerWritePayload = Partial<Omit<Customer, "locations" | "contacts">> & {
  locations?: Partial<Location>[];
  contacts?: Partial<Contact>[];
};

interface CustomersParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  /** A-Z index filter: only customers whose first name starts with this letter. */
  letter?: string;
  sortKey?: string;
  sortDir?: string;
}

export function useCustomers(params: CustomersParams = {}) {
  return useQuery({
    queryKey: ["customers", params],
    queryFn: () =>
      api.get<PaginatedResponse<Customer>>("/customers", { params }),
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Customer>>(`/customers/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CustomerWritePayload) =>
      api.post<ApiResponse<Customer>>("/customers", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create customer"));
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: CustomerWritePayload & { id: string }) =>
      api.put<ApiResponse<Customer>>(`/customers/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["customer", vars.id] });
      toast.success("Customer updated successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update customer"));
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<null>>(`/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete customer"));
    },
  });
}
