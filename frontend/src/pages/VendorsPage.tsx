import { useState } from "react";
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { TableSkeleton } from "../components/ui/Skeleton";
import { Can } from "../components/ui/Can";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import {
  useVendors,
  useSaveVendor,
  useDeleteVendor,
} from "../hooks/useVendors";
import type { Vendor } from "../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const { data: vendors, isLoading } = useVendors(search ? { search } : {});
  const save = useSaveVendor();
  const del = useDeleteVendor();

  const [form, setForm] = useState<Partial<Vendor> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);

  const columns: Column<Vendor>[] = [
    {
      key: "vendorNumber",
      header: "Number",
      sortValue: (v) => v.vendorNumber,
      exportValue: (v) => v.vendorNumber,
      render: (v) => (
        <span className="font-mono text-xs text-gray-600">
          {v.vendorNumber}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (v) => v.name.toLowerCase(),
      exportValue: (v) => v.name,
      render: (v) => (
        <span className="font-medium text-gray-900">{v.name}</span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      exportValue: (v) => v.contactName ?? "",
      render: (v) => (
        <div className="text-xs text-gray-500">
          {v.contactName && <div>{v.contactName}</div>}
          {v.email && <div>{v.email}</div>}
          {v.phone && <div>{v.phone}</div>}
        </div>
      ),
    },
    {
      key: "paymentTerms",
      header: "Terms",
      exportValue: (v) => v.paymentTerms ?? "",
      render: (v) => (
        <span className="text-gray-500 text-xs">{v.paymentTerms ?? "-"}</span>
      ),
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      sortValue: (v) => v._count?.items ?? 0,
      exportValue: (v) => v._count?.items ?? 0,
      render: (v) => (
        <span className="text-gray-500 text-xs">{v._count?.items ?? 0}</span>
      ),
    },
    {
      key: "pos",
      header: "POs",
      align: "right",
      sortValue: (v) => v._count?.purchaseOrders ?? 0,
      exportValue: (v) => v._count?.purchaseOrders ?? 0,
      render: (v) => (
        <span className="text-gray-500 text-xs">
          {v._count?.purchaseOrders ?? 0}
        </span>
      ),
    },
  ];

  const rowActions = (v: Vendor) => (
    <Can permission="vendors.manage">
      <IconButton
        label="Edit"
        onClick={() => {
          setForm(v);
        }}
      >
        <PencilSquareIcon className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Deactivate"
        onClick={() => {
          setConfirmDelete(v);
        }}
      >
        <TrashIcon className="h-4 w-4" />
      </IconButton>
    </Can>
  );

  if (isLoading) return <TableSkeleton rows={6} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search vendors..."
            className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-64"
          />
          <p className="text-sm text-gray-500">
            {vendors?.length ?? 0} vendors
          </p>
        </div>
        <Can permission="vendors.manage">
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              setForm({});
            }}
          >
            New Vendor
          </Button>
        </Can>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {!vendors || vendors.length === 0 ? (
          <EmptyState
            title="No vendors"
            description="Add the vendors you buy parts and equipment from."
          />
        ) : (
          <DataTable<Vendor>
            columns={columns}
            rows={vendors}
            getRowId={(v) => v.id}
            sort={sort}
            onSortChange={setSort}
            csvFilename="vendors"
            rowActions={rowActions}
          />
        )}
      </div>

      <VendorFormModal
        vendor={form}
        pending={save.isPending}
        onClose={() => {
          setForm(null);
        }}
        onSubmit={async (payload) => {
          await save.mutateAsync(payload);
          setForm(null);
        }}
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Deactivate vendor?"
        message={`"${confirmDelete?.name ?? ""}" will be hidden from new purchase orders. Existing records are kept.`}
        confirmLabel="Deactivate"
        onClose={() => {
          setConfirmDelete(null);
        }}
        onConfirm={() => {
          if (confirmDelete) void del.mutateAsync(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}

function VendorFormModal({
  vendor,
  pending,
  onClose,
  onSubmit,
}: {
  vendor: Partial<Vendor> | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: Partial<Vendor> & { id?: string }) => Promise<void>;
}) {
  const editing = !!vendor?.id;
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [fields, setFields] = useState<Partial<Vendor>>({});

  if (vendor && loadedId !== (vendor.id ?? "new")) {
    setLoadedId(vendor.id ?? "new");
    setFields({
      name: vendor.name ?? "",
      contactName: vendor.contactName ?? "",
      email: vendor.email ?? "",
      phone: vendor.phone ?? "",
      paymentTerms: vendor.paymentTerms ?? "",
      city: vendor.city ?? "",
      state: vendor.state ?? "",
    });
  }

  const set = (k: keyof Vendor, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
  };

  if (!vendor) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? `Edit: ${vendor.name ?? ""}` : "New vendor"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            ...(editing ? { id: vendor.id } : {}),
            ...fields,
          });
        }}
        className="space-y-4"
      >
        <Field label="Name">
          <input
            value={fields.name ?? ""}
            onChange={(e) => {
              set("name", e.target.value);
            }}
            required
            className={INPUT}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact name">
            <input
              value={fields.contactName ?? ""}
              onChange={(e) => {
                set("contactName", e.target.value);
              }}
              className={INPUT}
            />
          </Field>
          <Field label="Payment terms">
            <input
              value={fields.paymentTerms ?? ""}
              onChange={(e) => {
                set("paymentTerms", e.target.value);
              }}
              placeholder="e.g. Net 30"
              className={INPUT}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              type="email"
              value={fields.email ?? ""}
              onChange={(e) => {
                set("email", e.target.value);
              }}
              className={INPUT}
            />
          </Field>
          <Field label="Phone">
            <input
              value={fields.phone ?? ""}
              onChange={(e) => {
                set("phone", e.target.value);
              }}
              className={INPUT}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input
              value={fields.city ?? ""}
              onChange={(e) => {
                set("city", e.target.value);
              }}
              className={INPUT}
            />
          </Field>
          <Field label="State">
            <input
              value={fields.state ?? ""}
              onChange={(e) => {
                set("state", e.target.value);
              }}
              className={INPUT}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
