import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useEstimate,
  useCreateEstimate,
  useUpdateEstimate,
} from "../hooks/useEstimates";
import { useCustomers } from "../hooks/useCustomers";
import { useJobs } from "../hooks/useJobs";
import { useLookup } from "../hooks/useMetadata";
import { useFormDraft } from "../hooks/useFormDraft";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import LineItemsTable, { LineItem } from "../components/ui/LineItemsTable";
import CustomerCombobox from "../components/ui/CustomerCombobox";
import JobCombobox from "../components/ui/JobCombobox";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency } from "../utils/formatters";

const schema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  jobId: z.string().optional(),
  title: z.string().min(1, "Title is required"),
  summary: z.string().optional(),
  validUntil: z.string().optional(),
  discountType: z.string().optional(),
  discountValue: z.number().min(0).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// Autosaved draft for the New Estimate screen, so an accidental tab change (or a
// reload) doesn't wipe in-progress work. Cleared once the estimate is created.
const DRAFT_KEY = "draft:estimate:new";
const DEFAULT_VALUES: Partial<FormData> = {
  discountType: "fixed",
  discountValue: 0,
};

interface EstimateDraft {
  form?: Partial<FormData>;
  lineItems?: LineItem[];
}

export default function EstimateFormPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditing = !!id;

  const { data: estimate, isLoading } = useEstimate(id ?? "");
  const { data: customersData } = useCustomers({ limit: 200 });
  const createMutation = useCreateEstimate();
  const updateMutation = useUpdateEstimate();
  const { options: discountTypeOptions } = useLookup("discountType");

  const customers = customersData?.data ?? [];
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const prefillCustomerId =
    (location.state as { customerId?: string } | null)?.customerId ?? "";

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { ...DEFAULT_VALUES, customerId: prefillCustomerId },
  });

  const customerId = watch("customerId");
  const jobId = watch("jobId") ?? "";
  const discountType = watch("discountType");
  const discountValue = watch("discountValue") ?? 0;

  const { data: jobsData } = useJobs({ customerId, limit: 100 });
  const customerJobs = jobsData?.data ?? [];

  useEffect(() => {
    if (estimate && isEditing) {
      reset({
        customerId: estimate.customerId,
        jobId: estimate.jobId ?? "",
        title: estimate.title,
        summary: estimate.summary ?? "",
        validUntil: estimate.validUntil ? estimate.validUntil.slice(0, 10) : "",
        discountType: estimate.discountType ?? "fixed",
        discountValue: estimate.discountValue ?? 0,
        notes: estimate.notes ?? "",
        terms: estimate.terms ?? "",
      });
      setLineItems(
        (estimate.lineItems ?? []).map((li) => ({
          id: li.id,
          type: li.type,
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
        })),
      );
    }
  }, [estimate, isEditing, reset]);

  const { restored: draftRestored, clearDraft } = useFormDraft<EstimateDraft>({
    key: DRAFT_KEY,
    enabled: !isEditing,
    value: { form: watch(), lineItems },
    hasContent: (v) =>
      Boolean(v.form?.customerId) ||
      Boolean(v.form?.title) ||
      Boolean(v.lineItems?.length),
    onRestore: (v) => {
      if (v.form) reset({ ...DEFAULT_VALUES, ...v.form });
      if (v.lineItems) setLineItems(v.lineItems);
    },
  });

  const discardDraft = () => {
    reset(DEFAULT_VALUES);
    setLineItems([]);
    clearDraft();
  };

  const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
  const discountAmt =
    discountType === "percentage"
      ? subtotal * (discountValue / 100)
      : discountValue;
  const total = subtotal - discountAmt;

  const onSubmit = async (data: FormData) => {
    const payload = {
      ...data,
      lineItems: lineItems.map((li, idx) => ({ ...li, sortOrder: idx })),
      subtotal,
      total,
    };

    if (isEditing) {
      await updateMutation.mutateAsync({ id: id, ...payload });
      navigate(`/estimates/${id}`);
    } else {
      const result = await createMutation.mutateAsync(payload);
      clearDraft();
      const newId = result.data.id;
      navigate(newId ? `/estimates/${newId}` : "/estimates");
    }
  };

  if (isEditing && isLoading) return <PageSpinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
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
        <Card title="Quote Details">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Customer <span className="text-red-500">*</span>
              </label>
              <CustomerCombobox
                customers={customers}
                value={customerId}
                onChange={(id) => {
                  setValue("customerId", id, {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                  // A job belongs to one customer -- clear a stale pick from
                  // whoever was previously selected.
                  setValue("jobId", "", { shouldDirty: true });
                }}
                error={errors.customerId?.message}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Related Work Order
              </label>
              <JobCombobox
                jobs={customerJobs}
                value={jobId}
                onChange={(id) => {
                  setValue("jobId", id, { shouldDirty: true });
                }}
                placeholder={
                  customerId ? "Not linked to a work order" : "Select a customer first"
                }
                disabled={!customerId}
                clearable
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                {...register("title")}
                type="text"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="e.g., HVAC Repair & Maintenance"
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Summary
                </label>
                <input
                  {...register("summary")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Valid Until
                </label>
                <input
                  {...register("validUntil")}
                  type="date"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Line Items */}
        <Card title="Line Items">
          <LineItemsTable
            items={lineItems}
            onChange={setLineItems}
            customerId={customerId}
          />
        </Card>

        {/* Pricing */}
        <Card title="Pricing">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Discount
                </label>
                <div className="flex gap-2">
                  <select
                    {...register("discountType")}
                    className="w-28 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    {discountTypeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    {...register("discountValue", { valueAsNumber: true })}
                    className="flex-1 px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Discount</span>
                  <span className="font-medium text-red-600">
                    -{formatCurrency(discountAmt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                <span>Total</span>
                <span className="text-primary-600">
                  {formatCurrency(total)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Notes */}
        <Card title="Notes & Terms">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Notes
              </label>
              <textarea
                {...register("notes")}
                rows={4}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Customer-facing notes..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Terms & Conditions
              </label>
              <textarea
                {...register("terms")}
                rows={4}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Payment terms..."
              />
            </div>
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
            {isEditing ? "Save Changes" : "Create Quote"}
          </Button>
        </div>
      </form>
    </div>
  );
}
