import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useInvoice,
  useCreateInvoice,
  useUpdateInvoice,
} from "../hooks/useInvoices";
import { useCustomers } from "../hooks/useCustomers";
import { useJobs, useJob } from "../hooks/useJobs";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import LineItemsTable, { LineItem } from "../components/ui/LineItemsTable";
import CustomerCombobox from "../components/ui/CustomerCombobox";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import { useJobParts } from "../hooks/useInventory";
import { useSerializedUnits } from "../hooks/useSerials";
import { useJobTimeEntries } from "../hooks/useTime";
import { useTechnicians } from "../hooks/useTechnicians";
import { usePurchaseOrders } from "../hooks/usePurchasing";
import { useFormDraft } from "../hooks/useFormDraft";

// Enum values are validated server-side against the DB-driven lookups; the form
// only needs a present value so we never duplicate the enum here.
const schema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  jobId: z.string().optional(),
  dueDate: z.string().optional(),
  discountType: z.string().optional(),
  discountValue: z.number().min(0).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// Decimal fields arrive from the API as strings; coerce defensively.
const num = (v: unknown): number => Number(v ?? 0);

// See EstimateFormPage: autosave a New Invoice draft so navigating away or a
// reload doesn't lose it. Cleared once the invoice is created.
const DRAFT_KEY = "draft:invoice:new";
const DEFAULT_VALUES: Partial<FormData> = {
  discountType: "fixed",
  discountValue: 0,
};

interface InvoiceDraft {
  form?: Partial<FormData>;
  lineItems?: LineItem[];
}

