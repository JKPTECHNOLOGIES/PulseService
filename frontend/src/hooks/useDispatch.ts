import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Technician, Job } from "../types";
import toast from "react-hot-toast";

interface DispatchBoard {
  technicians: (Technician & { jobs: Job[] })[];
  unassigned: Job[];
}

export function useDispatchBoard(date: string) {
  return useQuery({
    queryKey: ["dispatch", date],
    queryFn: async () => {
      const data = await api.get("/dispatch/board", { params: { date } });
      return (data as any).data as DispatchBoard;
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
      api.post(`/jobs/${jobId}/technicians`, { technicianId }) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["dispatch", vars.date] });
      qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
      toast.success("Job reassigned");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to reassign job");
    },
  });
}
