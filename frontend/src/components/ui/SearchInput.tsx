import { useState, useEffect, useCallback } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchInput({
  value: externalValue = '',
  onChange,
  placeholder = 'Search...',
  className,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(externalValue);

  const debouncedOnChange = useCallback(
    (val: string) => {
      const timer = setTimeout(() => { onChange(val); }, 300);
      return () => { clearTimeout(timer); };
    },
    [onChange]
  );

  useEffect(() => {
    const cleanup = debouncedOnChange(localValue);
    return cleanup;
  }, [localValue, debouncedOnChange]);

  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  return (
    <div className={clsx('relative', className)}>
      <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => { setLocalValue(e.target.value); }}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
          placeholder-gray-400"
      />
      {localValue && (
        <button
          onClick={() => {
            setLocalValue('');
            onChange('');
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
