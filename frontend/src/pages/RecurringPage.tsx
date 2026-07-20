import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import {
  PlusIcon,
  ArrowPathIcon,
  BoltIcon,
  TrashIcon,
  PauseCircleIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import {
  useRecurringJobs,
  useCreateRecurringJob,
  useUpdateRecurringJob,
  useDeleteRecurringJob,
  useGenerateRecurringJob,
  useRunDueRecurringJobs,
  RECURRING_FREQUENCIES,
  recurringFreqLabel,
  type RecurringJob,
} from "../hooks/useRecurring";
import { useCustomers } from "../hooks/useCustomers";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { LookupSelect } from "../components/ui/LookupSelect";
import { PageSpinner } from "../components/ui/Spinner";
import { formatDate } from "../utils/formatters";

interface FormValues {
  customerId: string;
  summary: string;
  description?: string;
  type: string;
  priority: string;
  frequency: string;
  interval: number;
  nextRunDate: string;
}

export default function RecurringPage() {
  const location = useLocation();
  // Set when arriving via a service agreement's "New" recurring-visit
  // shortcut, so the new schedule is pre-linked to that agreement + customer.
  const prefill = location.state as {
    agreementId?: string;
    agreementNumber?: string;
    customerId?: string;
  } | null;

  const { data: templates, isLoading } = useRecurringJobs();
  const { data: customersData } = useCustomers({ limit: 100 });
  const createMutation = useCreateRecurringJob();
  const updateMutation = useUpdateRecurringJob();
  const deleteMutation = useDeleteRecurringJob();
  const generateMutation = useGenerateRecurringJob();
  const runDueMutation = useRunDueRecurringJobs();

  const [modalOpen, setModalOpen] = useState(!!prefill?.agreementId);
  const [toDelete, setToDelete] = useState<RecurringJob | null>(null);

  const customers = customersData?.data ?? [];
  const rows = templates ?? [];

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      customerId: prefill?.customerId ?? "",
      type: "service",
      priority: "normal",
      frequency: "monthly",
      interval: 1,
    },
  });

  const onSubmit = async (data: FormValues) => {
    await createMutation.mutateAsync({
      ...data,
      interval: data.interval || 1,
      agreementId: prefill?.agreementId,
    });
    setModalOpen(false);
    reset({
      type: "service",
      priority: "normal",
      frequency: "monthly",
      interval: 1,
    });
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {rows.length} recurring schedule{rows.length === 1 ? "" : "s"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            icon={<BoltIcon className="h-4 w-4" />}
            loading={runDueMutation.isPending}
            onClick={() => {
              runDueMutation.mutate();
            }}
          >
            Run due now
          </Button>
          <Button
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              setModalOpen(true);
            }}
          >
            New recurring job
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<ArrowPathIcon />}
            title="No recurring jobs"
            description="Create a schedule to automatically generate jobs (e.g. quarterly maintenance)."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[44rem]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                    Summary
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Customer
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Frequency
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Agreement
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Next Run
                  </th>
                  <th className="text-center py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Generated
                  </th>
                  <th className="text-center py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Status
                  </th>
                  <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-3 px-5 font-medium text-gray-900">
                      {r.summary}
                    </td>
                    <td className="py-3 px-3 text-gray-600">
                      {r.customer
                        ? (r.customer.companyName ??
                          `${r.customer.firstName} ${r.customer.lastName}`)
                        : "-"}
                    </td>
                    <td className="py-3 px-3 text-gray-600">
                      {recurringFreqLabel(r.frequency)}
                      {r.interval > 1 ? ` ×${String(r.interval)}` : ""}
                    </td>
                    <td className="py-3 px-3">
                      {r.agreement ? (
                        <Link
                          to={`/agreements/${r.agreement.id}`}
                          className="text-primary-600 hover:text-primary-700 font-medium"
                        >
                          #{r.agreement.agreementNumber}
                        </Link>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-gray-600">
                      {formatDate(r.nextRunDate)}
                    </td>
                    <td className="py-3 px-3 text-center text-gray-600">
                      {r._count?.jobs ?? 0} work order
                      {r._count?.jobs === 1 ? "" : "s"}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <Badge
                        className={
                          r.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }
                      >
                        {r.isActive ? "Active" : "Paused"}
                      </Badge>
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Generate a job now"
                          onClick={() => {
                            generateMutation.mutate(r.id);
                          }}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                        >
                          <BoltIcon className="h-4 w-4" />
                        </button>
                        <button
                          title={r.isActive ? "Pause" : "Activate"}
                          onClick={() => {
                            updateMutation.mutate({
                              id: r.id,
                              isActive: !r.isActive,
                            });
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                        >
                          {r.isActive ? (
                            <PauseCircleIcon className="h-4 w-4" />
                          ) : (
                            <PlayCircleIcon className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          title="Delete"
                          onClick={() => {
                            setToDelete(r);
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
        }}
        title="New Recurring Job"
        size="lg"
      >
        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          className="space-y-4"
        >
          {prefill?.agreementId && (
            <p className="text-sm bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-primary-800">
              This schedule will be linked to service agreement{" "}
              {prefill.agreementNumber ? `#${prefill.agreementNumber}` : ""} —
              its generated work orders will show up there as Recurring
              Visits.
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Customer
            </label>
            <select
              {...register("customerId", { required: true })}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName ?? `${c.firstName} ${c.lastName}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Summary
            </label>
            <input
              {...register("summary", { required: true })}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="e.g. Quarterly HVAC maintenance"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Type
              </label>
              <LookupSelect category="jobType" {...register("type")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Priority
              </label>
              <LookupSelect category="jobPriority" {...register("priority")} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Frequency
              </label>
              <select
                {...register("frequency")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                {RECURRING_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Every (N)
              </label>
              <input
                type="number"
                min="1"
                {...register("interval", { valueAsNumber: true })}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                First run date
              </label>
              <input
                type="date"
                {...register("nextRunDate", { required: true })}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              {...register("description")}
              rows={2}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setModalOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => {
          setToDelete(null);
        }}
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.id);
          setToDelete(null);
        }}
        title="Delete recurring job"
        message="This stops future jobs from being generated from this schedule. Existing jobs are not affected."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
