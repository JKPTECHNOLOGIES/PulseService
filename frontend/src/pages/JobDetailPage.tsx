import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  PencilIcon,
  ChevronRightIcon,
  UserPlusIcon,
  CheckCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useJob } from "../hooks/useJobs";
import { useUpdateJobStatus, useAssignTechnician } from "../hooks/useJobs";
import { useTechnicians } from "../hooks/useTechnicians";
import {
  useCurrentTimeEntry,
  useJobTimeEntries,
  useClockIn,
  useClockOut,
} from "../hooks/useTime";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import { StatusBadge } from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import SignatureCard from "../components/ui/SignatureCard";
import { PageSpinner } from "../components/ui/Spinner";
import { directionsUrl } from "../lib/maps";
import {
  formatCurrency,
  formatDateTime,
  formatDate,
  capitalize,
} from "../utils/formatters";

function formatDuration(mins?: number | null): string {
  if (!mins || mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${String(h)}h ${String(m)}m` : `${String(m)}m`;
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
          "h-7 w-7 rounded-full border-2 flex items-center justify-center transition-colors",
          done
            ? "bg-primary-600 border-primary-600"
            : active
              ? "bg-white border-primary-600"
              : "bg-white border-gray-200",
        )}
      >
        {done && <CheckCircleIcon className="h-4 w-4 text-oncolor" />}
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
  const [newStatus, setNewStatus] = useState("");
  const [selectedTech, setSelectedTech] = useState("");

  const { data: job, isLoading } = useJob(id ?? "");
  const { data: techsData } = useTechnicians();
  const { data: currentEntry } = useCurrentTimeEntry();
  const { data: jobTimeEntries } = useJobTimeEntries(id ?? "");
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const updateStatus = useUpdateJobStatus();
  const assignTech = useAssignTechnician();
  const { options: jobStatusOptions } = useLookup("jobStatus");

  if (isLoading) return <PageSpinner />;
  if (!job)
    return <div className="text-center py-12 text-gray-500">Job not found</div>;

  const techs = techsData?.data ?? [];
  const timelineSteps = [
    "new",
    "scheduled",
    "dispatched",
    "in_progress",
    "completed",
  ];
  const currentIdx = timelineSteps.indexOf(job.status);

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
      });
      setAssignModal(false);
      setSelectedTech("");
    }
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
                Job #{job.jobNumber}
              </h2>
              <StatusBadge status={job.status} type="job" />
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
          </div>
          <div className="grid grid-cols-2 gap-2 shrink-0 sm:flex sm:flex-wrap">
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
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <div className="flex items-start justify-between relative">
            <div className="absolute top-3.5 left-0 right-0 h-0.5 bg-gray-200 -z-0" />
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
            <h3 className="font-semibold text-gray-900 mb-4">Job Details</h3>
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
                        href={directionsUrl([
                          job.location.address,
                          job.location.city,
                          job.location.state,
                          job.location.zip,
                        ])}
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
                <dt className="text-xs text-gray-500">Job Type</dt>
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
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Technicians */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Technicians</h3>
              <button
                onClick={() => {
                  setAssignModal(true);
                }}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                <UserPlusIcon className="h-3.5 w-3.5" />
                Assign
              </button>
            </div>
            {job.technicians && job.technicians.length > 0 ? (
              <div className="space-y-3">
                {job.technicians.map((jt) => (
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
                        {jt.technician?.user
                          ? `${jt.technician.user.firstName} ${jt.technician.user.lastName}`
                          : "Unknown"}
                      </p>
                      {jt.isLead && (
                        <p className="text-xs text-primary-600">Lead</p>
                      )}
                    </div>
                    <StatusBadge status={jt.status} type="job" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No technicians assigned</p>
            )}
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
          </div>

          {/* Time Tracking */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
                <ClockIcon className="h-4 w-4 text-gray-400" />
                Time Tracking
              </h3>
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
            {currentEntry && currentEntry.jobId !== job.id && (
              <p className="text-xs text-amber-600 mb-3">
                You're clocked in on another job. Clock out there first.
              </p>
            )}
            {jobTimeEntries && jobTimeEntries.length > 0 ? (
              <div className="space-y-2">
                {jobTimeEntries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-gray-900 truncate">
                        {e.user
                          ? `${e.user.firstName} ${e.user.lastName}`
                          : "Technician"}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDateTime(e.startTime)}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        "text-xs font-medium shrink-0",
                        e.endTime ? "text-gray-600" : "text-green-600",
                      )}
                    >
                      {e.endTime ? formatDuration(e.duration) : "In progress"}
                    </span>
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
              {techs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.user.firstName} {t.user.lastName}
                </option>
              ))}
            </select>
          </div>
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
    </div>
  );
}
