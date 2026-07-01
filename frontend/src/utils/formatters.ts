import { format, parseISO, isValid } from "date-fns";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? parseISO(date) : date;
  return isValid(d) ? format(d, "MMM d, yyyy") : "-";
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? parseISO(date) : date;
  return isValid(d) ? format(d, "MMM d, yyyy h:mm a") : "-";
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "-";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function getJobStatusColor(status: string): string {
  const colors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    scheduled: "bg-indigo-100 text-indigo-800",
    dispatched: "bg-purple-100 text-purple-800",
    in_progress: "bg-yellow-100 text-yellow-800",
    on_hold: "bg-orange-100 text-orange-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
}

export function getInvoiceStatusColor(status: string): string {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-800",
    sent: "bg-blue-100 text-blue-800",
    viewed: "bg-indigo-100 text-indigo-800",
    partial: "bg-yellow-100 text-yellow-800",
    paid: "bg-green-100 text-green-800",
    overdue: "bg-red-100 text-red-800",
    void: "bg-gray-100 text-gray-500",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
}

export function getEstimateStatusColor(status: string): string {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-800",
    sent: "bg-blue-100 text-blue-800",
    viewed: "bg-indigo-100 text-indigo-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    expired: "bg-orange-100 text-orange-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
}

export function capitalize(str: string): string {
  return str
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
