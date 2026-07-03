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
  useSuppliers,
  useSaveSupplier,
  useDeleteSupplier,
} from "../hooks/useSuppliers";
import type { Supplier } from "../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const { data: suppliers, isLoading } = useSuppliers(search ? { search } : {});
  const save = useSaveSupplier();
  const del = useDeleteSupplier();

  const [form, setForm] = useState<Partial<Supplier> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);

  const columns: Column<Supplier>[] = [
    {
      key: "supplierNumber",
      header: "Number",
      sortValue: (s) => s.supplierNumber,
      exportValue: (s) => s.supplierNumber,
      render: (s) => (
        <span className="font-mono text-xs text-gray-600">
          {s.supplierNumber}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (s) => s.name.toLowerCase(),
      exportValue: (s) => s.name,
      render: (s) => (
        <span className="font-medium text-gray-900">{s.name}</span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      exportValue: (s) => s.contactName ?? "",
      render: (s) => (
        <div className="text-xs text-gray-500">
          {s.contactName && <div>{s.contactName}</div>}
          {s.email && <div>{s.email}</div>}
          {s.phone && <div>{s.phone}</div>}
        </div>
      ),
    },
    {
      key: "paymentTerms",
      header: "Terms",
      exportValue: (s) => s.paymentTerms ?? "",
      render: (s) => (
        <span className="text-gray-500 text-xs">{s.paymentTerms ?? "-"}</span>
      ),
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      sortValue: (s) => s._count?.items ?? 0,
      exportValue: (s) => s._count?.items ?? 0,
      render: (s) => (
        <span className="text-gray-500 text-xs">{s._count?.items ?? 0}</span>
      ),
    },
    {
      key: "pos",
      header: "POs",
      align: "right",
      sortValue: (s) => s._count?.purchaseOrders ?? 0,
      exportValue: (s) => s._count?.purchaseOrders ?? 0,
      render: (s) => (
        <span className="text-gray-500 text-xs">
          {s._count?.purchaseOrders ?? 0}
        </span>
      ),
    },
  ];

  const rowActions = (s: Supplier) => (
    <Can permission="suppliers.manage">
      <IconButton
        label="Edit"
        onClick={() => {
          setForm(s);
        }}
      >
        <PencilSquareIcon className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Deactivate"
        onClick={() => {
          setConfirmDelete(s);
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
            placeholder="Search suppliers..."
            className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-64"
          />
          <p className="text-sm text-gray-500">
            {suppliers?.length ?? 0} suppliers
          </p>
        </div>
        <Can permission="suppliers.manage">
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              setForm({});
            }}
          >
            New Supplier
          </Button>
        </Can>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {!suppliers || suppliers.length === 0 ? (
          <EmptyState
            title="No suppliers"
            description="Add the vendors you buy parts and equipment from."
          />
        ) : (
          <DataTable<Supplier>
            columns={columns}
            rows={suppliers}
            getRowId={(s) => s.id}
            sort={sort}
            onSortChange={setSort}
            csvFilename="suppliers"
            rowActions={rowActions}
          />
        )}
      </div>

      <SupplierFormModal
        supplier={form}
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
        title="Deactivate supplier?"
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

function SupplierFormModal({
  supplier,
  pending,
  onClose,
  onSubmit,
}: {
  supplier: Partial<Supplier> | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: Partial<Supplier> & { id?: string }) => Promise<void>;
}) {
  const editing = !!supplier?.id;
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [fields, setFields] = useState<Partial<Supplier>>({});

  if (supplier && loadedId !== (supplier.id ?? "new")) {
    setLoadedId(supplier.id ?? "new");
    setFields({
      name: supplier.name ?? "",
      contactName: supplier.contactName ?? "",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      paymentTerms: supplier.paymentTerms ?? "",
      city: supplier.city ?? "",
      state: supplier.state ?? "",
    });
  }

  const set = (k: keyof Supplier, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
  };

  if (!supplier) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? `Edit: ${supplier.name ?? ""}` : "New supplier"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            ...(editing ? { id: supplier.id } : {}),
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
