import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  useEquipmentList,
  useEquipmentItem,
  useCreateEquipment,
  useUpdateEquipment,
  useDeleteEquipment,
} from "../hooks/useEquipment";
import { useCustomers, useCustomer } from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { LookupSelect } from "../components/ui/LookupSelect";
import Badge, { StatusBadge } from "../components/ui/Badge";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatDate } from "../utils/formatters";
import type { Equipment } from "../types";

const SELECT_CLASS =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

const WARRANTY_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Under warranty" },
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
];

interface WarrantyInfo {
  label: string;
  color: string;
}

function warrantyInfo(expiry: string | undefined): WarrantyInfo {
  if (!expiry)
    return { label: "No warranty", color: "bg-gray-100 text-gray-600" };
  const end = new Date(expiry).getTime();
  const now = Date.now();
  const in90 = now + 90 * 24 * 60 * 60 * 1000;
  if (end < now) return { label: "Expired", color: "bg-red-100 text-red-800" };
  if (end <= in90)
    return { label: "Expires soon", color: "bg-orange-100 text-orange-800" };
  return { label: "Active", color: "bg-green-100 text-green-800" };
}

function customerName(eq: Equipment): string {
  if (!eq.customer) return "—";
  const { firstName, lastName, companyName } = eq.customer;
  if (companyName) return companyName;
  return `${firstName} ${lastName}`;
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  customerId: z.string().optional(),
  locationId: z.string().optional(),
  type: z.string().optional(),
  condition: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  installDate: z.string().optional(),
  warrantyExpiry: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const blank = (v: string | undefined) => (v === "" ? undefined : v);
const toIso = (v: string | undefined) =>
  v ? new Date(v).toISOString() : undefined;

function EquipmentModal({
  isOpen,
  onClose,
  equipment,
}: {
  isOpen: boolean;
  onClose: () => void;
  equipment: Equipment | null;
}) {
  const isEditing = Boolean(equipment);
  const create = useCreateEquipment();
  const update = useUpdateEquipment();
  const remove = useDeleteEquipment();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: customersData } = useCustomers({ limit: 200 });
  const customers = customersData?.data ?? [];

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: equipment
      ? {
          name: equipment.name,
          customerId: equipment.customerId ?? "",
          locationId: equipment.locationId ?? "",
          type: equipment.type ?? "",
          condition: equipment.condition ?? "",
          manufacturer: equipment.manufacturer ?? "",
          model: equipment.model ?? "",
          serialNumber: equipment.serialNumber ?? "",
          installDate: equipment.installDate
            ? equipment.installDate.slice(0, 10)
            : "",
          warrantyExpiry: equipment.warrantyExpiry
            ? equipment.warrantyExpiry.slice(0, 10)
            : "",
          notes: equipment.notes ?? "",
        }
      : {},
  });

  // The selected customer's locations populate the location dropdown.
  const customerId = watch("customerId");
  const { data: selectedCustomer } = useCustomer(customerId ?? "");
  const locations = selectedCustomer?.locations ?? [];

  // Service history (jobs at this unit's location) — only when editing.
  const { data: detail } = useEquipmentItem(equipment?.id ?? "");
  const history = detail?.serviceHistory ?? [];

  const close = () => {
    reset();
    setConfirmDelete(false);
    onClose();
  };

  const onSubmit = async (data: FormData) => {
    const payload: Partial<Equipment> = {
      name: data.name,
      customerId: blank(data.customerId),
      locationId: blank(data.locationId),
      type: blank(data.type),
      condition: blank(data.condition),
      manufacturer: blank(data.manufacturer),
      model: blank(data.model),
      serialNumber: blank(data.serialNumber),
      installDate: toIso(data.installDate),
      warrantyExpiry: toIso(data.warrantyExpiry),
      notes: blank(data.notes),
    };
    if (equipment) {
      await update.mutateAsync({ id: equipment.id, ...payload });
    } else {
      await create.mutateAsync(payload);
    }
    close();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={close}
        title={isEditing ? "Edit Equipment" : "Add Equipment"}
        size="lg"
      >
        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          className="space-y-4"
        >
          <Input
            label="Name"
            placeholder="Carrier 3-Ton AC Condenser"
            error={errors.name?.message}
            {...register("name")}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Customer
              </label>
              <select className={SELECT_CLASS} {...register("customerId")}>
                <option value="">Unassigned</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                    {c.companyName ? ` (${c.companyName})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Location
              </label>
              <select
                className={SELECT_CLASS}
                disabled={!customerId}
                {...register("locationId")}
              >
                <option value="">
                  {customerId ? "Select location…" : "Select a customer first"}
                </option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name ? `${loc.name} — ` : ""}
                    {loc.address}, {loc.city}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Type
              </label>
              <LookupSelect
                category="equipmentType"
                placeholder="Select type…"
                {...register("type")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Condition
              </label>
              <LookupSelect
                category="equipmentCondition"
                placeholder="Select condition…"
                {...register("condition")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Manufacturer"
              placeholder="Carrier"
              {...register("manufacturer")}
            />
            <Input
              label="Model #"
              placeholder="24ACC636A003"
              {...register("model")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Serial #"
              placeholder="CAR-AC-0098213"
              {...register("serialNumber")}
            />
            <div />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Install date"
              type="date"
              {...register("installDate")}
            />
            <Input
              label="Warranty expires"
              type="date"
              {...register("warrantyExpiry")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes
            </label>
            <textarea
              rows={2}
              className={clsx(SELECT_CLASS, "resize-none")}
              placeholder="Service notes, warnings, history…"
              {...register("notes")}
            />
          </div>

          {/* Per-unit service history */}
          {isEditing && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-semibold text-gray-900 mb-2">
                Service history
              </p>
              {history.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No service records for this unit's location yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {history.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-primary-600">
                          #{job.jobNumber}
                        </span>
                        <span className="text-gray-600 ml-2 truncate">
                          {job.summary}
                        </span>
                        <span className="block text-xs text-gray-400">
                          {formatDate(job.scheduledStart)}
                        </span>
                      </div>
                      <StatusBadge status={job.status} type="job" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            {isEditing ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                icon={<TrashIcon className="h-4 w-4" />}
                onClick={() => {
                  setConfirmDelete(true);
                }}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={isSubmitting || create.isPending || update.isPending}
              >
                {isEditing ? "Save Changes" : "Add Equipment"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {equipment && (
        <ConfirmDialog
          isOpen={confirmDelete}
          onClose={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            remove.mutate(equipment.id, {
              onSuccess: () => {
                setConfirmDelete(false);
                close();
              },
            });
          }}
          title="Delete equipment"
          message={`Delete "${equipment.name}"? This removes the asset record and its service history reference.`}
          confirmLabel="Delete"
          loading={remove.isPending}
        />
      )}
    </>
  );
}

export default function EquipmentPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [warranty, setWarranty] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);

  const { getLabel: getTypeLabel } = useLookup("equipmentType");
  const { getLabel: getConditionLabel, getColor: getConditionColor } =
    useLookup("equipmentCondition");

  const { data, isLoading } = useEquipmentList({
    page,
    limit: 20,
    search: search || undefined,
    warranty: warranty !== "all" ? warranty : undefined,
  });

  const equipment = data?.data ?? [];
  const pagination = data?.pagination;

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (eq: Equipment) => {
    setEditing(eq);
    setModalOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} units tracked` : ""}
        </p>
        <Button icon={<PlusIcon className="h-4 w-4" />} onClick={openNew}>
          Add Equipment
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search name, serial, manufacturer…"
          className="sm:w-80"
        />
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
          {WARRANTY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setWarranty(f.value);
                setPage(1);
              }}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                warranty === f.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : equipment.length === 0 ? (
          <EmptyState
            title="No equipment found"
            description="Track customer assets — serial numbers, warranties, and service history."
            action={{ label: "Add Equipment", onClick: openNew }}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Equipment
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Customer
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Serial #
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Installed
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Warranty
                    </th>
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Condition
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {equipment.map((eq) => {
                    const w = warrantyInfo(eq.warrantyExpiry);
                    return (
                      <tr
                        key={eq.id}
                        onClick={() => {
                          openEdit(eq);
                        }}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-5">
                          <p className="font-medium text-gray-900">{eq.name}</p>
                          <p className="text-xs text-gray-500">
                            {[
                              eq.type ? getTypeLabel(eq.type) : null,
                              eq.manufacturer,
                              eq.model,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </td>
                        <td className="py-3.5 px-3 text-gray-700">
                          {customerName(eq)}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-xs text-gray-600">
                          {eq.serialNumber ?? "—"}
                        </td>
                        <td className="py-3.5 px-3 text-gray-500 text-xs">
                          {formatDate(eq.installDate)}
                        </td>
                        <td className="py-3.5 px-3">
                          <Badge className={w.color}>{w.label}</Badge>
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {formatDate(eq.warrantyExpiry)}
                          </span>
                        </td>
                        <td className="py-3.5 px-5">
                          {eq.condition ? (
                            <Badge className={getConditionColor(eq.condition)}>
                              {getConditionLabel(eq.condition)}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pagination && (
              <div className="px-5 py-4 border-t border-gray-100">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </div>

      <EquipmentModal
        key={editing?.id ?? "new"}
        isOpen={modalOpen}
        equipment={editing}
        onClose={() => {
          setModalOpen(false);
        }}
      />
    </div>
  );
}
