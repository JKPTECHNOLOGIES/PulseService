import { useState } from "react";
import { useForm } from "react-hook-form";
import { PlusIcon, FolderIcon, PencilIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  usePricebookCategories,
  usePricebookItems,
  useCreatePricebookItem,
  useUpdatePricebookItem,
  useCreatePricebookCategory,
} from "../hooks/usePricebook";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import { LookupSelect } from "../components/ui/LookupSelect";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import { PricebookItem } from "../types";

interface ItemForm {
  sku: string;
  name: string;
  description?: string;
  type: string;
  unitCost: number;
  unitPrice: number;
  unit: string;
  taxable: boolean;
}

export default function PricebookPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [itemModal, setItemModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingItem, setEditingItem] = useState<PricebookItem | null>(null);

  const { data: categories, isLoading: catLoading } = usePricebookCategories();
  const { data: items, isLoading: itemsLoading } = usePricebookItems({
    categoryId: selectedCategory ?? undefined,
  });
  const { getLabel: getItemTypeLabel } = useLookup("pricebookItemType");

  const createItem = useCreatePricebookItem();
  const updateItem = useUpdatePricebookItem();
  const createCategory = useCreatePricebookCategory();

  const { register, handleSubmit, reset } = useForm<ItemForm>({
    defaultValues: { type: "service", unit: "each", taxable: true },
  });
  const categoryForm = useForm<{ name: string; description?: string }>();

  const openCreateItem = () => {
    setEditingItem(null);
    reset({
      type: "service",
      unit: "each",
      taxable: true,
      sku: "",
      name: "",
      unitCost: 0,
      unitPrice: 0,
    });
    setItemModal(true);
  };

  const openEditItem = (item: PricebookItem) => {
    setEditingItem(item);
    reset({
      sku: item.sku,
      name: item.name,
      description: item.description,
      type: item.type,
      unitCost: item.unitCost,
      unitPrice: item.unitPrice,
      unit: item.unit,
      taxable: item.taxable,
    });
    setItemModal(true);
  };

  const onSubmitItem = async (data: ItemForm) => {
    const payload = {
      ...data,
      categoryId: selectedCategory ?? undefined,
    };
    if (editingItem) {
      await updateItem.mutateAsync({ id: editingItem.id, ...payload });
    } else {
      await createItem.mutateAsync(payload);
    }
    setItemModal(false);
  };

  const onSubmitCategory = async (data: {
    name: string;
    description?: string;
  }) => {
    await createCategory.mutateAsync(data);
    categoryForm.reset();
    setCategoryModal(false);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 lg:h-full">
      {/* Categories: full-width horizontal chip bar on mobile, fixed side rail on desktop */}
      <div className="w-full lg:w-64 lg:shrink-0">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 lg:h-full flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Categories</h3>
            <button
              onClick={() => {
                setCategoryModal(true);
              }}
              className="p-1 text-gray-400 hover:text-primary-600 rounded"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="lg:flex-1 flex lg:flex-col gap-1 lg:gap-0.5 overflow-x-auto lg:overflow-y-auto p-2">
            <button
              onClick={() => {
                setSelectedCategory(null);
              }}
              className={clsx(
                "shrink-0 lg:w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left whitespace-nowrap",
                selectedCategory === null
                  ? "bg-primary-50 text-primary-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50",
              )}
            >
              <FolderIcon className="h-4 w-4 shrink-0" />
              All Items
            </button>
            {catLoading ? (
              <PageSpinner />
            ) : (
              (categories ?? []).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(cat.id);
                  }}
                  className={clsx(
                    "shrink-0 lg:w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left whitespace-nowrap",
                    selectedCategory === cat.id
                      ? "bg-primary-50 text-primary-700 font-medium"
                      : "text-gray-600 hover:bg-gray-50",
                  )}
                >
                  <FolderIcon className="h-4 w-4 shrink-0" />
                  <span className="lg:truncate">{cat.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 min-w-0">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Items</h3>
            <Button
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={openCreateItem}
            >
              Add Item
            </Button>
          </div>
          {itemsLoading ? (
            <PageSpinner />
          ) : !items || items.length === 0 ? (
            <EmptyState
              title="No items"
              description="Add items to this category to get started"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      SKU
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Name
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Type
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Cost
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Price
                    </th>
                    <th className="text-center py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Taxable
                    </th>
                    <th className="text-center py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Active
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => {
                        openEditItem(item);
                      }}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="py-3 px-5 font-mono text-xs text-gray-600">
                        {item.sku}
                      </td>
                      <td className="py-3 px-3 text-gray-900 font-medium">
                        {item.name}
                      </td>
                      <td className="py-3 px-3 text-gray-600 text-xs">
                        {getItemTypeLabel(item.type)}
                      </td>
                      <td className="py-3 px-3 text-right text-gray-600">
                        {formatCurrency(item.unitCost)}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-gray-900">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.taxable ? (
                          <Badge className="bg-green-100 text-green-700">
                            Yes
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-500">
                            No
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.isActive ? (
                          <Badge className="bg-green-100 text-green-700">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-500">
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditItem(item);
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Item Modal */}
      <Modal
        isOpen={itemModal}
        onClose={() => {
          setItemModal(false);
        }}
        title={editingItem ? "Edit Item" : "Add Item"}
        size="lg"
      >
        <form
          onSubmit={(e) => void handleSubmit(onSubmitItem)(e)}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                SKU
              </label>
              <input
                {...register("sku")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Type
              </label>
              <LookupSelect
                category="pricebookItemType"
                {...register("type")}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              {...register("name")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              {...register("description")}
              rows={2}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Unit Cost
              </label>
              <input
                type="number"
                step="0.01"
                {...register("unitCost", { valueAsNumber: true })}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Unit Price
              </label>
              <input
                type="number"
                step="0.01"
                {...register("unitPrice", { valueAsNumber: true })}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Unit
              </label>
              <input
                {...register("unit")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register("taxable")}
              className="rounded text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Taxable</span>
          </label>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setItemModal(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createItem.isPending || updateItem.isPending}
            >
              {editingItem ? "Save" : "Add Item"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Category Modal */}
      <Modal
        isOpen={categoryModal}
        onClose={() => {
          setCategoryModal(false);
        }}
        title="Add Category"
      >
        <form
          onSubmit={(e) => void categoryForm.handleSubmit(onSubmitCategory)(e)}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              {...categoryForm.register("name")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              {...categoryForm.register("description")}
              rows={2}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setCategoryModal(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createCategory.isPending}>
              Add Category
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
