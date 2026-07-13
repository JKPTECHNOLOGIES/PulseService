import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import toast from "../lib/toast";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import Button from "../components/ui/Button";
import { PageSpinner } from "../components/ui/Spinner";
import ThermometerLogo from "../components/ui/ThermometerLogo";
import { formatCurrency, formatDate } from "../utils/formatters";

interface PublicLineItem {
  id: string;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PublicEstimate {
  id: string;
  estimateNumber: string;
  title: string;
  status: string;
  validUntil?: string | null;
  subtotal: number;
  discountType?: string | null;
  discountValue?: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string | null;
  terms?: string | null;
  lineItems: PublicLineItem[];
  customer: {
    firstName?: string;
    lastName?: string;
    companyName?: string | null;
  };
  company: {
    name: string;
    phone?: string | null;
    email?: string | null;
  } | null;
}

const APPROVABLE = ["draft", "sent", "viewed"];

export default function PublicEstimatePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!id || !token) {
      setError("This link is missing its access token.");
      setLoading(false);
      return;
    }
    api
      .get<{ data: PublicEstimate }>(`/public/estimates/${id}`, {
        params: { token },
      })
      .then((res) => {
        setEstimate(res.data);
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, "This estimate link is invalid."));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id, token]);

  const act = async (action: "approve" | "reject") => {
    if (!id) return;
    setWorking(true);
    try {
      const res = await api.post<{ data: { status: string } }>(
        `/public/estimates/${id}/${action}`,
        { token, rejectionReason: rejectReason || undefined },
        { params: { token } },
      );
      setEstimate((prev) =>
        prev ? { ...prev, status: res.data.status } : prev,
      );
      setShowReject(false);
      toast.success(
        action === "approve"
          ? "Estimate approved — thank you!"
          : "Estimate declined.",
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Something went wrong."));
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <PageSpinner />;

  if (error || !estimate) {
    return (
      <div className="min-h-screen-safe bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <h1 className="text-lg font-semibold text-gray-900">
            Estimate unavailable
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            {error || "This estimate could not be found."}
          </p>
        </div>
      </div>
    );
  }

  const discount = estimate.discountValue
    ? estimate.discountType === "percentage"
      ? estimate.subtotal * (estimate.discountValue / 100)
      : estimate.discountValue
    : 0;
  const canAct = APPROVABLE.includes(estimate.status);
  const customerName =
    estimate.customer.companyName ??
    `${estimate.customer.firstName ?? ""} ${estimate.customer.lastName ?? ""}`.trim();

  return (
    <div className="min-h-screen-safe bg-gray-100 py-8 px-4">
      <div className="mx-auto max-w-2xl space-y-5">
        {/* Brand */}
        <div className="flex items-center gap-2 justify-center">
          <ThermometerLogo className="h-8 w-8" />
          <span className="font-bold text-gray-900">
            {estimate.company?.name ?? "Prime Comfort Solutions"}
          </span>
        </div>

        {/* Status banners */}
        {estimate.status === "approved" && (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl px-4 py-3 flex items-center gap-2 text-sm">
            <CheckCircleIcon className="h-5 w-5 shrink-0" />
            You approved this estimate. Thank you! We'll be in touch shortly.
          </div>
        )}
        {estimate.status === "rejected" && (
          <div className="bg-gray-100 border border-gray-200 text-gray-600 rounded-xl px-4 py-3 text-sm">
            This estimate was declined. Contact us if you'd like to revisit it.
          </div>
        )}

        {/* Estimate card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <h1 className="text-xl font-bold text-gray-900">
              Estimate #{estimate.estimateNumber}
            </h1>
            <p className="text-gray-600 mt-0.5">{estimate.title}</p>
            <div className="mt-2 text-sm text-gray-500">
              Prepared for {customerName}
              {estimate.validUntil
                ? ` · Valid until ${formatDate(estimate.validUntil)}`
                : ""}
            </div>
          </div>

          <div className="px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                    Item
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                    Qty
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                    Price
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {estimate.lineItems.map((li) => (
                  <tr key={li.id}>
                    <td className="py-2.5">
                      <p className="font-medium text-gray-900">{li.name}</p>
                      {li.description && (
                        <p className="text-xs text-gray-500">
                          {li.description}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-gray-600">
                      {li.quantity}
                    </td>
                    <td className="py-2.5 text-right text-gray-600">
                      {formatCurrency(li.unitPrice)}
                    </td>
                    <td className="py-2.5 text-right font-medium text-gray-900">
                      {formatCurrency(li.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto max-w-xs space-y-2 mt-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(estimate.subtotal)}
                </span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Discount</span>
                  <span className="font-medium text-red-600">
                    -{formatCurrency(discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax ({estimate.taxRate}%)</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(estimate.taxAmount)}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                <span className="text-gray-900">Total</span>
                <span className="text-primary-600">
                  {formatCurrency(estimate.total)}
                </span>
              </div>
            </div>
          </div>

          {(Boolean(estimate.notes) || Boolean(estimate.terms)) && (
            <div className="px-6 py-4 border-t border-gray-100 space-y-3">
              {estimate.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">
                    Notes
                  </p>
                  <p className="text-sm text-gray-600 whitespace-pre-line mt-1">
                    {estimate.notes}
                  </p>
                </div>
              )}
              {estimate.terms && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">
                    Terms
                  </p>
                  <p className="text-sm text-gray-600 whitespace-pre-line mt-1">
                    {estimate.terms}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {canAct && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            {!showReject ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  className="flex-1"
                  size="lg"
                  loading={working}
                  onClick={() => {
                    void act("approve");
                  }}
                >
                  Approve Estimate
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  disabled={working}
                  onClick={() => {
                    setShowReject(true);
                  }}
                >
                  Decline
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Let us know why (optional)
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => {
                    setRejectReason(e.target.value);
                  }}
                  rows={3}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  placeholder="Reason for declining..."
                />
                <div className="flex gap-3">
                  <Button
                    variant="danger"
                    loading={working}
                    onClick={() => {
                      void act("reject");
                    }}
                  >
                    Confirm Decline
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={working}
                    onClick={() => {
                      setShowReject(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {estimate.company?.phone && (
          <p className="text-center text-xs text-gray-400">
            Questions? Call {estimate.company.phone}
            {estimate.company.email ? ` · ${estimate.company.email}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
