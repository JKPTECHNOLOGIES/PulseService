import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { useLookup } from "../../hooks/useMetadata";
import type { LookupCategory } from "../../types";

interface LookupSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Lookup category whose options to render (DB-driven). */
  category: LookupCategory;
  /** Optional leading blank option label (e.g. "Select status..."). */
  placeholder?: string;
  /** Restrict the rendered options to this subset of values. */
  only?: string[];
}

const BASE_CLASS =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

/**
 * A `<select>` whose options come from the DB-driven metadata for `category`.
 * Spreads through native props (and react-hook-form's `register(...)`), so it
 * drops in anywhere a styled status/type/role dropdown is needed without
 * hardcoding option lists.
 */
export const LookupSelect = forwardRef<HTMLSelectElement, LookupSelectProps>(
  function LookupSelect({ category, placeholder, only, className, ...rest }, ref) {
    const { options } = useLookup(category);
    const visible = only ? options.filter((o) => only.includes(o.value)) : options;

    return (
      <select ref={ref} className={clsx(BASE_CLASS, className)} {...rest}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {visible.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
);
