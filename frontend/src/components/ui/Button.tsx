import React from "react";
import clsx from "clsx";
import Spinner from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses: Record<string, string> = {
  primary:
    "bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 border-transparent",
  secondary:
    "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500 border-transparent",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 border-transparent",
  ghost:
    "bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-500 border-transparent",
  outline:
    "bg-white text-gray-700 hover:bg-gray-50 focus:ring-primary-500 border-gray-300",
};

// Taller minimum heights on touch (mobile) for comfortable ~44px tap targets,
// tightened back up at the sm breakpoint (pointer devices) to stay compact.
const sizeClasses: Record<string, string> = {
  sm: "px-3 py-1.5 text-xs min-h-[40px] sm:min-h-[32px]",
  md: "px-4 py-2 text-sm min-h-[44px] sm:min-h-[38px]",
  lg: "px-6 py-3 text-base min-h-[48px]",
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled ?? loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}
