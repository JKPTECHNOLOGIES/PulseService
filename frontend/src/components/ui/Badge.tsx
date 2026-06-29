import clsx from "clsx";
import {
  getJobStatusColor,
  getInvoiceStatusColor,
  getEstimateStatusColor,
  capitalize,
} from "../../utils/formatters";

interface BadgeProps {
  children: React.ReactNode;
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

interface StatusBadgeProps {
  status: string;
  type: "job" | "invoice" | "estimate";
}

export function StatusBadge({ status, type }: StatusBadgeProps) {
  const colorFn =
    type === "job"
      ? getJobStatusColor
      : type === "invoice"
        ? getInvoiceStatusColor
        : getEstimateStatusColor;

  return <Badge className={colorFn(status)}>{capitalize(status)}</Badge>;
}
