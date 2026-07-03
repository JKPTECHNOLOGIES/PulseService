import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { LookupSelect } from "../components/ui/LookupSelect";
import { TableSkeleton } from "../components/ui/Skeleton";
import { Can } from "../components/ui/Can";
import { formatCurrency } from "../utils/formatters";
import { usePricebookItems } from "../hooks/usePricebook";
import {
  usePricingTiers,
  usePricingTier,
  useSavePricingTier,
  useDeletePricingTier,
  useAddPricingTierOverride,
  useRemovePricingTierOverride,
} from "../hooks/usePricingTiers";
import type { PricingTier } from "../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function PricingTiersPage() {
  const { data: tiers, isLoading } = usePricingTiers();
  const del = useDeletePricingTier();
  const [form, setForm] = useState<Partial<PricingTier> | null>(null);
  const [overridesTierId, setOverridesTierId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PricingTier | null>(null);

  if (isLoading) return <TableSkeleton rows={4} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/pricebook"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Pricebook
          </Link>
          <h2 className="text-lg font-bold text-gray-900 mt-1">
            Pricing Tiers
          </h2>
          <p className="text-sm text-gray-500">
            Assign customers to a tier to apply a blanket discount, with
            optional per-item overrides.
          </p>
        </div>
        <Can permission="pricebook.manage">
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              setForm({});
            }}
          >
            New Tier
          </Button>
        </Can>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {!tiers || tiers.length === 0 ? (
          <EmptyState
            title="No pricing tiers"
            description="Create a tier (e.g. Commercial Preferred) and assign it to customers from their profile."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-3 px-4 font-medium">Name</th>
                <th className="py-3 px-4 font-medium">Discount</th>
                <th className="py-3 px-4 font-medium text-right">Customers</th>
                <th className="py-3 px-4 font-medium text-right">
                  Item overrides
                </th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tiers.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <span className="font-medium text-gray-900">{t.name}</span>
                    {t.isDefault && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-primary-50 text-primary-700 rounded px-1.5 py-0.5">
                        Default
                      </span>
                    )}
                    {t.description && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t.description}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-700">
                    {t.discountValue === 0
                      ? "None"
                      : t.discountType === "percentage"
                        ? `${String(t.discountValue)}% off`
                        : `${formatCurrency(t.discountValue)} off`}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">
                    {t._count?.customers ?? 0}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">
                    {t._count?.overrides ?? 0}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex justify-end gap-1">
                      <IconButton
                        label="Item overrides"
                        onClick={() => {
                          setOverridesTierId(t.id);
                        }}
                      >
                        <TagIcon className="h-4 w-4" />
                      </IconButton>
                      <Can permission="pricebook.manage">
                        <IconButton
                          label="Edit"
                          onClick={() => {
                            setForm(t);
                          }}
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label="Deactivate"
                          onClick={() => {
                            setConfirmDelete(t);
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </IconButton>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <TierFormModal
        tier={form}
        onClose={() => {
          setForm(null);
        }}
      />
      <OverridesModal
        tierId={overridesTierId}
        onClose={() => {
          setOverridesTierId(null);
        }}
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Deactivate pricing tier?"
        message={`"${confirmDelete?.name ?? ""}" will no longer be selectable for customers. Customers already on it keep their assignment.`}
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

function TierFormModal({
  tier,
  onClose,
}: {
  tier: Partial<PricingTier> | null;
  onClose: () => void;
}) {
  const save = useSavePricingTier();
  const editing = !!tier?.id;

  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState(0);
  const [isDefault, setIsDefault] = useState(false);

  if (tier && loadedId !== (tier.id ?? "new")) {
    setLoadedId(tier.id ?? "new");
    setName(tier.name ?? "");
    setDescription(tier.description ?? "");
    setDiscountType(tier.discountType ?? "percentage");
    setDiscountValue(tier.discountValue ?? 0);
    setIsDefault(tier.isDefault ?? false);
  }

  if (!tier) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? `Edit: ${tier.name ?? ""}` : "New pricing tier"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save
            .mutateAsync({
              ...(editing ? { id: tier.id } : {}),
              name,
              description: description || undefined,
              discountType,
              discountValue,
              isDefault,
            })
            .then(() => {
              onClose();
            });
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            required
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            className={INPUT}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Discount type
            </label>
            <LookupSelect
              category="discountType"
              value={discountType}
              onChange={(e) => {
                setDiscountType(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {discountType === "percentage" ? "Percent off" : "Amount off"}
            </label>
            <input
              type="number"
              step="any"
              min={0}
              value={discountValue}
              onChange={(e) => {
                setDiscountValue(Number(e.target.value));
              }}
              className={INPUT}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => {
              setIsDefault(e.target.checked);
            }}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          Default tier for new customers
        </label>
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OverridesModal({
  tierId,
  onClose,
}: {
  tierId: string | null;
  onClose: () => void;
}) {
  const { data: tier } = usePricingTier(tierId ?? "");
  const { data: pricebookItems } = usePricebookItems();
  const addOverride = useAddPricingTierOverride();
  const removeOverride = useRemovePricingTierOverride();

  const [pricebookItemId, setPricebookItemId] = useState("");
  const [overrideType, setOverrideType] = useState("fixed_price");
  const [overrideValue, setOverrideValue] = useState(0);

  if (!tierId || !tier) return null;

  const overriddenIds = new Set(
    (tier.overrides ?? []).map((o) => o.pricebookItemId),
  );
  const addableItems = (pricebookItems ?? []).filter(
    (i) => !overriddenIds.has(i.id),
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Item overrides: ${tier.name}`}
      size="lg"
    >
      <div className="space-y-4">
        {tier.overrides && tier.overrides.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Catalog price</th>
                <th className="py-2 font-medium">Override</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tier.overrides.map((o) => (
                <tr key={o.id}>
                  <td className="py-2.5 text-gray-900 font-medium">
                    {o.pricebookItem?.name ?? "-"}
                  </td>
                  <td className="py-2.5 text-gray-500">
                    {formatCurrency(o.pricebookItem?.unitPrice ?? 0)}
                  </td>
                  <td className="py-2.5 text-gray-700">
                    {o.overrideType === "fixed_price"
                      ? formatCurrency(o.overrideValue)
                      : o.overrideType === "percentage"
                        ? `${String(o.overrideValue)}% off`
                        : `${formatCurrency(o.overrideValue)} off`}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => {
                        removeOverride.mutate({ tierId, overrideId: o.id });
                      }}
                      className="p-1 text-gray-400 hover:text-red-500"
                      aria-label="Remove override"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">No item overrides yet.</p>
        )}

        <div className="border-t border-gray-100 pt-4 grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <label className="block text-xs text-gray-500 mb-1">Item</label>
            <select
              value={pricebookItemId}
              onChange={(e) => {
                setPricebookItemId(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">Select item...</option>
              {addableItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <LookupSelect
              category="pricingOverrideType"
              value={overrideType}
              onChange={(e) => {
                setOverrideType(e.target.value);
              }}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Value</label>
            <input
              type="number"
              step="any"
              min={0}
              value={overrideValue}
              onChange={(e) => {
                setOverrideValue(Number(e.target.value));
              }}
              className={INPUT}
            />
          </div>
          <div className="col-span-2">
            <Button
              size="sm"
              className="w-full"
              loading={addOverride.isPending}
              disabled={!pricebookItemId}
              onClick={() => {
                void addOverride
                  .mutateAsync({
                    tierId,
                    pricebookItemId,
                    overrideType,
                    overrideValue,
                  })
                  .then(() => {
                    setPricebookItemId("");
                    setOverrideValue(0);
                  });
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
