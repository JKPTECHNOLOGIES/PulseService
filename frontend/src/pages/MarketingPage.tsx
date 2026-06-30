import { useState } from "react";
import { Tab } from "@headlessui/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  PlusIcon,
  PhoneArrowDownLeftIcon,
  PhoneArrowUpRightIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { Call, Campaign } from "../types";
import { useCalls, useLogCall } from "../hooks/useCalls";
import { useCampaigns, useCreateCampaign } from "../hooks/useCampaigns";
import { useCustomers } from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Input from "../components/ui/Input";
import { LookupSelect } from "../components/ui/LookupSelect";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "../utils/formatters";

const SELECT_CLASS =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "-";
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  status: z.string().min(1, "Status is required"),
  budget: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  trackingNumber: z.string().optional(),
  notes: z.string().optional(),
});

type CampaignFormData = z.infer<typeof campaignSchema>;

function NewCampaignModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const createCampaign = useCreateCampaign();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: { type: "google", status: "active" },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: CampaignFormData) => {
    const payload: Partial<Campaign> = {
      name: data.name,
      type: data.type,
      status: data.status,
    };
    if (data.budget) payload.budget = Number(data.budget);
    if (data.startDate)
      payload.startDate = new Date(data.startDate).toISOString();
    if (data.endDate) payload.endDate = new Date(data.endDate).toISOString();
    if (data.trackingNumber) payload.trackingNumber = data.trackingNumber;
    if (data.notes) payload.notes = data.notes;

    await createCampaign.mutateAsync(payload);
    close();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="New Campaign" size="lg">
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="space-y-4"
      >
        <Input
          label="Name"
          placeholder="Summer AC Special 2024"
          error={errors.name?.message}
          {...register("name")}
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type <span className="text-red-500">*</span>
            </label>
            <LookupSelect category="campaignType" {...register("type")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Status <span className="text-red-500">*</span>
            </label>
            <LookupSelect category="campaignStatus" {...register("status")} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Budget"
            type="number"
            min={0}
            step={0.01}
            placeholder="5000"
            {...register("budget")}
          />
          <Input
            label="Tracking number"
            placeholder="(404) 555-COOL"
            {...register("trackingNumber")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Start date" type="date" {...register("startDate")} />
          <Input label="End date" type="date" {...register("endDate")} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Notes
          </label>
          <textarea
            rows={3}
            className={clsx(SELECT_CLASS, "resize-none")}
            placeholder="Campaign details, offer, target audience..."
            {...register("notes")}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" type="button" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={isSubmitting || createCampaign.isPending}
          >
            Create Campaign
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignsTab() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data, isLoading } = useCampaigns();
  const { getLabel: getCampaignTypeLabel } = useLookup("campaignType");
  const campaigns = data ?? [];

  if (isLoading) return <PageSpinner />;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Campaigns</h3>
        <Button
          size="sm"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            setIsModalOpen(true);
          }}
        >
          New Campaign
        </Button>
      </div>
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns"
          description="Track your marketing campaigns and their performance."
          action={{
            label: "New Campaign",
            onClick: () => {
              setIsModalOpen(true);
            },
          }}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                  Name
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Type
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Status
                </th>
                <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Budget
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Period
                </th>
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                  Tracking #
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="py-3.5 px-5 font-medium text-gray-900">
                    {c.name}
                  </td>
                  <td className="py-3.5 px-3 text-gray-600 text-xs">
                    {getCampaignTypeLabel(c.type)}
                  </td>
                  <td className="py-3.5 px-3">
                    <StatusBadge status={c.status} category="campaignStatus" />
                  </td>
                  <td className="py-3.5 px-3 text-right text-gray-900">
                    {c.budget ? formatCurrency(c.budget) : "-"}
                  </td>
                  <td className="py-3.5 px-3 text-gray-500 text-xs">
                    {formatDate(c.startDate)} – {formatDate(c.endDate)}
                  </td>
                  <td className="py-3.5 px-5 font-mono text-xs text-gray-600">
                    {c.trackingNumber ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewCampaignModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}

