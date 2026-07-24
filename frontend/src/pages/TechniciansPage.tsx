import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDaysIcon,
  CurrencyDollarIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  useTechnicians,
  useUpdateTechnicianPayRate,
} from "../hooks/useTechnicians";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import { NumberInput } from "../components/ui/NumberInput";
import { Can } from "../components/ui/Can";
import { PageSpinner } from "../components/ui/Spinner";
import type { Technician } from "../types";

export default function TechniciansPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useTechnicians();
  const technicians = data?.data ?? [];
  const [payRatesOpen, setPayRatesOpen] = useState(false);

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {technicians.length} technicians
        </p>
        <Can permission="technicians.payRates">
          <Button
            variant="outline"
            size="sm"
            icon={<CurrencyDollarIcon className="h-4 w-4" />}
            onClick={() => {
              setPayRatesOpen(true);
            }}
          >
            Pay Rates
          </Button>
        </Can>
      </div>

      {technicians.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <EmptyState
            icon={<WrenchScrewdriverIcon />}
            title="No technicians found"
            description="Technicians are created from user accounts with the technician role."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {technicians.map((tech) => (
            <div
              key={tech.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                  <span className="text-lg font-bold text-primary-700">
                    {tech.user.firstName.charAt(0)}
                    {tech.user.lastName.charAt(0)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">
                    {tech.user.firstName} {tech.user.lastName}
                  </h3>
                  <p className="text-xs text-gray-500">ID: {tech.employeeId}</p>
                  <Badge
                    className={clsx(
                      "mt-2",
                      tech.isAvailable
                        ? "bg-green-100 text-green-700"
                        : "bg-orange-100 text-orange-700",
                    )}
                  >
                    {tech.isAvailable ? "Available" : "Busy"}
                  </Badge>
                </div>
              </div>

              {/* Skills */}
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {tech.skills.length > 0 ? (
                    tech.skills.map((skill) => (
                      <Badge key={skill} className="bg-gray-100 text-gray-600">
                        {skill}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">
                      No skills listed
                    </span>
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <div className="text-xs text-gray-500 truncate">
                  {tech.user.email}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<CalendarDaysIcon className="h-4 w-4" />}
                  onClick={() => {
                    navigate("/dispatch");
                  }}
                >
                  Schedule
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PayRatesModal
        isOpen={payRatesOpen}
        technicians={technicians}
        onClose={() => {
          setPayRatesOpen(false);
        }}
      />
    </div>
  );
}

// Admin-only: lists every technician's going hourly pay rate, editable in
// place. Rates set here automatically cost out each technician's own logged
// time on a job's Materials & Equipment card (see JobDetailPage).
function PayRatesModal({
  isOpen,
  technicians,
  onClose,
}: {
  isOpen: boolean;
  technicians: Technician[];
  onClose: () => void;
}) {
  const updatePayRate = useUpdateTechnicianPayRate();
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Snapshot current rates into editable drafts each time the modal opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setDrafts(
      Object.fromEntries(technicians.map((t) => [t.id, t.payRate ?? null])),
    );
  }
  if (!isOpen && wasOpen) setWasOpen(false);

  if (!isOpen) return null;

  const save = (id: string) => {
    setSavingId(id);
    void updatePayRate
      .mutateAsync({ id, payRate: drafts[id] ?? null })
      .finally(() => {
        setSavingId(null);
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Technician Pay Rates"
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Set each technician's going hourly pay rate. Whenever they log time
          on a work order, it's automatically applied as a labor cost on that
          job's Materials &amp; Equipment card.
        </p>
        {technicians.length === 0 ? (
          <p className="text-sm text-gray-400">No technicians found.</p>
        ) : (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
            {technicians.map((t) => {
              const draft = drafts[t.id] ?? null;
              const dirty = draft !== (t.payRate ?? null);
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {t.user.firstName} {t.user.lastName}
                    </p>
                    <p className="text-xs text-gray-400">{t.employeeId}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm text-gray-400">$</span>
                    <NumberInput
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={draft}
                      onChange={(n) => {
                        setDrafts((d) => ({ ...d, [t.id]: n }));
                      }}
                      className="w-24 text-right text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <span className="text-xs text-gray-400">/hr</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={savingId === t.id}
                    disabled={!dirty}
                    onClick={() => {
                      save(t.id);
                    }}
                  >
                    Save
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
