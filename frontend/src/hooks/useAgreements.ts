import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  ServiceAgreement,
  AgreementVisit,
  PaginatedResponse,
} from "../types";
import toast from "react-hot-toast";

interface AgreementsParams {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
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
