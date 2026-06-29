import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Job, PaginatedResponse } from "../types";
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
    queryFn: async () => {
      const data = await api.get("/jobs", { params });
      return data as unknown as PaginatedResponse<Job>;
    },
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const data = await api.get(`/jobs/${id}`);
      return (data as any).data as Job;
    },
    enabled: !!id,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Job>) =>
      api.post("/jobs", payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job created successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to create job");
    },
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Job> & { id: string }) =>
      api.put(`/jobs/${id}`, payload) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job", vars.id] });
      toast.success("Job updated successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update job");
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
    }) => api.patch(`/jobs/${id}/status`, { status, notes }) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job", vars.id] });
      toast.success("Job status updated");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update status");
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
      api.post(`/jobs/${jobId}/technicians`, {
        technicianId,
        isLead,
      }) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success("Technician assigned");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to assign technician");
    },
  });
}
