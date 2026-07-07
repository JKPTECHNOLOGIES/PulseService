import { useState, useEffect, useRef } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchInput({
  value: externalValue = "",
  onChange,
  placeholder = "Search...",
  className,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(externalValue);

  // Keep the latest onChange in a ref so the debounce effect doesn't re-run
  // (and re-fire onChange) just because the parent passed a new callback
  // identity on re-render. Otherwise any parent re-render would emit the search
  // value again — e.g. wiping row selections via a resetPage handler.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Sync an externally-controlled value down into the local input (e.g. when a
  // saved view or a Clear action resets the search from the parent).
  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  // Debounce local -> parent, but only when the local value actually differs
  // from the external one (i.e. the user typed), never on unrelated re-renders.
  useEffect(() => {
    if (localValue === externalValue) return;
    const timer = setTimeout(() => {
      onChangeRef.current(localValue);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [localValue, externalValue]);

  return (
    <div className={clsx("relative", className)}>
      <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
        }}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
          placeholder-gray-400"
      />
      {localValue && (
        <button
          onClick={() => {
            setLocalValue("");
            onChange("");
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