export default function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isEditing = !!id;
  // Set when arriving via a job's "Create Invoice" button.
  const prefill = location.state as {
    jobId?: string;
    customerId?: string;
  } | null;

  const { data: invoice, isLoading } = useInvoice(id ?? "");
  const { data: customersData } = useCustomers({ limit: 200 });
  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();
  const { options: discountTypeOptions } = useLookup("discountType");

  const customers = customersData?.data ?? [];
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
  });

  const customerId = watch("customerId");
  const discountType = watch("discountType");
  const discountValue = watch("discountValue") ?? 0;

  const { data: jobsData } = useJobs({ limit: 100 });
  const customerJobs = (jobsData?.data ?? []).filter(
    (j) => j.customerId === customerId,
  );

  // Parts issued to the selected job (from truck/warehouse stock) that can be
  // pulled onto the invoice as line items.
  const jobId = watch("jobId") ?? "";
  const { data: jobParts } = useJobParts(jobId);

  // Job labor can be billed off two sources: the *scheduled* time (primary
  // window + additional blocks set in dispatch) or the *actual* logged time
  // (technician clock-in/out). Either can be dropped onto the invoice as a
  // single Labor line; the office fills in the hourly rate.
  const minutesBetween = (s: string, e: string) => {
    const ms = new Date(e).getTime() - new Date(s).getTime();
    return ms > 0 ? Math.round(ms / 60000) : 0;
  };
  const toHours = (mins: number) => Math.round((mins / 60) * 100) / 100;

  const { data: jobDetail } = useJob(jobId);
  const scheduledMinutes = (() => {
    if (!jobDetail) return 0;
    const primary =
      jobDetail.scheduledStart && jobDetail.scheduledEnd
        ? minutesBetween(jobDetail.scheduledStart, jobDetail.scheduledEnd)
        : 0;
    const blocks = (jobDetail.scheduleBlocks ?? []).reduce(
      (sum, b) => sum + minutesBetween(b.start, b.end),
      0,
    );
    return primary + blocks;
  })();
  const scheduledHours = toHours(scheduledMinutes);

  const { data: jobTimeEntries } = useJobTimeEntries(jobId);
  const loggedMinutes = (jobTimeEntries ?? []).reduce(
    (sum, e) => sum + (e.duration ?? 0),
    0,
  );
  const loggedHours = toHours(loggedMinutes);

  // Per-technician logged hours + pay rate, exactly like the job's Materials
  // & Equipment "Labor" breakdown -- so labor pulled onto the invoice bills at
  // the same rate shown there instead of a manually-priced lump sum.
  const { data: laborTechsData } = useTechnicians();
  const loggedLaborRows = (() => {
    const technicians = laborTechsData?.data ?? [];
    const byTech = new Map<
      string,
      { name: string; minutes: number; rate: number | null }
    >();
    for (const e of jobTimeEntries ?? []) {
      const key = e.technicianId ?? e.userId;
      const tech = technicians.find((t) => t.id === e.technicianId);
      const name = tech
        ? `${tech.user.firstName} ${tech.user.lastName}`
        : e.user
          ? `${e.user.firstName} ${e.user.lastName}`
          : "Technician";
      const existing = byTech.get(key);
      byTech.set(key, {
        name,
        minutes: (existing?.minutes ?? 0) + (e.duration ?? 0),
        rate: tech?.payRate ?? existing?.rate ?? null,
      });
    }
    return [...byTech.values()];
  })();

  // Serialized units installed on the job = billable equipment. Priced at the
  // catalog sale price when the unit's item is mapped to the pricebook.
  const { data: jobUnits } = useSerializedUnits({ jobId, limit: 100 });
  const installedUnits = jobId ? (jobUnits?.data ?? []) : [];

  // Purchase orders raised specifically for this job -- surfaced so the office
  // remembers to bill back the materials cost, with a shortcut to the job's
  // Materials & Equipment card (which has the full line-item detail).
  const { data: jobPOs } = usePurchaseOrders(
    { jobId, limit: 50 },
    { enabled: !!jobId },
  );
  const jobPurchaseOrders = jobId ? (jobPOs?.data ?? []) : [];
  const jobPOTotal = jobPurchaseOrders.reduce(
    (sum, po) => sum + num(po.totalAmount),
    0,
  );
  const addEquipmentLines = () => {
    if (installedUnits.length === 0) return;
    setLineItems((items) => [
      ...items,
      ...installedUnits
        .map((u) => {
          const price = u.inventoryItem?.pricebookItem?.unitPrice ?? 0;
          const desc = u.serialNumber ? `S/N ${u.serialNumber}` : undefined;
          return {
            type: "equipment",
            name: u.inventoryItem?.name ?? "Equipment",
            description: desc,
            quantity: 1,
            unitPrice: price,
            total: price,
          };
        })
        // Skip units already added (matched by their serial-number description).
        .filter(
          (line) =>
            !items.some(
              (li) => li.type === "equipment" && li.description === line.description,
            ),
        ),
    ]);
  };

  const addScheduledLaborLine = () => {
    if (scheduledHours <= 0) return;
    const jobRef = jobDetail ? ` on job #${jobDetail.jobNumber}` : " on job";
    setLineItems((items) => {
      const description = `Scheduled time${jobRef}`;
      if (items.some((li) => li.type === "labor" && li.description === description)) {
        return items;
      }
      return [
        ...items,
        {
          type: "labor",
          name: "Labor",
          description,
          quantity: scheduledHours,
          unitPrice: 0,
          total: 0,
        },
      ];
    });
  };

  // One line per technician, priced at their actual pay rate -- the same
  // breakdown the job's Materials & Equipment card shows (see JobDetailPage's
  // JobMaterialsCard). A tech with no rate set still lands on the invoice at
  // $0/hr so the office can fill it in rather than being silently skipped.
  const addLoggedLaborLines = () => {
    if (loggedLaborRows.length === 0) return;
    const jobRef = jobDetail ? ` on job #${jobDetail.jobNumber}` : " on job";
    setLineItems((items) => [
      ...items,
      ...loggedLaborRows
        .filter((r) => r.minutes > 0)
        .map((r) => {
          const hours = toHours(r.minutes);
          const rate = r.rate ?? 0;
          return {
            type: "labor",
            name: "Labor",
            description: `${r.name} \u2014 logged time${jobRef}`,
            quantity: hours,
            unitPrice: rate,
            total: Math.round(hours * rate * 100) / 100,
          };
        })
        .filter(
          (line) =>
            !items.some(
              (li) => li.type === "labor" && li.description === line.description,
            ),
        ),
    ]);
  };
  const importJobParts = () => {
    const parts = jobParts ?? [];
    if (parts.length === 0) return;
    setLineItems((items) => [
      ...items,
      ...parts
        // skip parts already on the invoice (matched by name + qty)
        .filter(
          (p) =>
            !items.some(
              (li) => li.name === p.name && li.quantity === p.quantityUsed,
            ),
        )
        .map((p) => ({
          type: "part",
          name: p.name,
          description: p.sku,
          quantity: p.quantityUsed,
          unitPrice: p.unitPrice,
          total: p.total,
        })),
    ]);
  };

  useEffect(() => {
    if (invoice && isEditing) {
      reset({
        customerId: invoice.customerId,
        jobId: invoice.jobId ?? "",
        dueDate: invoice.dueDate ? invoice.dueDate.slice(0, 10) : "",
        discountType: invoice.discountType ?? "fixed",
        discountValue: invoice.discountValue ?? 0,
        notes: invoice.notes ?? "",
        terms: invoice.terms ?? "",
      });
      setLineItems(
        (invoice.lineItems ?? []).map((li) => ({
          id: li.id,
          type: li.type,
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
          includeOnDocument: li.includeOnDocument,
        })),
      );
    }
  }, [invoice, isEditing, reset]);

  const { restored: draftRestored, clearDraft } = useFormDraft<InvoiceDraft>({
    key: DRAFT_KEY,
    enabled: !isEditing,
    value: { form: watch(), lineItems },
    hasContent: (v) =>
      Boolean(v.form?.customerId) || Boolean(v.lineItems?.length),
    onRestore: (v) => {
      if (v.form) reset({ ...DEFAULT_VALUES, ...v.form });
      if (v.lineItems) setLineItems(v.lineItems);
    },
  });

  // When opened from a job's "Create Invoice" action, preselect that customer +
  // job so the material/equipment/labor import banners appear immediately. Runs
  // once on mount (after any draft restore) since the state is a one-shot
  // navigation payload.
  useEffect(() => {
    if (!isEditing && prefill?.customerId) {
      setValue("customerId", prefill.customerId);
      if (prefill.jobId) setValue("jobId", prefill.jobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discardDraft = () => {
    reset(DEFAULT_VALUES);
    setLineItems([]);
    clearDraft();
  };

  // Mirrors the backend's calculateTotals rule: lines unchecked via
  // "include on invoice" stay on the invoice for record but don't bill.
  const subtotal = lineItems.reduce(
    (sum, li) => sum + (li.includeOnDocument === false ? 0 : li.total),
    0,
  );
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
      navigate(`/invoices/${id}`);
    } else {
      const result = (await createMutation.mutateAsync(payload)) as {
        data?: { id?: string };
        id?: string;
      };
      clearDraft();
      const newId = result.data?.id ?? result.id;
      navigate(newId ? `/invoices/${newId}` : "/invoices");
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
        <Card title="Invoice Details">
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
                }}
                error={errors.customerId?.message}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {customerId && customerJobs.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Related Work Order
                  </label>
                  <select
                    {...register("jobId")}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">None</option>
                    {customerJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        #{j.jobNumber} - {j.summary}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Due Date
                </label>
                <input
                  {...register("dueDate")}
                  type="date"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </Card>

        <Card title="Line Items">
          {jobId && (jobParts?.length ?? 0) > 0 && (
            <div className="mb-3 flex items-center justify-between bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5">
              <p className="text-sm text-primary-800">
                {jobParts?.length} part(s) were used on this job.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={importJobParts}
              >
                Add to invoice
              </Button>
            </div>
          )}
          {jobId && scheduledMinutes > 0 && (
            <div className="mb-3 flex items-center justify-between bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5">
              <p className="text-sm text-primary-800">
                {scheduledHours} hr(s) of scheduled time on this job.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addScheduledLaborLine}
              >
                Add scheduled labor
              </Button>
            </div>
          )}
          {jobId && installedUnits.length > 0 && (
            <div className="mb-3 flex items-center justify-between bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5">
              <p className="text-sm text-primary-800">
                {installedUnits.length} unit(s) installed on this job.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addEquipmentLines}
              >
                Add equipment
              </Button>
            </div>
          )}
          {jobId && loggedMinutes > 0 && (
            <div className="mb-3 flex items-center justify-between bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5">
              <p className="text-sm text-primary-800">
                {loggedHours} hr(s) of logged (clocked) time on this job.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addLoggedLaborLines}
              >
                Add logged labor
              </Button>
            </div>
          )}
          {jobId && jobPurchaseOrders.length > 0 && (
            <div className="mb-3 flex items-center justify-between bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5">
              <p className="text-sm text-primary-800">
                {jobPurchaseOrders.length} purchase order(s) totaling{" "}
                {formatCurrency(jobPOTotal)} on this job — remember to bill
                back materials cost.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigate(`/jobs/${jobId}`);
                }}
              >
                View on job
              </Button>
            </div>
          )}
          <LineItemsTable
            items={lineItems}
            onChange={setLineItems}
            customerId={customerId}
            showIncludeToggle
          />
        </Card>

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

        <Card title="Notes & Terms">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Notes
              </label>
              <textarea
                {...register("notes")}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Terms
              </label>
              <textarea
                {...register("terms")}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
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
            {isEditing ? "Save Changes" : "Create Invoice"}
          </Button>
        </div>
      </form>
    </div>
  );
}
