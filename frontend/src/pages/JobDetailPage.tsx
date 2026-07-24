import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import toast from "../lib/toast";
import {
  PencilIcon,
  ChevronRightIcon,
  UserPlusIcon,
  CheckIcon,
  ClockIcon,
  TrashIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  QrCodeIcon,
  StarIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { useJob } from "../hooks/useJobs";
import {
  useUpdateJobStatus,
  useAssignTechnician,
  useRemoveTechnician,
  useArchiveJob,
  useUnarchiveJob,
} from "../hooks/useJobs";
import { useTechnicians } from "../hooks/useTechnicians";
import { useAuthStore } from "../store/authStore";
import {
  useCurrentTimeEntry,
  useJobTimeEntries,
  useClockIn,
  useClockOut,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
} from "../hooks/useTime";
import { useLookup } from "../hooks/useMetadata";
import { usePermissions } from "../hooks/usePermissions";
import {
  useSerializedUnits,
  useUninstallSerializedUnit,
} from "../hooks/useSerials";
import { usePurchaseOrders } from "../hooks/usePurchasing";
import {
  useJobParts,
  useIssueToJob,
  useReverseTransaction,
  useInventoryItems,
  useStockLocations,
} from "../hooks/useInventory";
import Button from "../components/ui/Button";
import Badge, { StatusBadge } from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { NumberInput } from "../components/ui/NumberInput";
import ConfirmDialog from "../components/ui/ConfirmDialog";

// Heavy (camera + decoder) -- only pulled in when a scan is actually started.
const BarcodeScanner = lazy(() => import("../components/ui/BarcodeScanner"));
import AttachmentGallery from "../components/ui/AttachmentGallery";
import Timeline from "../components/ui/Timeline";
import SignatureCard from "../components/ui/SignatureCard";
import InstallSerialModal from "../components/ui/InstallSerialModal";
import { Can } from "../components/ui/Can";
import IconButton from "../components/ui/IconButton";
import { PageSpinner } from "../components/ui/Spinner";
import { directionsUrl } from "../lib/maps";
import {
  formatCurrency,
  formatDateTime,
  formatDate,
  capitalize,
} from "../utils/formatters";

// Decimal fields arrive from the API as strings; coerce defensively.
const num = (v: unknown) => Number(v ?? 0);

function formatDuration(mins?: number | null): string {
  if (!mins || mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${String(h)}h ${String(m)}m` : `${String(m)}m`;
}

// Converts an ISO timestamp to the local `datetime-local` input format
// ("YYYY-MM-DDTHH:mm", in the browser's timezone, no seconds/offset).
function toLocalInputValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-gray-500",
  normal: "text-blue-600",
  high: "text-orange-600",
  urgent: "text-red-600 font-semibold",
};

function TimelineStep({
  label,
  done,
  active,
}: {
  label: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={clsx(
          "relative z-10 h-7 w-7 rounded-full border-2 flex items-center justify-center transition-colors",
          done
            ? "bg-primary-600 border-primary-600"
            : active
              ? "bg-white border-primary-600"
              : "bg-white border-gray-200",
        )}
      >
        {done && <CheckIcon className="h-4 w-4 text-oncolor" />}
        {active && <div className="h-2.5 w-2.5 rounded-full bg-primary-600" />}
      </div>
      <span
        className={clsx(
          "text-xs text-center",
          done || active ? "text-gray-900" : "text-gray-400",
        )}
      >
        {label}
      </span>
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [statusModal, setStatusModal] = useState(false);
  const [assignModal, setAssignModal] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [removeTechConfirm, setRemoveTechConfirm] = useState<{
    technicianId: string;
    name: string;
  } | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [selectedTech, setSelectedTech] = useState("");
  const [selectedTechIsLead, setSelectedTechIsLead] = useState(false);
  const [timeEntryModal, setTimeEntryModal] = useState<{
    id?: string;
    technicianId: string;
    startTime: string;
    endTime: string;
    notes: string;
  } | null>(null);
  const [deleteTimeConfirm, setDeleteTimeConfirm] = useState<string | null>(
    null,
  );

  const { data: job, isLoading } = useJob(id ?? "");
  const { data: techsData } = useTechnicians();
  const { getLabel: getSourceLabel } = useLookup("leadSource");
  const { data: currentEntry } = useCurrentTimeEntry();
  const { data: jobTimeEntries } = useJobTimeEntries(id ?? "");
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const createTimeEntry = useCreateTimeEntry();
  const updateTimeEntry = useUpdateTimeEntry();
  const deleteTimeEntry = useDeleteTimeEntry();
  const updateStatus = useUpdateJobStatus();
  const assignTech = useAssignTechnician();
  const removeTech = useRemoveTechnician();
  const archiveJob = useArchiveJob();
  const unarchiveJob = useUnarchiveJob();
  const { options: jobStatusOptions } = useLookup("jobStatus");

  if (isLoading) return <PageSpinner />;
  if (!job)
    return <div className="text-center py-12 text-gray-500">Work order not found</div>;

  const techs = techsData?.data ?? [];
  const timelineSteps = [
    "new",
    "scheduled",
    "parts_on_hold",
    "in_progress",
    "completed",
  ];
  const currentIdx = timelineSteps.indexOf(job.status);

  // Scheduled labor time = the primary window plus any additional time blocks.
  const blockMinutes = (startIso: string, endIso: string) => {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    return ms > 0 ? Math.round(ms / 60000) : 0;
  };
  const scheduleBlocks = job.scheduleBlocks ?? [];
  const primaryScheduledMins =
    job.scheduledStart && job.scheduledEnd
      ? blockMinutes(job.scheduledStart, job.scheduledEnd)
      : 0;
  const totalScheduledMins =
    primaryScheduledMins +
    scheduleBlocks.reduce((s, b) => s + blockMinutes(b.start, b.end), 0);

  const handleStatusUpdate = async () => {
    if (newStatus) {
      await updateStatus.mutateAsync({ id: id ?? "", status: newStatus });
      setStatusModal(false);
    }
  };

  const handleAssign = async () => {
    if (selectedTech) {
      await assignTech.mutateAsync({
        jobId: id ?? "",
        technicianId: selectedTech,
        isLead: selectedTechIsLead,
      });
      setAssignModal(false);
      setSelectedTech("");
      setSelectedTechIsLead(false);
    }
  };

  const handleMakeLead = (technicianId: string) => {
    void assignTech.mutateAsync({ jobId: id ?? "", technicianId, isLead: true });
  };

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link to="/jobs" className="hover:text-primary-600">
          Jobs
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium">#{job.jobNumber}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900">
                Work Order #{job.jobNumber}
              </h2>
              <StatusBadge status={job.status} type="job" />
              {job.isArchived && (
                <Badge className="bg-gray-100 text-gray-500">Archived</Badge>
              )}
              <span
                className={clsx(
                  "text-sm capitalize",
                  PRIORITY_COLORS[job.priority],
                )}
              >
                {job.priority} priority
              </span>
            </div>
            <p className="text-gray-600 mt-1">{job.summary}</p>
            {job.recurringJob && (
              <p className="text-xs text-gray-400 mt-1">
                Generated from recurring service — {job.recurringJob.summary}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0 sm:flex-row sm:flex-wrap">
            <Can permission="invoices.manage">
              <Button
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  navigate("/invoices/new", {
                    state: { jobId: job.id, customerId: job.customerId },
                  });
                }}
              >
                Create Invoice
              </Button>
            </Can>
            <Can permission="jobs.status">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  setNewStatus(job.status);
                  setStatusModal(true);
                }}
              >
                Update Status
              </Button>
            </Can>
            <Can permission="jobs.edit">
              <Button
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto"
                icon={<PencilIcon className="h-4 w-4" />}
                onClick={() => {
                  navigate(`/jobs/${id ?? ""}/edit`);
                }}
              >
                Edit
              </Button>
            </Can>
            <Can permission="jobs.delete">
              {job.isArchived ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  icon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                  loading={unarchiveJob.isPending}
                  onClick={() => {
                    unarchiveJob.mutate(id ?? "");
                  }}
                >
                  Restore
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  icon={<ArchiveBoxIcon className="h-4 w-4" />}
                  onClick={() => {
                    setArchiveConfirm(true);
                  }}
                >
                  Archive
                </Button>
              )}
            </Can>
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <div className="flex items-start justify-between relative">
            <div className="absolute top-3.5 left-3.5 right-3.5 h-0.5 bg-gray-200" />
            {timelineSteps.map((step, idx) => (
              <TimelineStep
                key={step}
                label={capitalize(step)}
                done={idx < currentIdx}
                active={idx === currentIdx}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Job Details */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Work Order Details</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-gray-500">Customer</dt>
                <dd className="text-sm font-medium mt-0.5">
                  {job.customer ? (
                    <Link
                      to={`/customers/${job.customerId}`}
                      className="text-primary-600 hover:text-primary-700"
                    >
                      {job.customer.firstName} {job.customer.lastName}
                    </Link>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Location</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {job.location ? (
                    <span className="flex items-center gap-2">
                      <span>
                        {job.location.address}, {job.location.city}
                      </span>
                      <a
                        href={
                          directionsUrl({
                            lat: job.location.lat,
                            lng: job.location.lng,
                            address: [
                              job.location.address,
                              job.location.city,
                              job.location.state,
                              job.location.zip,
                            ],
                          }) ?? undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-600 hover:text-primary-700 text-xs font-medium"
                      >
                        Directions
                      </a>
                    </span>
                  ) : (
                    "No location"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Work Order Type</dt>
                <dd className="text-sm font-medium text-gray-900 capitalize mt-0.5">
                  {job.type}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Priority</dt>
                <dd
                  className={clsx(
                    "text-sm font-medium capitalize mt-0.5",
                    PRIORITY_COLORS[job.priority],
                  )}
                >
                  {job.priority}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Source</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {getSourceLabel(job.source)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Scheduled Start</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {formatDateTime(job.scheduledStart)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Scheduled End</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {formatDateTime(job.scheduledEnd)}
                </dd>
              </div>
              {(scheduleBlocks.length > 0 || totalScheduledMins > 0) && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-gray-500">
                    Scheduled time blocks
                  </dt>
                  <dd className="mt-1 space-y-1">
                    {job.scheduledStart && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">
                          {formatDateTime(job.scheduledStart)}
                          {job.scheduledEnd
                            ? ` \u2013 ${formatDateTime(job.scheduledEnd)}`
                            : ""}
                          <span className="ml-2 text-[10px] uppercase font-semibold text-gray-400">
                            Primary
                          </span>
                        </span>
                        <span className="text-xs text-gray-500 shrink-0">
                          {formatDuration(primaryScheduledMins)}
                        </span>
                      </div>
                    )}
                    {scheduleBlocks.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-gray-700">
                          {formatDateTime(b.start)} {"\u2013"}{" "}
                          {formatDateTime(b.end)}
                        </span>
                        <span className="text-xs text-gray-500 shrink-0">
                          {formatDuration(blockMinutes(b.start, b.end))}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-gray-100 pt-1 text-sm">
                      <span className="text-gray-500">
                        Total scheduled time
                      </span>
                      <span className="font-semibold text-gray-900">
                        {formatDuration(totalScheduledMins)}
                      </span>
                    </div>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-500">Created</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {formatDate(job.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Total Amount</dt>
                <dd className="text-sm font-bold text-gray-900 mt-0.5">
                  {formatCurrency(job.totalAmount)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Description */}
          {job.description && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-semibold text-gray-900 mb-2">Description</h3>
              <p className="text-sm text-gray-600 whitespace-pre-line">
                {job.description}
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Notes</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Office Notes
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 min-h-[60px]">
                  {job.notes ?? (
                    <span className="text-gray-400">No office notes</span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tech Notes
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 min-h-[60px]">
                  {job.techNotes ?? (
                    <span className="text-gray-400">No tech notes</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <JobMaterialsCard jobId={job.id} customerId={job.customerId} />
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Technicians */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Technicians</h3>
              <Can permission="jobs.assign">
                <button
                  onClick={() => {
                    setAssignModal(true);
                  }}
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  <UserPlusIcon className="h-3.5 w-3.5" />
                  Assign
                </button>
              </Can>
            </div>
            {job.technicians && job.technicians.length > 0 ? (
              <div className="space-y-3">
                {job.technicians.map((jt) => {
                  const techName = jt.technician?.user
                    ? `${jt.technician.user.firstName} ${jt.technician.user.lastName}`
                    : "Unknown";
                  return (
                    <div key={jt.id} className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-gray-600">
                          {jt.technician?.user
                            ? `${jt.technician.user.firstName.charAt(0)}${jt.technician.user.lastName.charAt(0)}`
                            : "?"}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {techName}
                        </p>
                        {jt.isLead && (
                          <p className="flex items-center gap-0.5 text-xs text-primary-600">
                            <StarIconSolid className="h-3 w-3" />
                            Lead
                          </p>
                        )}
                      </div>
                      <StatusBadge status={jt.status} category="jobTechnicianStatus" />
                      <Can permission="jobs.assign">
                        <div className="flex items-center shrink-0">
                          {!jt.isLead && (
                            <IconButton
                              label="Make lead"
                              onClick={() => {
                                handleMakeLead(jt.technicianId);
                              }}
                            >
                              <StarIcon className="h-4 w-4" />
                            </IconButton>
                          )}
                          <IconButton
                            label="Remove technician"
                            variant="danger"
                            onClick={() => {
                              setRemoveTechConfirm({
                                technicianId: jt.technicianId,
                                name: techName,
                              });
                            }}
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </Can>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No technicians assigned</p>
            )}
          </div>

          {/* Sales Reps */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Sales Reps</h3>
              <button
                type="button"
                disabled
                title="Sales rep roster coming soon"
                className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-1 text-xs text-gray-300 font-medium cursor-not-allowed"
              >
                <UserPlusIcon className="h-3.5 w-3.5" />
                Assign
              </button>
            </div>
            <p className="text-sm text-gray-400">
              No sales reps on the roster yet
            </p>
          </div>

          {/* Financial */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Financial</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Amount</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(job.totalAmount)}
                </span>
              </div>
            </div>
            {job.invoices && job.invoices.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Invoices
                </p>
                <div className="space-y-2">
                  {job.invoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="font-medium text-primary-600 hover:text-primary-700"
                      >
                        #{inv.invoiceNumber}
                      </Link>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={inv.status} type="invoice" />
                        <span className="font-medium text-gray-900">
                          {formatCurrency(inv.total)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Time Tracking */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
                <ClockIcon className="h-4 w-4 text-gray-400" />
                Time Tracking
              </h3>
              <div className="flex items-center gap-2">
                <Can permission="time.manage">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTimeEntryModal({
                        technicianId: "",
                        startTime: toLocalInputValue(new Date().toISOString()),
                        endTime: "",
                        notes: "",
                      });
                    }}
                  >
                    Add Entry
                  </Button>
                </Can>
                {currentEntry && currentEntry.jobId === job.id ? (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={clockOut.isPending}
                    onClick={() => {
                      clockOut.mutate();
                    }}
                  >
                    Clock Out
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    loading={clockIn.isPending}
                    disabled={!!currentEntry && currentEntry.jobId !== job.id}
                    onClick={() => {
                      clockIn.mutate({ jobId: job.id });
                    }}
                  >
                    Clock In
                  </Button>
                )}
              </div>
            </div>
            {currentEntry && currentEntry.jobId !== job.id && (
              <p className="text-xs text-amber-600 mb-3">
                {currentEntry.job ? (
                  <>
                    You're clocked in on{" "}
                    <Link
                      to={`/jobs/${currentEntry.job.id}`}
                      className="font-medium underline underline-offset-2 hover:text-amber-700"
                    >
                      #{currentEntry.job.jobNumber}
                      {currentEntry.job.summary
                        ? ` — ${currentEntry.job.summary}`
                        : ""}
                    </Link>
                    . Clock out there first.
                  </>
                ) : (
                  "You're already clocked in elsewhere. Clock out there first."
                )}
              </p>
            )}
            {jobTimeEntries && jobTimeEntries.length > 0 ? (
              <div className="space-y-2">
                {jobTimeEntries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-gray-900 truncate">
                        {e.user
                          ? `${e.user.firstName} ${e.user.lastName}`
                          : "Technician"}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {formatDateTime(e.startTime)}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={clsx(
                          "text-xs font-medium",
                          e.endTime ? "text-gray-600" : "text-green-600",
                        )}
                      >
                        {e.endTime ? formatDuration(e.duration) : "In progress"}
                      </span>
                      <Can permission="time.manage">
                        <button
                          type="button"
                          title="Edit entry"
                          onClick={() => {
                            setTimeEntryModal({
                              id: e.id,
                              technicianId: e.technicianId ?? "",
                              startTime: toLocalInputValue(e.startTime),
                              endTime: toLocalInputValue(e.endTime),
                              notes: e.notes ?? "",
                            });
                          }}
                          className="text-gray-400 hover:text-primary-600"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Delete entry"
                          onClick={() => {
                            setDeleteTimeConfirm(e.id);
                          }}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </Can>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm">
                  <span className="text-gray-500">Total logged</span>
                  <span className="font-semibold text-gray-900">
                    {formatDuration(
                      jobTimeEntries.reduce((s, e) => s + (e.duration ?? 0), 0),
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No time logged yet.</p>
            )}
          </div>

          {/* Signature */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <SignatureCard entityType="job" entityId={job.id} />
          </div>

          {/* Photos & Attachments */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <AttachmentGallery entityType="job" entityId={job.id} />
          </div>
        </div>
      </div>

      {/* Timeline: merged, narrated activity feed spanning this customer's
          work orders, invoices, and quotes, plus notes. */}
      <div>
        <Timeline customerId={job.customerId} />
      </div>

      {/* Update Status Modal */}
      <Modal
        isOpen={statusModal}
        onClose={() => {
          setStatusModal(false);
        }}
        title="Update Job Status"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Status
            </label>
            <select
              value={newStatus}
              onChange={(e) => {
                setNewStatus(e.target.value);
              }}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              {jobStatusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setStatusModal(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleStatusUpdate();
              }}
              loading={updateStatus.isPending}
            >
              Update Status
            </Button>
          </div>
        </div>
      </Modal>

      {/* Assign Tech Modal */}
      <Modal
        isOpen={assignModal}
        onClose={() => {
          setAssignModal(false);
          setSelectedTechIsLead(false);
        }}
        title="Assign Technician"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Technician
            </label>
            <select
              value={selectedTech}
              onChange={(e) => {
                setSelectedTech(e.target.value);
              }}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="">Choose a technician...</option>
              {techs
                .filter(
                  (t) => !job.technicians?.some((jt) => jt.technicianId === t.id),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.firstName} {t.user.lastName}
                  </option>
                ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={selectedTechIsLead}
              onChange={(e) => {
                setSelectedTechIsLead(e.target.checked);
              }}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Set as lead technician
          </label>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setAssignModal(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleAssign();
              }}
              loading={assignTech.isPending}
              disabled={!selectedTech}
            >
              Assign
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add/Edit Time Entry Modal (admin-only, time.manage) */}
      <Modal
        isOpen={!!timeEntryModal}
        onClose={() => {
          setTimeEntryModal(null);
        }}
        title={timeEntryModal?.id ? "Edit Time Entry" : "Add Time Entry"}
      >
        {timeEntryModal && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Technician
              </label>
              <select
                value={timeEntryModal.technicianId}
                onChange={(e) => {
                  setTimeEntryModal({
                    ...timeEntryModal,
                    technicianId: e.target.value,
                  });
                }}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">Choose a technician...</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.firstName} {t.user.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start
                </label>
                <input
                  type="datetime-local"
                  value={timeEntryModal.startTime}
                  onChange={(e) => {
                    setTimeEntryModal({
                      ...timeEntryModal,
                      startTime: e.target.value,
                    });
                  }}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  value={timeEntryModal.endTime}
                  onChange={(e) => {
                    setTimeEntryModal({
                      ...timeEntryModal,
                      endTime: e.target.value,
                    });
                  }}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes
              </label>
              <textarea
                value={timeEntryModal.notes}
                onChange={(e) => {
                  setTimeEntryModal({
                    ...timeEntryModal,
                    notes: e.target.value,
                  });
                }}
                rows={2}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setTimeEntryModal(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (
                    !timeEntryModal.startTime ||
                    (!timeEntryModal.id && !timeEntryModal.technicianId)
                  ) {
                    return;
                  }
                  const payload = {
                    technicianId: timeEntryModal.technicianId,
                    jobId: job.id,
                    startTime: new Date(timeEntryModal.startTime).toISOString(),
                    endTime: timeEntryModal.endTime
                      ? new Date(timeEntryModal.endTime).toISOString()
                      : null,
                    notes: timeEntryModal.notes || undefined,
                  };
                  if (timeEntryModal.id) {
                    updateTimeEntry.mutate(
                      { id: timeEntryModal.id, ...payload },
                      {
                        onSuccess: () => {
                          setTimeEntryModal(null);
                        },
                      },
                    );
                  } else {
                    createTimeEntry.mutate(payload, {
                      onSuccess: () => {
                        setTimeEntryModal(null);
                      },
                    });
                  }
                }}
                loading={createTimeEntry.isPending || updateTimeEntry.isPending}
                disabled={
                  !timeEntryModal.startTime ||
                  (!timeEntryModal.id && !timeEntryModal.technicianId)
                }
              >
                {timeEntryModal.id ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTimeConfirm}
        onClose={() => {
          setDeleteTimeConfirm(null);
        }}
        onConfirm={() => {
          if (deleteTimeConfirm) {
            deleteTimeEntry.mutate(deleteTimeConfirm, {
              onSuccess: () => {
                setDeleteTimeConfirm(null);
              },
            });
          }
        }}
        title="Delete time entry"
        message="This will permanently remove this time entry. This can't be undone."
        confirmLabel="Delete"
        loading={deleteTimeEntry.isPending}
      />

      <ConfirmDialog
        isOpen={archiveConfirm}
        onClose={() => {
          setArchiveConfirm(false);
        }}
        onConfirm={() => {
          archiveJob.mutate(id ?? "", {
            onSuccess: () => {
              setArchiveConfirm(false);
            },
          });
        }}
        title="Archive work order"
        message={`Archive work order #${job.jobNumber}? It's hidden from active lists and the dispatch board, but nothing is deleted -- you can restore it anytime.`}
        confirmLabel="Archive"
        loading={archiveJob.isPending}
      />

      <ConfirmDialog
        isOpen={!!removeTechConfirm}
        onClose={() => {
          setRemoveTechConfirm(null);
        }}
        onConfirm={() => {
          if (removeTechConfirm) {
            removeTech.mutate(
              { jobId: id ?? "", technicianId: removeTechConfirm.technicianId },
              {
                onSuccess: () => {
                  setRemoveTechConfirm(null);
                },
              },
            );
          }
        }}
        title="Remove technician"
        message={`Remove ${removeTechConfirm?.name ?? "this technician"} from this work order?`}
        confirmLabel="Remove"
        loading={removeTech.isPending}
      />
    </div>
  );
}

// Materials & equipment used on this job: serialized units installed here plus
// purchase orders raised for it.
function JobMaterialsCard({
  jobId,
  customerId,
}: {
  jobId: string;
  customerId: string;
}) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canViewPurchasing =
    can("purchasing.manage") || can("purchasing.receive");
  const { data: serials } = useSerializedUnits({ jobId, limit: 50 });
  const { data: pos } = usePurchaseOrders(
    { jobId, limit: 50 },
    { enabled: canViewPurchasing },
  );
  const { data: parts } = useJobParts(jobId);
  const { data: laborTimeEntries } = useJobTimeEntries(jobId);
  const { data: laborTechnicians } = useTechnicians();
  const reverseTxn = useReverseTransaction();
  const uninstall = useUninstallSerializedUnit();
  const [installOpen, setInstallOpen] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);

  const units = serials?.data ?? [];
  const orders = pos?.data ?? [];
  const usedParts = parts ?? [];
  const partsTotal = usedParts.reduce((sum, p) => sum + p.total, 0);

  // Labor cost: each technician's own logged hours on this job x their own
  // pay rate - not a single blended rate for whoever worked on it. Rows with
  // no rate set yet are called out rather than silently costed at $0.
  const laborRows = (() => {
    const technicians = laborTechnicians?.data ?? [];
    const byTech = new Map<
      string,
      { name: string; minutes: number; rate: number | null }
    >();
    for (const e of laborTimeEntries ?? []) {
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
  const laborCostTotal = laborRows.reduce(
    (sum, r) => sum + (r.rate ? (r.minutes / 60) * r.rate : 0),
    0,
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">
          Materials &amp; Equipment
        </h3>
        <div className="flex items-center gap-3">
          <Can permission={["inventory.manage", "inventory.issueToJob"]}>
            <button
              onClick={() => {
                setAddPartOpen(true);
              }}
              className="inline-flex items-center min-h-[44px] sm:min-h-0 px-1 text-sm sm:text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Add part
            </button>
            <button
              onClick={() => {
                setInstallOpen(true);
              }}
              className="inline-flex items-center min-h-[44px] sm:min-h-0 px-1 text-sm sm:text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Install unit
            </button>
          </Can>
          <Can permission="purchasing.manage">
            <button
              onClick={() => {
                navigate("/purchasing", { state: { jobId, customerId } });
              }}
              className="inline-flex items-center min-h-[44px] sm:min-h-0 px-1 text-sm sm:text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Create PO
            </button>
          </Can>
        </div>
      </div>

      <div className="space-y-4">
        {/* Parts consumed from truck/warehouse stock */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Parts used</p>
          {usedParts.length > 0 ? (
            <div className="space-y-1.5">
              {usedParts.map((p) => (
                <div
                  key={p.transactionId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-gray-700">
                    {p.quantityUsed}× {p.name}
                    <span className="font-mono text-xs text-gray-400 ml-1.5">
                      {p.stockLocation?.code ?? ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-gray-600">
                      {formatCurrency(p.total)}
                    </span>
                    <Can
                      permission={["inventory.manage", "inventory.issueToJob"]}
                    >
                      <IconButton
                        label="Remove part (returns stock to the location)"
                        variant="danger"
                        onClick={() => {
                          reverseTxn.mutate({
                            id: p.transactionId,
                            reason: "Removed from job",
                          });
                        }}
                        disabled={reverseTxn.isPending}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </IconButton>
                    </Can>
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-sm pt-1.5 border-t border-gray-100">
                <span className="text-gray-500">Parts total (suggested)</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(partsTotal)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No parts used yet</p>
          )}
        </div>

        {/* Each technician's own logged time on this job, costed at their own
            pay rate - set from Technicians → Pay Rates (admin only). */}
        <Can permission="technicians.payRates">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Labor</p>
            {laborRows.length > 0 ? (
              <div className="space-y-1.5">
                {laborRows.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700">
                      {r.name}
                      <span className="text-xs text-gray-400 ml-1.5">
                        {(r.minutes / 60).toFixed(2)}h
                        {r.rate
                          ? ` @ ${formatCurrency(r.rate)}/hr`
                          : " \u2014 no rate set"}
                      </span>
                    </span>
                    <span className="text-gray-600">
                      {r.rate
                        ? formatCurrency((r.minutes / 60) * r.rate)
                        : "-"}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between text-sm pt-1.5 border-t border-gray-100">
                  <span className="text-gray-500">Labor cost total</span>
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(laborCostTotal)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No time logged yet</p>
            )}
          </div>
        </Can>

        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">
            Installed serialized units
          </p>
          {units.length > 0 ? (
            <ul className="space-y-1.5">
              {units.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-gray-700 min-w-0">
                    {u.inventoryItem?.name ?? "Unit"}{" "}
                    <span className="font-mono text-xs text-gray-400">
                      {u.serialNumber}
                    </span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge
                      status={u.status}
                      category="serializedUnitStatus"
                    />
                    <Can
                      permission={["inventory.manage", "inventory.issueToJob"]}
                    >
                      <IconButton
                        label="Remove unit from job (return to stock)"
                        variant="danger"
                        onClick={() => {
                          uninstall.mutate(u.id);
                        }}
                        disabled={uninstall.isPending}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </IconButton>
                    </Can>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No units installed yet</p>
          )}
        </div>

        <Can permission={["purchasing.manage", "purchasing.receive"]}>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">
              Purchase orders
            </p>
            {orders.length > 0 ? (
              <ul className="space-y-1.5">
                {orders.map((po) => (
                  <li
                    key={po.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <Link
                      to={`/purchasing/${po.id}`}
                      className="font-mono text-xs text-primary-600 hover:text-primary-700"
                    >
                      {po.poNumber}
                    </Link>
                    <StatusBadge status={po.status} category="poStatus" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">No purchase orders</p>
            )}
          </div>
        </Can>
      </div>

      <InstallSerialModal
        isOpen={installOpen}
        defaultCustomerId={customerId}
        defaultJobId={jobId}
        onClose={() => {
          setInstallOpen(false);
        }}
      />
      <AddPartModal
        isOpen={addPartOpen}
        jobId={jobId}
        onClose={() => {
          setAddPartOpen(false);
        }}
      />
    </div>
  );
}

// Pick an item + source location (usually the tech's truck) and issue it to
// the job. Stock is decremented immediately; the movement is reversible.
function AddPartModal({
  isOpen,
  jobId,
  onClose,
}: {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
}) {
  const issue = useIssueToJob();
  const { data: items } = useInventoryItems();
  const { data: locations } = useStockLocations({ active: "true" });
  const { data: techsData } = useTechnicians();
  const currentUser = useAuthStore((s) => s.user);

  const [inventoryItemId, setItemId] = useState("");
  const [stockLocationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [partSearch, setPartSearch] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);

  // Default the source location to the tech's own assigned truck, so a
  // technician issuing a part in the field doesn't have to hunt through every
  // truck/warehouse to find theirs. Still fully editable (e.g. to borrow from
  // another truck or the warehouse).
  const myVehicleId = techsData?.data.find((t) => t.userId === currentUser?.id)
    ?.vehicle?.id;
  const myLocationId = (locations ?? []).find(
    (l) => l.vehicleId === myVehicleId,
  )?.id;
  useEffect(() => {
    if (isOpen && myLocationId && !stockLocationId) {
      setLocationId(myLocationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, myLocationId]);

  if (!isOpen) return null;

  const item = (items ?? []).find((i) => i.id === inventoryItemId);
  const term = partSearch.trim().toLowerCase();
  const filteredItems = term
    ? (items ?? []).filter(
        (i) =>
          // Keep the currently-selected part visible even if it no longer
          // matches the search, so the <select> value never goes blank.
          i.id === inventoryItemId ||
          i.name.toLowerCase().includes(term) ||
          i.sku.toLowerCase().includes(term),
      )
    : (items ?? []);

  // Scanned barcode -> find the part. A physical barcode is usually a vendor/
  // manufacturer code, not our internal SKU, so match progressively: internal
  // SKU, then any vendor SKU, then a loose substring across SKU + name.
  const handleScan = (code: string) => {
    setScannerOpen(false);
    const scanned = code.trim().toLowerCase();
    if (!scanned) return;
    const all = items ?? [];
    const match =
      all.find((i) => i.sku.toLowerCase() === scanned) ??
      all.find((i) =>
        (i.vendors ?? []).some(
          (v) => v.vendorSku?.toLowerCase() === scanned,
        ),
      ) ??
      all.find(
        (i) =>
          i.sku.toLowerCase().includes(scanned) ||
          i.name.toLowerCase().includes(scanned),
      );
    if (match) {
      setItemId(match.id);
      setPartSearch("");
    } else {
      toast.error(`No part matching \u201C${code}\u201D`);
    }
  };
  const available = num(
    item?.stock?.find((s) => s.stockLocationId === stockLocationId)
      ?.quantityOnHand,
  );

  const inputClass =
    "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

  return (
    <Modal isOpen onClose={onClose} title="Add part to job" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Part
          </label>
          <div className="flex items-center gap-2 mb-2">
            <input
              value={partSearch}
              onChange={(e) => {
                setPartSearch(e.target.value);
              }}
              placeholder="Search name or SKU…"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => {
                setScannerOpen(true);
              }}
              aria-label="Scan barcode"
              title="Scan barcode"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <QrCodeIcon className="h-5 w-5" />
            </button>
          </div>
          <select
            value={inventoryItemId}
            onChange={(e) => {
              setItemId(e.target.value);
            }}
            className={inputClass}
          >
            <option value="">Select part...</option>
            {filteredItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            From location
          </label>
          <select
            value={stockLocationId}
            onChange={(e) => {
              setLocationId(e.target.value);
            }}
            className={inputClass}
          >
            <option value="">Select truck/warehouse...</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
          {inventoryItemId && stockLocationId && (
            <p className="text-xs text-gray-500 mt-1">
              Available here: <span className="font-semibold">{available}</span>
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Quantity
          </label>
          <NumberInput
            min={0}
            step="any"
            value={quantity}
            onChange={(n) => {
              setQuantity(n ?? 0);
            }}
            className={inputClass}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={issue.isPending}
            disabled={!inventoryItemId || !stockLocationId || !(quantity > 0)}
            onClick={() => {
              const vars = {
                jobId,
                inventoryItemId,
                stockLocationId,
                quantity,
              };
              const reset = () => {
                setItemId("");
                setLocationId("");
                setQuantity(1);
                onClose();
              };
              // Offline the mutation is paused, so its promise never resolves --
              // queue it (replays via the keyed offline default) and close now
              // instead of leaving the sheet spinning.
              if (!navigator.onLine) {
                issue.mutate(vars);
                toast.success("Saved — will sync when back online");
                reset();
                return;
              }
              void issue.mutateAsync(vars).then(reset);
            }}
          >
            Issue part
          </Button>
        </div>
      </div>
      {scannerOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner
            isOpen
            onClose={() => {
              setScannerOpen(false);
            }}
            onDetected={handleScan}
          />
        </Suspense>
      )}
    </Modal>
  );
}
