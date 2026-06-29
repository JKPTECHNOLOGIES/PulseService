import type { ReactNode } from "react";
import clsx from "clsx";
import { useLookup } from "../../hooks/useMetadata";
import type { LookupCategory } from "../../types";
import {
  getJobStatusColor,
  getInvoiceStatusColor,
  getEstimateStatusColor,
  capitalize,
} from "../../utils/formatters";

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

export default function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

const TYPE_TO_CATEGORY = {
  job: "jobStatus",
  invoice: "invoiceStatus",
  estimate: "estimateStatus",
} as const satisfies Record<string, LookupCategory>;

type StatusBadgeType = keyof typeof TYPE_TO_CATEGORY;

interface StatusBadgeProps {
  status: string;
  /** Convenience prop kept for existing call sites. */
  type?: StatusBadgeType;
  /** Any lookup category (preferred for new usage). */
  category?: LookupCategory;
}

/**
 * Renders a colored status pill. Label and color are resolved from the
 * DB-driven metadata (see useMetadata); the legacy formatter functions are used
 * only as an offline fallback before metadata has loaded.
 */
export function StatusBadge({
  status,
  type = "job",
  category,
}: StatusBadgeProps) {
  const resolvedCategory: LookupCategory = category ?? TYPE_TO_CATEGORY[type];
  const { options } = useLookup(resolvedCategory);
  const option = options.find((o) => o.value === status);

  const fallbackColor =
    type === "invoice"
      ? getInvoiceStatusColor(status)
      : type === "estimate"
        ? getEstimateStatusColor(status)
        : getJobStatusColor(status);

  const color = option?.color ?? fallbackColor;
  const label = option?.label ?? capitalize(status);

  return <Badge className={color}>{label}</Badge>;
}
