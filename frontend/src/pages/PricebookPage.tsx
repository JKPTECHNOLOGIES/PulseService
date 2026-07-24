import { useState, lazy, Suspense } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  FolderIcon,
  PencilIcon,
  ArrowUpTrayIcon,
  QrCodeIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  usePricebookCategories,
  usePricebookItemsPaged,
  useCreatePricebookItem,
  useUpdatePricebookItem,
  useCreatePricebookCategory,
} from "../hooks/usePricebook";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import ImportModal from "../components/ui/ImportModal";
import EmptyState from "../components/ui/EmptyState";
import Pagination from "../components/ui/Pagination";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { LookupSelect } from "../components/ui/LookupSelect";
import { PageSpinner } from "../components/ui/Spinner";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatCurrency } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import api from "../lib/api";
import toast from "../lib/toast";
import { ApiResponse, PricebookItem } from "../types";

const PAGE_SIZE = 50;

const BarcodeScanner = lazy(() => import("../components/ui/BarcodeScanner"));

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);
  const [itemModal, setItemModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PricebookItem | null>(null);

  const { data: categories, isLoading: catLoading } = usePricebookCategories();
  const { data, isLoading: itemsLoading } = usePricebookItemsPaged({
    categoryId: selectedCategory ?? undefined,
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
    // Sorting has to happen server-side across the whole filtered set, not
    // just the 50 rows on the current page -- DataTable's own sort only ever
    // reorders whatever `rows` it's given.
    sortKey: sort?.key,
    sortDir: sort?.dir,
  });
  const items = data?.data ?? [];
  const pagination = data?.pagination;
  const { getLabel: getItemTypeLabel } = useLookup("pricebookItemType");

  const selectCategory = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    setPage(1);
  };

  // Scanned barcode -> match an item by SKU. Searches the whole catalog (not
  // just the currently-displayed page) within the current category filter,
  // same as the search box.
  const handleScan = async (code: string) => {
    const term = code.trim();
    try {
      const res = await api.get<ApiResponse<PricebookItem[]>>(
        "/pricebook/items",
        {
          params: {
            categoryId: selectedCategory ?? undefined,
            search: term,
          },
        },
      );
      const match = res.data.find(
        (i) => i.sku.toLowerCase() === term.toLowerCase(),
      );
      if (match) openEditItem(match);
      else
        toast.error(
          `No item with SKU \u201C${code}\u201D in this category. Try "All" or check the SKU.`,
        );
    } catch {
      toast.error("Couldn't look up that barcode. Try again.");
    }
  };

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

  const columns: Column<PricebookItem>[] = [
    {
      key: "sku",
      header: "SKU",
      sortValue: (i) => i.sku,
      exportValue: (i) => i.sku,
      render: (i) => (
        <span className="font-mono text-xs text-gray-600">{i.sku}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (i) => i.name.toLowerCase(),
      exportValue: (i) => i.name,
      render: (i) => (
        <span className="text-gray-900 font-medium">{i.name}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (i) => i.type,
      exportValue: (i) => getItemTypeLabel(i.type),
      render: (i) => (
        <span className="text-gray-600 text-xs">
          {getItemTypeLabel(i.type)}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      sortValue: (i) => i.unitCost,
      exportValue: (i) => i.unitCost,
      render: (i) => (
        <span className="text-gray-600">{formatCurrency(i.unitCost)}</span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      sortValue: (i) => i.unitPrice,
      exportValue: (i) => i.unitPrice,
      render: (i) => (
        <span className="font-medium text-gray-900">
          {formatCurrency(i.unitPrice)}
        </span>
      ),
    },
    {
      key: "taxable",
      header: "Taxable",
      sortValue: (i) => (i.taxable ? 1 : 0),
      exportValue: (i) => (i.taxable ? "Yes" : "No"),
      render: (i) =>
        i.taxable ? (
          <Badge className="bg-green-100 text-green-700">Yes</Badge>
        ) : (
          <Badge className="bg-gray-100 text-gray-500">No</Badge>
        ),
    },
    {
      key: "active",
      header: "Active",
      sortValue: (i) => (i.isActive ? 1 : 0),
      exportValue: (i) => (i.isActive ? "Active" : "Inactive"),
      render: (i) =>
        i.isActive ? (
          <Badge className="bg-green-100 text-green-700">Active</Badge>
        ) : (
          <Badge className="bg-gray-100 text-gray-500">Inactive</Badge>
        ),
    },
  ];

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
                selectCategory(null);
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
                    selectCategory(cat.id);
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
          <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search SKU or name..."
                className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-64"
              />
              <p className="text-sm text-gray-500">
                {pagination?.total ?? 0} items
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/pricebook/pricing-tiers">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<TagIcon className="h-4 w-4" />}
                >
                  Pricing Tiers
                </Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                icon={<QrCodeIcon className="h-4 w-4" />}
                onClick={() => {
                  setScannerOpen(true);
                }}
              >
                Scan
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<ArrowUpTrayIcon className="h-4 w-4" />}
                onClick={() => {
                  setImportOpen(true);
                }}
              >
                Import
              </Button>
              <Button
                size="sm"
                icon={<PlusIcon className="h-4 w-4" />}
                onClick={openCreateItem}
              >
                Add Item
              </Button>
            </div>
          </div>
          {itemsLoading ? (
            <TableSkeleton rows={8} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No items"
              description="Add items to this category to get started"
            />
          ) : (
            <DataTable<PricebookItem>
              columns={columns}
              rows={items}
              getRowId={(i) => i.id}
              onRowClick={openEditItem}
              sort={sort}
              onSortChange={setSort}
              csvFilename="pricebook-items"
              rowActions={(i) => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditItem(i);
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
              )}
            />
          )}
          {pagination && pagination.totalPages > 1 && (
            <div className="px-5 py-3 border-t border-gray-100">
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      </div>

      {/* Item Modal */}
      <ImportModal
        isOpen={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
        title="Import Items"
        endpoint="/pricebook/items/import"
        invalidateKey={["pricebook"]}
        templateColumns={[
          "name",
          "sku",
          "type",
          "unitCost",
          "unitPrice",
          "unit",
        ]}
      />

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

      {scannerOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner
            isOpen
            onClose={() => {
              setScannerOpen(false);
            }}
            onDetected={(code) => {
              void handleScan(code);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
