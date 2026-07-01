import { Menu } from "@headlessui/react";
import {
  BookmarkIcon,
  TrashIcon,
  PlusIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useSavedViews } from "../../hooks/useSavedViews";

interface SavedViewsMenuProps<T> {
  /** Stable id that scopes stored views (e.g. "customers"). */
  tableId: string;
  /** The current filter/sort state to snapshot when saving. */
  currentState: T;
  onApply: (state: T) => void;
}

export default function SavedViewsMenu<T>({
  tableId,
  currentState,
  onApply,
}: SavedViewsMenuProps<T>) {
  const { views, saveView, deleteView } = useSavedViews<T>(tableId);

  const handleSave = () => {
    const name = window.prompt("Save current view as:");
    if (name?.trim()) saveView(name.trim(), currentState);
  };

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
        <BookmarkIcon className="h-4 w-4" />
        Views
        <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
      </Menu.Button>
      <Menu.Items className="absolute right-0 z-20 mt-1 w-60 origin-top-right rounded-lg bg-white shadow-lg border border-gray-100 focus:outline-none py-1">
        {views.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">No saved views yet</p>
        ) : (
          views.map((view) => (
            <div
              key={view.id}
              className="flex items-center justify-between group px-1"
            >
              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={() => {
                      onApply(view.state);
                    }}
                    className={clsx(
                      "flex-1 text-left px-2 py-2 rounded-md text-sm truncate",
                      active ? "bg-gray-50 text-gray-900" : "text-gray-700",
                    )}
                  >
                    {view.name}
                  </button>
                )}
              </Menu.Item>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteView(view.id);
                }}
                className="p-1.5 text-gray-300 hover:text-red-500 rounded-md"
                title="Delete view"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
        <div className="border-t border-gray-100 mt-1 pt-1">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-primary-600 hover:bg-gray-50"
          >
            <PlusIcon className="h-4 w-4" />
            Save current view
          </button>
        </div>
      </Menu.Items>
    </Menu>
  );
}
