import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Technician, Job } from "../types";
import toast from "react-hot-toast";

interface DispatchBoard {
  technicians: (Technician & { jobs: Job[] })[];
  unassigned: Job[];
}

export function useDispatchBoard(date: string) {
  return useQuery({
    queryKey: ["dispatch", date],
    queryFn: async () => {
      const res = await api.get<ApiResponse<DispatchBoard>>("/dispatch/board", {
        params: { date },
      });
      return res.data;
    },
    enabled: !!date,
  });
}

export function useReassignJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      technicianId,
    }: {
      jobId: string;
      technicianId: string;
      date: string;
    }) =>
      api.post<ApiResponse<Job>>(`/jobs/${jobId}/technicians`, {
        technicianId,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch", vars.date] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
      toast.success("Job reassigned");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reassign job"));
    },
  });
}