const callSchema = z.object({
  direction: z.string().min(1, "Direction is required"),
  status: z.string().min(1, "Status is required"),
  customerId: z.string().optional(),
  campaignId: z.string().optional(),
  fromNumber: z.string().optional(),
  toNumber: z.string().optional(),
  duration: z.string().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

type CallFormData = z.infer<typeof callSchema>;

function LogCallModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const logCall = useLogCall();
  const { data: customersData } = useCustomers({ limit: 200 });
  const { data: campaignsData } = useCampaigns();
  const customers = customersData?.data ?? [];
  const campaigns = campaignsData ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CallFormData>({
    resolver: zodResolver(callSchema),
    defaultValues: { direction: "inbound", status: "completed" },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: CallFormData) => {
    const payload: Partial<Call> = {
      direction: data.direction,
      status: data.status,
    };
    if (data.customerId) payload.customerId = data.customerId;
    if (data.campaignId) payload.campaignId = data.campaignId;
    if (data.fromNumber) payload.fromNumber = data.fromNumber;
    if (data.toNumber) payload.toNumber = data.toNumber;
    if (data.reason) payload.reason = data.reason;
    if (data.notes) payload.notes = data.notes;
    if (data.duration) payload.duration = Number(data.duration);

    await logCall.mutateAsync(payload);
    close();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Log Call" size="lg">
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Direction <span className="text-red-500">*</span>
            </label>
            <LookupSelect category="callDirection" {...register("direction")} />
            {errors.direction && (
              <p className="mt-1 text-xs text-red-600">
                {errors.direction.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Outcome <span className="text-red-500">*</span>
            </label>
            <LookupSelect category="callStatus" {...register("status")} />
            {errors.status && (
              <p className="mt-1 text-xs text-red-600">
                {errors.status.message}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Customer
          </label>
          <select className={SELECT_CLASS} {...register("customerId")}>
            <option value="">Unknown / not linked</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
                {c.companyName ? ` (${c.companyName})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="From number"
            placeholder="(404) 555-0100"
            {...register("fromNumber")}
          />
          <Input
            label="To number"
            placeholder="(404) 555-0199"
            {...register("toNumber")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Duration (seconds)"
            type="number"
            min={0}
            placeholder="0"
            {...register("duration")}
          />
          <Input
            label="Reason"
            placeholder="Service request, billing question..."
            {...register("reason")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Campaign / source
          </label>
          <select className={SELECT_CLASS} {...register("campaignId")}>
            <option value="">None</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Notes
          </label>
          <textarea
            rows={3}
            className={clsx(SELECT_CLASS, "resize-none")}
            placeholder="What was discussed..."
            {...register("notes")}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || logCall.isPending}>
            Log Call
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CallsTab() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data, isLoading } = useCalls({ limit: 50 });
  const calls = data?.data ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Recent Calls</h3>
        <Button
          size="sm"
          icon={<PhoneIcon className="h-4 w-4" />}
          onClick={() => {
            setIsModalOpen(true);
          }}
        >
          Log Call
        </Button>
      </div>
      {isLoading ? (
        <PageSpinner />
      ) : calls.length === 0 ? (
        <EmptyState
          title="No calls logged"
          description="Log inbound and outbound calls to track customer communication."
          action={{
            label: "Log Call",
            onClick: () => {
              setIsModalOpen(true);
            },
          }}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                  Date
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Direction
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Customer
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Number
                </th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Reason
                </th>
                <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                  Duration
                </th>
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {calls.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50">
                  <td className="py-3.5 px-5 text-gray-700">
                    {formatDateTime(call.createdAt)}
                  </td>
                  <td className="py-3.5 px-3">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {call.direction === "inbound" ? (
                        <>
                          <PhoneArrowDownLeftIcon className="h-3.5 w-3.5 text-green-600" />{" "}
                          In
                        </>
                      ) : (
                        <>
                          <PhoneArrowUpRightIcon className="h-3.5 w-3.5 text-blue-600" />{" "}
                          Out
                        </>
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-3 text-gray-900">
                    {call.customer
                      ? `${call.customer.firstName} ${call.customer.lastName}`
                      : "Unknown"}
                  </td>
                  <td className="py-3.5 px-3 text-gray-600">
                    {(call.direction === "inbound"
                      ? call.fromNumber
                      : call.toNumber) || "-"}
                  </td>
                  <td className="py-3.5 px-3 text-gray-600 text-xs truncate max-w-[160px]">
                    {call.reason ?? "-"}
                  </td>
                  <td className="py-3.5 px-3 text-right text-gray-600">
                    {formatDuration(call.duration)}
                  </td>
                  <td className="py-3.5 px-5">
                    <StatusBadge status={call.status} category="callStatus" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LogCallModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}

export default function MarketingPage() {
  const [selectedTab, setSelectedTab] = useState(0);

  return (
    <div className="space-y-5">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {["Campaigns", "Calls"].map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                clsx(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selected
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="mt-5">
          <Tab.Panel>
            <CampaignsTab />
          </Tab.Panel>
          <Tab.Panel>
            <CallsTab />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
