import { forwardRef } from 'react';
import clsx from 'clsx';
import { ChevronDownIcon } from '@heroicons/react/20/solid';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  wrapperClassName?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, placeholder, wrapperClassName, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className={clsx('w-full', wrapperClassName)}>
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-surface-700 mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={clsx(
              'block w-full rounded-lg border text-sm text-surface-900 bg-white',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              'transition-colors duration-150 appearance-none',
              'pl-3 pr-9 py-2',
              error
                ? 'border-red-400 focus:ring-red-500'
                : 'border-surface-300 hover:border-surface-400',
              props.disabled && 'bg-surface-50 cursor-not-allowed opacity-70',
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-surface-400">
            <ChevronDownIcon className="h-4 w-4" />
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-surface-500">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
