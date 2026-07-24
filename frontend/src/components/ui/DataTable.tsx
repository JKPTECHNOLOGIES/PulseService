import { ReactNode, useMemo } from "react";
import { Menu } from "@headlessui/react";
import {
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  ArrowDownTrayIcon,
  ArrowsUpDownIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { downloadCsv, CsvColumn } from "../../utils/csv";
import { useIsMobile } from "../../hooks/useIsMobile";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  /** Provide to include the column in CSV export (falls back to no export). */
  exportValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  thClassName?: string;
  tdClassName?: string;
  /**
   * When true, the column is included in CSV exports but not rendered as a
   * visible table column. Useful when a value is represented visually some
   * other way (e.g. color coding) but should still be available in exports.
   */
  exportOnly?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;

  // Sorting (controlled so it can be persisted in saved views).
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;

  // Selection / bulk actions.
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: (selectedRows: T[]) => ReactNode;

  // CSV export of the currently displayed rows.
  csvFilename?: string;

  /** Trailing per-row actions cell (e.g. edit button). */
  rowActions?: (row: T) => ReactNode;

  /**
   * Actions to show on the mobile card instead of `rowActions` (e.g. a compact
   * overflow menu in place of a row of icon buttons). Falls back to
   * `rowActions` when omitted.
   */
  renderMobileActions?: (row: T) => ReactNode;

  /**
   * When provided, small screens (< sm) render a stacked card list using this
   * renderer instead of the sideways-scrolling table. The table is shown at
   * the sm breakpoint and up.
   */
  renderMobileCard?: (row: T) => ReactNode;

  /** Optional per-row class (e.g. to highlight low-stock rows). */
  rowClassName?: (row: T) => string | false | undefined;

  /**
   * "auto" (default) lets the browser size columns from content, which can
   * scatter leftover width unpredictably across columns. "fixed" respects
   * each column's `thClassName` width exactly — use it when you want to
   * deliberately control which column absorbs the extra space (give columns
   * explicit `w-[n%]` widths in that case).
   */
  tableLayout?: "auto" | "fixed";
}

