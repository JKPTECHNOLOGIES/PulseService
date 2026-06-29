import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Job, PaginatedResponse } from "../types";
import toast from "react-hot-toast";

interface JobsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  type?: string;
  date?: string;
}

export function useJobs(params: JobsParams = {}) {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => api.get<PaginatedResponse<Job>>("/jobs", { params }),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Job>>(`/jobs/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Job>) =>
      api.post<ApiResponse<Job>>("/jobs", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create job"));
    },
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Job> & { id: string }) =>
      api.put<ApiResponse<Job>>(`/jobs/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.id] });
      toast.success("Job updated successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update job"));
    },
  });
}

export function useUpdateJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      notes,
    }: {
      id: string;
      status: string;
      notes?: string;
    }) => api.patch<ApiResponse<Job>>(`/jobs/${id}/status`, { status, notes }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.id] });
      toast.success("Job status updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update status"));
    },
  });
}

export function useAssignTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      technicianId,
      isLead,
    }: {
      jobId: string;
      technicianId: string;
      isLead?: boolean;
    }) =>
      api.post<ApiResponse<Job>>(`/jobs/${jobId}/technicians`, {
        technicianId,
        isLead,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success("Technician assigned");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to assign technician"));
    },
  });
}
