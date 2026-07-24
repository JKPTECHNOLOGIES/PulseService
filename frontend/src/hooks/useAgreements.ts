import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  ServiceAgreement,
  AgreementVisit,
  PaginatedResponse,
} from "../types";
import toast from "../lib/toast";

interface AgreementsParams {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
  sortKey?: string;
  sortDir?: string;
}

export function useAgreements(params: AgreementsParams = {}) {
  return useQuery({
    queryKey: ["agreements", params],
    queryFn: () =>
      api.get<PaginatedResponse<ServiceAgreement>>("/agreements", { params }),
  });
}

export function useAgreement(id: string) {
  return useQuery({
    queryKey: ["agreement", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<ServiceAgreement>>(
        `/agreements/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ServiceAgreement>) =>
      api.post<ApiResponse<ServiceAgreement>>("/agreements", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      toast.success("Agreement created");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create agreement"));
    },
  });
}

export function useUpdateAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<ServiceAgreement> & { id: string }) =>
      api.put<ApiResponse<ServiceAgreement>>(`/agreements/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void qc.invalidateQueries({ queryKey: ["agreement", vars.id] });
      toast.success("Agreement updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update agreement"));
    },
  });
}

interface SendResult {
  success: boolean;
  data: ServiceAgreement;
  emailPreviewUrl?: string | null;
  emailWarning?: string | null;
}

export function useSendAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SendResult>(`/agreements/${id}/send`),
    onSuccess: (res, id) => {
      void qc.invalidateQueries({ queryKey: ["agreement", id] });
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      if (res.emailWarning) {
        toast(res.emailWarning, { icon: "\u26A0\uFE0F", duration: 6000 });
      } else {
        toast.success("Agreement emailed to customer");
      }
      // In demo mode (no real SMTP) the backend returns an Ethereal preview URL
      // so you can see the email that would have been delivered.
      if (res.emailPreviewUrl) {
        window.open(res.emailPreviewUrl, "_blank", "noopener");
      }
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to send agreement"));
    },
  });
}

export function useScheduleVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agreementId,
      ...payload
    }: {
      agreementId: string;
      name: string;
      scheduledDate?: string;
    }) =>
      api.post<ApiResponse<AgreementVisit>>(
        `/agreements/${agreementId}/visits`,
        payload,
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["agreement", vars.agreementId] });
      toast.success("Visit scheduled");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to schedule visit"));
    },
  });
}

export function useCompleteVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agreementId,
      visitId,
      notes,
    }: {
      agreementId: string;
      visitId: string;
      notes?: string;
    }) =>
      api.put<ApiResponse<AgreementVisit>>(
        `/agreements/${agreementId}/visits/${visitId}/complete`,
        { notes },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["agreement", vars.agreementId] });
      toast.success("Visit marked complete");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to complete visit"));
    },
  });
}

// Billing (the monetary side of an agreement -- separate from RecurringJob,
// which generates the labor side / work orders).
export function useGenerateAgreementInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agreementId: string) =>
      api.post<ApiResponse<unknown>>(
        `/agreements/${agreementId}/generate-invoice`,
      ),
    onSuccess: (_data, agreementId) => {
      void qc.invalidateQueries({ queryKey: ["agreement", agreementId] });
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice generated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to generate invoice"));
    },
  });
}

export function useRunDueAgreementBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ApiResponse<{ created: number }>>(
        "/agreements/run-due-billing",
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(`Generated ${String(res.data.created)} invoice(s)`);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to run due billing"));
    },
  });
}
