import React from "react";
import clsx from "clsx";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility since the button has no visible text. */
  label: string;
  variant?: "default" | "danger";
}

const variantClasses: Record<string, string> = {
  default: "text-gray-400 hover:text-gray-600 hover:bg-gray-100",
  danger: "text-gray-400 hover:text-red-500 hover:bg-red-50",
};

/**
 * Icon-only button with an accessible label and a comfortable tap target
 * (~44px on touch, tightened on pointer devices). Use for row/table actions
 * instead of a bare `<button className="p-1.5">`.
 */
export default function IconButton({
  label,
  variant = "default",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex items-center justify-center rounded-lg transition-colors",
        "min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px]",
        "focus:outline-none focus:ring-2 focus:ring-primary-500",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
