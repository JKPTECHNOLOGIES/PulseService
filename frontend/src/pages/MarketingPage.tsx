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
  ChatBubbleLeftRightIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { Call, Campaign, CustomerMessage } from "../types";
import { useCalls, useLogCall } from "../hooks/useCalls";
import { useMessages, useLogMessage } from "../hooks/useMessages";
import {
  useCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
} from "../hooks/useCampaigns";
import { useCustomers } from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Input from "../components/ui/Input";
import { LookupSelect } from "../components/ui/LookupSelect";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { TableSkeleton } from "../components/ui/Skeleton";
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

function CampaignModal({
  isOpen,
  onClose,
  campaign,
}: {
  isOpen: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
}) {
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const isEditing = !!campaign;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: campaign
      ? {
          name: campaign.name,
          type: campaign.type,
          status: campaign.status,
          budget: campaign.budget != null ? String(campaign.budget) : "",
          startDate: campaign.startDate ? campaign.startDate.slice(0, 10) : "",
          endDate: campaign.endDate ? campaign.endDate.slice(0, 10) : "",
          trackingNumber: campaign.trackingNumber ?? "",
          notes: campaign.notes ?? "",
        }
      : { type: "google", status: "active" },
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

    if (campaign) {
      await updateCampaign.mutateAsync({ id: campaign.id, ...payload });
    } else {
      await createCampaign.mutateAsync(payload);
    }
    close();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={isEditing ? "Edit Campaign" : "New Campaign"}
      size="lg"
    >
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            loading={
              isSubmitting ||
              createCampaign.isPending ||
              updateCampaign.isPending
            }
          >
            {isEditing ? "Save Changes" : "Create Campaign"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignsTab() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const { data, isLoading } = useCampaigns();
  const { getLabel: getCampaignTypeLabel } = useLookup("campaignType");
  const campaigns = data ?? [];

  const openNew = () => {
    setEditing(null);
    setIsModalOpen(true);
  };
  const openEdit = (c: Campaign) => {
    setEditing(c);
    setIsModalOpen(true);
  };

  const columns: Column<Campaign>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (c) => c.name.toLowerCase(),
      exportValue: (c) => c.name,
      render: (c) => (
        <div>
          <p className="font-medium text-gray-900">{c.name}</p>
          {c.notes ? (
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[260px]">
              {c.notes}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (c) => c.type,
      exportValue: (c) => getCampaignTypeLabel(c.type),
      render: (c) => (
        <span className="text-gray-600 text-xs">
          {getCampaignTypeLabel(c.type)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (c) => c.status,
      exportValue: (c) => c.status,
      render: (c) => (
        <StatusBadge status={c.status} category="campaignStatus" />
      ),
    },
    {
      key: "budget",
      header: "Budget",
      align: "right",
      sortValue: (c) => c.budget ?? 0,
      exportValue: (c) => c.budget ?? "",
      render: (c) => (
        <span className="text-gray-900">
          {c.budget ? formatCurrency(c.budget) : "-"}
        </span>
      ),
    },
    {
      key: "period",
      header: "Period",
      sortValue: (c) => (c.startDate ? new Date(c.startDate).getTime() : 0),
      exportValue: (c) =>
        `${formatDate(c.startDate)} - ${formatDate(c.endDate)}`,
      render: (c) => (
        <span className="text-gray-500 text-xs">
          {formatDate(c.startDate)} – {formatDate(c.endDate)}
        </span>
      ),
    },
    {
      key: "tracking",
      header: "Tracking #",
      exportValue: (c) => c.trackingNumber ?? "",
      render: (c) => (
        <span className="font-mono text-xs text-gray-600">
          {c.trackingNumber ?? "-"}
        </span>
      ),
    },
  ];

  if (isLoading) return <TableSkeleton rows={6} />;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Campaigns</h3>
        <Button
          size="sm"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={openNew}
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
            onClick: openNew,
          }}
        />
      ) : (
        <DataTable<Campaign>
          columns={columns}
          rows={campaigns}
          getRowId={(c) => c.id}
          onRowClick={(c) => {
            openEdit(c);
          }}
          sort={sort}
          onSortChange={setSort}
          csvFilename="campaigns"
          renderMobileCard={(c) => (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-gray-900 truncate">{c.name}</p>
                <StatusBadge status={c.status} category="campaignStatus" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {getCampaignTypeLabel(c.type)}
                {c.budget ? ` · ${formatCurrency(c.budget)}` : ""}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDate(c.startDate)} – {formatDate(c.endDate)}
              </p>
              {c.trackingNumber && (
                <p className="font-mono text-xs text-gray-500 mt-0.5">
                  {c.trackingNumber}
                </p>
              )}
            </div>
          )}
        />
      )}

      <CampaignModal
        key={editing?.id ?? "new"}
        isOpen={isModalOpen}
        campaign={editing}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
  const [sort, setSort] = useState<SortState | null>(null);
  const { data, isLoading } = useCalls({ limit: 50 });
  const calls = data?.data ?? [];

  const callNumber = (call: Call) =>
    (call.direction === "inbound" ? call.fromNumber : call.toNumber) || "-";
  const callCustomer = (call: Call) =>
    call.customer
      ? `${call.customer.firstName} ${call.customer.lastName}`
      : "Unknown";

  const columns: Column<Call>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (call) => new Date(call.createdAt).getTime(),
      exportValue: (call) => formatDateTime(call.createdAt),
      render: (call) => (
        <span className="text-gray-700">{formatDateTime(call.createdAt)}</span>
      ),
    },
    {
      key: "direction",
      header: "Direction",
      sortValue: (call) => call.direction,
      exportValue: (call) => call.direction,
      render: (call) => (
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
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (call) => callCustomer(call).toLowerCase(),
      exportValue: (call) => callCustomer(call),
      render: (call) => (
        <span className="text-gray-900">{callCustomer(call)}</span>
      ),
    },
    {
      key: "number",
      header: "Number",
      exportValue: (call) => callNumber(call),
      render: (call) => (
        <span className="text-gray-600">{callNumber(call)}</span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      exportValue: (call) => call.reason ?? "",
      render: (call) => (
        <span className="text-gray-600 text-xs truncate max-w-[160px] inline-block align-middle">
          {call.reason ?? "-"}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      sortValue: (call) => call.duration ?? 0,
      exportValue: (call) => formatDuration(call.duration),
      render: (call) => (
        <span className="text-gray-600">{formatDuration(call.duration)}</span>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      sortValue: (call) => call.status,
      exportValue: (call) => call.status,
      render: (call) => (
        <StatusBadge status={call.status} category="callStatus" />
      ),
    },
  ];

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
        <TableSkeleton rows={8} />
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
        <DataTable<Call>
          columns={columns}
          rows={calls}
          getRowId={(call) => call.id}
          sort={sort}
          onSortChange={setSort}
          csvFilename="calls"
          renderMobileCard={(call) => (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                  {call.direction === "inbound" ? (
                    <PhoneArrowDownLeftIcon className="h-4 w-4 text-green-600" />
                  ) : (
                    <PhoneArrowUpRightIcon className="h-4 w-4 text-blue-600" />
                  )}
                  {callCustomer(call)}
                </span>
                <StatusBadge status={call.status} category="callStatus" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {callNumber(call)} · {formatDuration(call.duration)}
              </p>
              {call.reason && (
                <p className="text-xs text-gray-500 mt-0.5">{call.reason}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDateTime(call.createdAt)}
              </p>
            </div>
          )}
        />
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

const messageSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  direction: z.string().min(1, "Direction is required"),
  channel: z.string().min(1, "Channel is required"),
  subject: z.string().optional(),
  body: z.string().min(1, "Message is required"),
});

type MessageFormData = z.infer<typeof messageSchema>;

function LogMessageModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const logMessage = useLogMessage();
  const { data: customersData } = useCustomers({ limit: 200 });
  const customers = customersData?.data ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MessageFormData>({
    resolver: zodResolver(messageSchema),
    defaultValues: { direction: "outbound", channel: "sms" },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: MessageFormData) => {
    const payload: Partial<CustomerMessage> = {
      customerId: data.customerId,
      direction: data.direction,
      channel: data.channel,
      body: data.body,
    };
    if (data.subject) payload.subject = data.subject;

    await logMessage.mutateAsync(payload);
    close();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Log Message" size="lg">
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Customer <span className="text-red-500">*</span>
          </label>
          <select className={SELECT_CLASS} {...register("customerId")}>
            <option value="">Select customer...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
                {c.companyName ? ` (${c.companyName})` : ""}
              </option>
            ))}
          </select>
          {errors.customerId && (
            <p className="mt-1 text-xs text-red-600">
              {errors.customerId.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Direction <span className="text-red-500">*</span>
            </label>
            <LookupSelect
              category="messageDirection"
              {...register("direction")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Channel <span className="text-red-500">*</span>
            </label>
            <LookupSelect category="messageChannel" {...register("channel")} />
          </div>
        </div>

        <Input
          label="Subject"
          placeholder="Optional subject line (email only)"
          {...register("subject")}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Message <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={4}
            className={clsx(SELECT_CLASS, "resize-none")}
            placeholder="What was sent to the customer..."
            {...register("body")}
          />
          {errors.body && (
            <p className="mt-1 text-xs text-red-600">{errors.body.message}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || logMessage.isPending}>
            Log Message
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MessagesTab() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const { data, isLoading } = useMessages({ limit: 50 });
  const messages = data?.data ?? [];

  const messageCustomer = (msg: CustomerMessage) =>
    msg.customer
      ? `${msg.customer.firstName} ${msg.customer.lastName}`
      : "Unknown";

  const columns: Column<CustomerMessage>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (msg) => new Date(msg.sentAt).getTime(),
      exportValue: (msg) => formatDateTime(msg.sentAt),
      render: (msg) => (
        <span className="text-gray-700">{formatDateTime(msg.sentAt)}</span>
      ),
    },
    {
      key: "direction",
      header: "Direction",
      sortValue: (msg) => msg.direction,
      exportValue: (msg) => msg.direction,
      render: (msg) => (
        <span className="inline-flex items-center gap-1 text-xs">
          {msg.direction === "inbound" ? (
            <>
              <ArrowDownCircleIcon className="h-3.5 w-3.5 text-green-600" /> In
            </>
          ) : (
            <>
              <ArrowUpCircleIcon className="h-3.5 w-3.5 text-blue-600" /> Out
            </>
          )}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (msg) => messageCustomer(msg).toLowerCase(),
      exportValue: (msg) => messageCustomer(msg),
      render: (msg) => (
        <span className="text-gray-900">{messageCustomer(msg)}</span>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      sortValue: (msg) => msg.channel,
      exportValue: (msg) => msg.channel,
      render: (msg) => (
        <StatusBadge status={msg.channel} category="messageChannel" />
      ),
    },
    {
      key: "subject",
      header: "Subject",
      exportValue: (msg) => msg.subject ?? "",
      render: (msg) => (
        <span className="text-gray-600 text-xs truncate max-w-[140px] inline-block align-middle">
          {msg.subject ?? "-"}
        </span>
      ),
    },
    {
      key: "body",
      header: "Message",
      exportValue: (msg) => msg.body,
      render: (msg) => (
        <span className="text-gray-600 text-xs truncate max-w-[220px] inline-block align-middle">
          {msg.body}
        </span>
      ),
    },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Customer Messages
        </h3>
        <Button
          size="sm"
          icon={<ChatBubbleLeftRightIcon className="h-4 w-4" />}
          onClick={() => {
            setIsModalOpen(true);
          }}
        >
          Log Message
        </Button>
      </div>
      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : messages.length === 0 ? (
        <EmptyState
          title="No messages logged"
          description="Keep a record of SMS and email messages sent to existing customers."
          action={{
            label: "Log Message",
            onClick: () => {
              setIsModalOpen(true);
            },
          }}
        />
      ) : (
        <DataTable<CustomerMessage>
          columns={columns}
          rows={messages}
          getRowId={(msg) => msg.id}
          sort={sort}
          onSortChange={setSort}
          csvFilename="messages"
          renderMobileCard={(msg) => (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                  {msg.direction === "inbound" ? (
                    <ArrowDownCircleIcon className="h-4 w-4 text-green-600" />
                  ) : (
                    <ArrowUpCircleIcon className="h-4 w-4 text-blue-600" />
                  )}
                  {messageCustomer(msg)}
                </span>
                <StatusBadge status={msg.channel} category="messageChannel" />
              </div>
              {msg.subject && (
                <p className="text-xs text-gray-500 mt-0.5 font-medium">
                  {msg.subject}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-0.5">{msg.body}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDateTime(msg.sentAt)}
              </p>
            </div>
          )}
        />
      )}

      <LogMessageModal
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
          {["Campaigns", "Calls", "Messages"].map((tab) => (
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
          <Tab.Panel>
            <MessagesTab />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
