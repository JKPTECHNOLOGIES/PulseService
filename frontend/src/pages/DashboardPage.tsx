import { useNavigate } from "react-router-dom";
import {
  BriefcaseIcon,
  DocumentDuplicateIcon,
  CurrencyDollarIcon,
  UsersIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useJobs } from "../hooks/useJobs";
import { useInvoices } from "../hooks/useInvoices";
import { useRevenueReport } from "../hooks/useReports";
import StatCard from "../components/ui/StatCard";
import Card from "../components/ui/Card";
import { StatusBadge } from "../components/ui/Badge";
import { PageSpinner } from "../components/ui/Spinner";
import Button from "../components/ui/Button";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import { Job, Invoice } from "../types";

interface ChartTooltipProps {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: ChartTooltipProps) {
  if (active && payload && payload.length > 0) {
    const value = payload[0]?.value ?? 0;
    return (
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-sm font-semibold text-gray-900">
          {formatCurrency(value)}
        </p>
      </div>
    );
  }
  return null;
}

export default function DashboardPage() {
  const navigate = useNavigate();

  const todayStr = new Date().toISOString().split("T")[0];
  const { data: recentJobsData, isLoading: jobsLoading } = useJobs({
    limit: 5,
  });
  const { data: todayJobsData } = useJobs({ limit: 100, date: todayStr });
  const { data: openInvoicesData } = useInvoices({
    status: "sent,viewed,partial,overdue",
    limit: 100,
  });
  const { data: recentInvoicesData, isLoading: invoicesLoading } = useInvoices({
    limit: 5,
  });
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  const { data: revenueData, isLoading: revenueLoading } = useRevenueReport({
    from: twelveMonthsAgo.toISOString().slice(0, 10),
    to: todayStr,
    granularity: "month",
  });

  const recentJobs: Job[] = recentJobsData?.data ?? [];
  const recentInvoices: Invoice[] = recentInvoicesData?.data ?? [];
  const todayJobs = todayJobsData?.data ?? [];
  const openInvoices = openInvoicesData?.data ?? [];
  const chartData = revenueData?.data ?? [];

  const openInvoicesTotal = openInvoices.reduce(
    (sum, inv) => sum + inv.balance,
    0,
  );
  const monthlyRevenue =
    chartData.length > 0 ? chartData[chartData.length - 1].total : 0;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <StatCard
          title="Today's Work Orders"
          value={todayJobs.length}
          subtitle="Work orders scheduled today"
          icon={<BriefcaseIcon />}
          color="blue"
        />
        <StatCard
          title="Open Invoices"
          value={openInvoices.length}
          subtitle={formatCurrency(openInvoicesTotal) + " outstanding"}
          icon={<DocumentDuplicateIcon />}
          color="yellow"
        />
        <StatCard
          title="Monthly Revenue"
          value={formatCurrency(monthlyRevenue)}
          subtitle="Current month"
          icon={<CurrencyDollarIcon />}
          color="green"
        />
        <StatCard
          title="Open Customers"
          value={recentJobsData?.pagination.total ?? 0}
          subtitle="Total active work orders"
          icon={<UsersIcon />}
          color="purple"
        />
      </div>

      {/* Revenue chart */}
      <Card title="Revenue (Last 12 Months)">
        {revenueLoading ? (
          <PageSpinner />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#colorRevenue)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Tables row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Recent Jobs */}
        <Card
          title="Recent Work Orders"
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigate("/jobs");
              }}
            >
              View All
            </Button>
          }
        >
          {jobsLoading ? (
            <PageSpinner />
          ) : (
            <div className="overflow-x-auto -mx-6 -mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-6 font-medium text-gray-500 text-xs">
                      WO #
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">
                      CUSTOMER
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">
                      STATUS
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">
                      SCHEDULED
                    </th>
                    <th className="text-right py-2 px-6 font-medium text-gray-500 text-xs">
                      AMOUNT
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-gray-400 text-sm px-6"
                      >
                        No work orders yet
                      </td>
                    </tr>
                  ) : (
                    recentJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          navigate(`/jobs/${job.id}`);
                        }}
                      >
                        <td className="py-3 px-6 font-medium text-primary-600 text-xs">
                          #{job.jobNumber}
                        </td>
                        <td className="py-3 px-3 text-gray-900">
                          {job.customer
                            ? `${job.customer.firstName} ${job.customer.lastName}`
                            : "-"}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={job.status} type="job" />
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {formatDateTime(job.scheduledStart)}
                        </td>
                        <td className="py-3 px-6 text-right font-medium text-gray-900">
                          {formatCurrency(job.totalAmount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Recent Invoices */}
        <Card
          title="Recent Invoices"
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigate("/invoices");
              }}
            >
              View All
            </Button>
          }
        >
          {invoicesLoading ? (
            <PageSpinner />
          ) : (
            <div className="overflow-x-auto -mx-6 -mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-6 font-medium text-gray-500 text-xs">
                      INV #
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">
                      CUSTOMER
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">
                      TOTAL
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">
                      BALANCE
                    </th>
                    <th className="text-left py-2 px-6 font-medium text-gray-500 text-xs">
                      STATUS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-gray-400 text-sm px-6"
                      >
                        No invoices yet
                      </td>
                    </tr>
                  ) : (
                    recentInvoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          navigate(`/invoices/${inv.id}`);
                        }}
                      >
                        <td className="py-3 px-6 font-medium text-primary-600 text-xs">
                          #{inv.invoiceNumber}
                        </td>
                        <td className="py-3 px-3 text-gray-900">
                          {inv.customer
                            ? `${inv.customer.firstName} ${inv.customer.lastName}`
                            : "-"}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-gray-900">
                          {formatCurrency(inv.total)}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-600">
                          {formatCurrency(inv.balance)}
                        </td>
                        <td className="py-3 px-6">
                          <StatusBadge status={inv.status} type="invoice" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/jobs/new");
          }}
        >
          New Work Order
        </Button>
        <Button
          variant="outline"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/customers/new");
          }}
        >
          New Customer
        </Button>
        <Button
          variant="outline"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/estimates/new");
          }}
        >
          New Quote
        </Button>
        <Button
          variant="outline"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/invoices/new");
          }}
        >
          New Invoice
        </Button>
      </div>
    </div>
  );
}
