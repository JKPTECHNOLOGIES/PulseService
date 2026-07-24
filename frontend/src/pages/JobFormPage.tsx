import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { onlineManager } from "@tanstack/react-query";
import { useJob, useCreateJob, useUpdateJob, useJobTypes } from "../hooks/useJobs";
import toast from "../lib/toast";
import { useCustomers } from "../hooks/useCustomers";
import { useTechnicians } from "../hooks/useTechnicians";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import CustomerCombobox from "../components/ui/CustomerCombobox";
import { PageSpinner } from "../components/ui/Spinner";
import { LookupSelect } from "../components/ui/LookupSelect";
import { useFormDraft } from "../hooks/useFormDraft";

// Enum values are validated server-side against the DB-driven lookups; the form
// only requires that a value is present so we never duplicate the enum here.
const schema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  type: z.string().min(1),
  priority: z.string().min(1),
  status: z.string().min(1),
  source: z.string().optional(),
  summary: z.string().min(1, "Summary is required"),
  description: z.string().optional(),
  scheduledStart: z.string().optional(),
  scheduledEnd: z.string().optional(),
  notes: z.string().optional(),
  technicianIds: z.array(z.string()).optional(),
});

type FormData = z.infer<typeof schema>;

// See EstimateFormPage: autosave a New Job draft so navigating away or a reload
// doesn't lose it. Cleared once the job is created.
const DRAFT_KEY = "draft:job:new";
const DEFAULT_VALUES: Partial<FormData> = {
  type: "service",
  priority: "normal",
  status: "new",
  technicianIds: [],
};