export default function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  renderMobileActions,
  sort,
  onSortChange,
  selectable,
  selectedIds = [],
  onSelectionChange,
  bulkActions,
  csvFilename,
  rowActions,
  renderMobileCard,
  rowClassName,
  tableLayout = "auto",
}: DataTableProps<T>) {
  const visibleColumns = useMemo(
    () => columns.filter((c) => !c.exportOnly),
    [columns],
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const accessor = col.sortValue;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === bv) return 0;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, sort, columns]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => rows.filter((r) => selectedSet.has(getRowId(r))),
    [rows, selectedSet, getRowId],
  );

  const allSelected =
    sortedRows.length > 0 &&
    sortedRows.every((r) => selectedSet.has(getRowId(r)));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : sortedRows.map(getRowId));
  };

  const toggleOne = (id: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  };

  const handleSort = (col: Column<T>) => {
    if (!col.sortValue || !onSortChange) return;
    if (sort?.key === col.key) {
      onSortChange({
        key: col.key,
        dir: sort.dir === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ key: col.key, dir: "asc" });
    }
  };

  const handleExport = () => {
    const csvColumns: CsvColumn<T>[] = [];
    for (const col of columns) {
      const accessor = col.exportValue;
      if (accessor) {
        csvColumns.push({
          header: col.header,
          value: (row: T) => accessor(row),
        });
      }
    }
    if (csvColumns.length === 0) return;
    downloadCsv(csvFilename ?? "export", sortedRows, csvColumns);
  };

  const renderSortIcon = (col: Column<T>) => {
    if (!col.sortValue) return null;
    if (sort?.key !== col.key) {
      return <ChevronUpDownIcon className="h-3.5 w-3.5 text-gray-300" />;
    }
    return sort.dir === "asc" ? (
      <ChevronUpIcon className="h-3.5 w-3.5" />
    ) : (
      <ChevronDownIcon className="h-3.5 w-3.5" />
    );
  };

  // Render exactly one layout (cards on mobile when a card renderer is given,
  // the table otherwise) instead of shipping both to the DOM.
  const isMobile = useIsMobile();
  const showCards = Boolean(renderMobileCard) && isMobile;

  const sortableColumns = visibleColumns.filter((c) => c.sortValue);
  // On mobile the column headers are gone, so surface sorting via a menu.
  const showSortMenu =
    showCards && Boolean(onSortChange) && sortableColumns.length > 0;

  const showToolbar = Boolean(csvFilename) || showSortMenu;
  const showBulkBar = selectable && selectedIds.length > 0;

  return (
    <div>
      {(showToolbar || showBulkBar) && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100 min-h-[52px]">
          {showBulkBar ? (
            <div className="flex items-center gap-3 w-full">
              <span className="text-sm font-medium text-gray-700">
                {selectedIds.length} selected
              </span>
              <div className="flex items-center gap-2">
                {bulkActions?.(selectedRows)}
              </div>
              <button
                onClick={() => onSelectionChange?.([])}
                className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                <XMarkIcon className="h-4 w-4" />
                Clear
              </button>
            </div>
          ) : (
            <>
              {showSortMenu ? (
                <Menu as="div" className="relative">
                  <Menu.Button className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                    <ArrowsUpDownIcon className="h-4 w-4" />
                    Sort
                  </Menu.Button>
                  <Menu.Items className="absolute left-0 z-20 mt-1 w-56 origin-top-left rounded-lg bg-white shadow-lg border border-gray-100 focus:outline-none py-1">
                    {sortableColumns.map((col) => {
                      const active = sort?.key === col.key;
                      return (
                        <Menu.Item key={col.key}>
                          {() => (
                            <button
                              onClick={() => {
                                handleSort(col);
                              }}
                              className={clsx(
                                "flex w-full items-center justify-between px-3 py-2 text-sm text-left",
                                active
                                  ? "text-primary-700 font-medium"
                                  : "text-gray-700",
                              )}
                            >
                              <span>{col.header}</span>
                              {active &&
                                (sort.dir === "asc" ? (
                                  <ChevronUpIcon className="h-4 w-4" />
                                ) : (
                                  <ChevronDownIcon className="h-4 w-4" />
                                ))}
                            </button>
                          )}
                        </Menu.Item>
                      );
                    })}
                  </Menu.Items>
                </Menu>
              ) : (
                <div />
              )}
              {csvFilename && (
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  Export CSV
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* One layout at a time: cards on mobile (when provided), table otherwise. */}
      {showCards ? (
        <ul className="divide-y divide-gray-100">
          {sortedRows.map((row) => {
            const id = getRowId(row);
            return (
              <li
                key={id}
                className={clsx(
                  "flex items-start gap-3 p-4",
                  // A saturated color at low opacity (rather than a light
                  // shade at higher opacity) blends correctly on both a white
                  // and a dark card surface -- a light tint like primary-50
                  // just washes out/grays a dark background instead of
                  // reading as a highlight.
                  selectedSet.has(id) && "bg-primary-500/10",
                  rowClassName?.(row),
                )}
              >
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selectedSet.has(id)}
                    onChange={() => {
                      toggleOne(id);
                    }}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 shrink-0"
                    aria-label="Select row"
                  />
                )}
                <div
                  className={clsx(
                    "min-w-0 flex-1",
                    onRowClick && "cursor-pointer",
                  )}
                  onClick={
                    onRowClick
                      ? () => {
                          onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {renderMobileCard?.(row)}
                </div>
                {(renderMobileActions ?? rowActions) && (
                  <div className="shrink-0 flex items-center gap-1">
                    {(renderMobileActions ?? rowActions)?.(row)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table
            className={clsx(
              "w-full text-sm",
              tableLayout === "fixed" && "table-fixed",
            )}
          >
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {selectable && (
                  <th className="w-10 py-3 px-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                )}
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => {
                      handleSort(col);
                    }}
                    className={clsx(
                      "py-3 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide",
                      col.align === "right" ? "text-right" : "text-left",
                      col.sortValue &&
                        "cursor-pointer select-none hover:text-gray-700",
                      col.thClassName,
                    )}
                  >
                    <span
                      className={clsx(
                        "inline-flex items-center gap-1",
                        col.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {col.header}
                      {renderSortIcon(col)}
                    </span>
                  </th>
                ))}
                {rowActions && <th className="w-16 py-3 px-5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedRows.map((row) => {
                const id = getRowId(row);
                return (
                  <tr
                    key={id}
                    onClick={
                      onRowClick
                        ? () => {
                            onRowClick(row);
                          }
                        : undefined
                    }
                    className={clsx(
                      "transition-colors",
                      onRowClick && "hover:bg-gray-50 cursor-pointer",
                      selectedSet.has(id) && "bg-primary-500/10",
                      rowClassName?.(row),
                    )}
                  >
                    {selectable && (
                      <td
                        className="w-10 py-3.5 px-4"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(id)}
                          onChange={() => {
                            toggleOne(id);
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className={clsx(
                          "py-3.5 px-3",
                          col.align === "right" ? "text-right" : "text-left",
                          col.tdClassName,
                        )}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                    {rowActions && (
                      <td
                        className="py-3.5 px-5"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {rowActions(row)}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