export default function JobFormPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditing = !!id;

  const { data: job, isLoading: jobLoading } = useJob(id ?? "");
  const { data: customersData } = useCustomers({ limit: 200 });
  const { data: techsData } = useTechnicians();
  const { data: jobTypeOptions } = useJobTypes();
  const createMutation = useCreateJob();
  const updateMutation = useUpdateJob();

  const customers = customersData?.data ?? [];
  const techs = techsData?.data ?? [];

  const prefillCustomerId =
    (location.state as { customerId?: string } | null)?.customerId ?? "";

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { ...DEFAULT_VALUES, customerId: prefillCustomerId },
  });

  const customerId = watch("customerId");

  useEffect(() => {
    if (job && isEditing) {
      reset({
        customerId: job.customerId,
        type: job.type,
        priority: job.priority,
        status: job.status,
        source: job.source ?? "",
        summary: job.summary,
        description: job.description ?? "",
        scheduledStart: job.scheduledStart
          ? job.scheduledStart.slice(0, 16)
          : "",
        scheduledEnd: job.scheduledEnd ? job.scheduledEnd.slice(0, 16) : "",
        notes: job.notes ?? "",
        technicianIds: job.technicians?.map((jt) => jt.technicianId) ?? [],
      });
    }
  }, [job, isEditing, reset]);

  const { restored: draftRestored, clearDraft } = useFormDraft<FormData>({
    key: DRAFT_KEY,
    enabled: !isEditing,
    value: watch(),
    hasContent: (v) =>
      Boolean(v.customerId) || Boolean(v.summary) || Boolean(v.description),
    onRestore: (v) => {
      reset({ ...DEFAULT_VALUES, ...v });
    },
  });

  const discardDraft = () => {
    reset({ ...DEFAULT_VALUES, customerId: prefillCustomerId });
    clearDraft();
  };

  const technicianIds = watch("technicianIds") ?? [];

  const toggleTech = (techId: string) => {
    const current = watch("technicianIds") ?? [];
    if (current.includes(techId)) {
      setValue(
        "technicianIds",
        current.filter((id) => id !== techId),
      );
    } else {
      setValue("technicianIds", [...current, techId]);
    }
  };

  const onSubmit = async (data: FormData) => {
    // `datetime-local` inputs yield "YYYY-MM-DDTHH:mm" (no seconds/timezone),
    // which Prisma rejects. Convert to a full ISO-8601 instant here so the
    // user's local time is stored as the correct UTC moment; leave blanks unset.
    const payload = {
      ...data,
      scheduledStart: data.scheduledStart
        ? new Date(data.scheduledStart).toISOString()
        : undefined,
      scheduledEnd: data.scheduledEnd
        ? new Date(data.scheduledEnd).toISOString()
        : undefined,
    };

    if (isEditing) {
      const vars = {
        id,
        ...payload,
        expectedUpdatedAt: job?.updatedAt,
      };
      if (onlineManager.isOnline()) {
        await updateMutation.mutateAsync(vars);
        navigate(`/jobs/${id}`);
      } else {
        // Offline: this queues (see lib/offlineMutations.ts) and won't
        // settle until reconnect, so don't block navigation waiting on it --
        // the job's cache entry already reflects the edit optimistically
        // (see useUpdateJob's onMutate).
        updateMutation.mutate(vars);
        navigate(`/jobs/${id}`);
      }
    } else if (onlineManager.isOnline()) {
      const result = (await createMutation.mutateAsync(payload)) as {
        data?: { id?: string };
        id?: string;
      };
      clearDraft();
      const newId = result.data?.id ?? result.id;
      navigate(newId ? `/jobs/${newId}` : "/jobs");
    } else {
      // Offline: this queues (see lib/offlineMutations.ts) and won't settle
      // until reconnect, so there's no new job id to navigate to yet -- it
      // simply won't appear in job lists/dispatch until the create syncs.
      createMutation.mutate(payload);
      clearDraft();
      toast.success("Job saved \u2014 will be created when back online");
      navigate("/jobs");
    }
  };

  if (isEditing && jobLoading) return <PageSpinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {draftRestored && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm">
          <span className="text-primary-800">Restored your unsaved draft.</span>
          <button
            type="button"
            onClick={discardDraft}
            className="shrink-0 font-medium text-primary-700 underline underline-offset-2"
          >
            Start fresh
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="space-y-5"
      >
        <Card title="Work Order Details">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Customer <span className="text-red-500">*</span>
              </label>
              <CustomerCombobox
                customers={customers}
                value={customerId}
                onChange={(newId) => {
                  setValue("customerId", newId, {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                }}
                error={errors.customerId?.message}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Work Order Type
                </label>
                <input
                  type="text"
                  list="job-type-options"
                  placeholder="e.g. Service, Installation, Warranty Callback…"
                  {...register("type")}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                />
                {/* Free text — type a new service type and it's saved as-is.
                    The datalist just offers existing ones (built-in +
                    anything typed on other jobs) as quick picks. */}
                <datalist id="job-type-options">
                  {(jobTypeOptions ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Priority
                </label>
                <LookupSelect
                  category="jobPriority"
                  {...register("priority")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Status
                </label>
                <LookupSelect
                  category="jobStatus"
                  // A brand-new work order can only start as New or
                  // Scheduled, so keep the picker narrow when creating one.
                  // Editing an existing job needs every status available --
                  // restricting it here too used to silently force an
                  // in-progress/completed/etc. job back to New on save,
                  // since the field's real value wasn't even a valid option.
                  only={isEditing ? undefined : ["new", "scheduled"]}
                  {...register("status")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Source
                </label>
                <LookupSelect
                  category="leadSource"
                  placeholder="Select source..."
                  {...register("source")}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Summary <span className="text-red-500">*</span>
              </label>
              <input
                {...register("summary")}
                type="text"
                placeholder="Brief description of the job..."
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {errors.summary && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.summary.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Description
              </label>
              <textarea
                {...register("description")}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Detailed description..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Scheduled Start
                </label>
                <input
                  {...register("scheduledStart")}
                  type="datetime-local"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Scheduled End
                </label>
                <input
                  {...register("scheduledEnd")}
                  type="datetime-local"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Office Notes
              </label>
              <textarea
                {...register("notes")}
                rows={2}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Internal notes..."
              />
            </div>
          </div>
        </Card>

        {/* Technicians */}
        <Card title="Assign Technicians">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {techs.length === 0 ? (
              <p className="text-sm text-gray-400 col-span-2">
                No technicians available
              </p>
            ) : (
              techs.map((tech) => (
                <label
                  key={tech.id}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={technicianIds.includes(tech.id)}
                    onChange={() => {
                      toggleTech(tech.id);
                    }}
                    className="text-primary-600 focus:ring-primary-500 rounded"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {tech.user.firstName} {tech.user.lastName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {tech.isAvailable ? "Available" : "Busy"}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              navigate(-1);
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={
              isSubmitting ||
              createMutation.isPending ||
              updateMutation.isPending
            }
          >
            {isEditing ? "Save Changes" : "Create Work Order"}
          </Button>
        </div>
      </form>
    </div>
  );
}
