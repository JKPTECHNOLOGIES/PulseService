import { useState } from "react";
import { Tab } from "@headlessui/react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  BriefcaseIcon,
  CheckCircleIcon,
  ClockIcon,
  UsersIcon,
  CurrencyDollarIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { Link } from "react-router-dom";
import {
  useRevenueReport,
  useJobsReport,
  useTechniciansReport,
  useCustomersReport,
  useArAgingReport,
  useSalesBySourceReport,
  useEstimatePipelineReport,
  useInventoryReport,
  type RevenuePeriod,
  type RevenueSource,
} from "../hooks/useReports";
import StatCard from "../components/ui/StatCard";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency, formatDate } from "../utils/formatters";
import { downloadCsv } from "../utils/csv";
import { useLookup } from "../hooks/useMetadata";

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
];

// Every revenue source the report can compute. Kept in one place so the
// source picker, stat cards, chart series, and CSV export all stay in sync.
const REVENUE_SOURCE_OPTIONS: {
  key: RevenueSource;
  label: string;
  color: string;
  statColor: "blue" | "green" | "purple";
}[] = [
  { key: "invoiced", label: "Invoiced", color: "#3b82f6", statColor: "blue" },
  { key: "collected", label: "Collected", color: "#10b981", statColor: "green" },
  {
    key: "agreements",
    label: "Contracts",
    color: "#8b5cf6",
    statColor: "purple",
  },
];

const RANGE_PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "12M", days: 365 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function RevenueTab() {
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => todayIso());
  const [granularity, setGranularity] = useState<"day" | "week" | "month">(
    "day",
  );
  const [sources, setSources] = useState<RevenueSource[]>([
    "invoiced",
    "collected",
    "agreements",
  ]);

  const { data, isLoading } = useRevenueReport({
    from,
    to,
    granularity,
    sources: sources.join(","),
  });

  const chartData = data?.data ?? [];
  const activeSources = REVENUE_SOURCE_OPTIONS.filter((s) =>
    sources.includes(s.key),
  );
  const totals = REVENUE_SOURCE_OPTIONS.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s.key] = chartData.reduce((sum, d) => sum + (d[s.key] ?? 0), 0);
      return acc;
    },
    {},
  );
  const grandTotal = chartData.reduce((sum, d) => sum + d.total, 0);

  const toggleSource = (key: RevenueSource) => {
    setSources((prev) => {
      if (prev.includes(key)) {
        // Always keep at least one source selected so the chart/table never
        // go fully empty.
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      }
      return [...prev, key];
    });
  };

  const applyPreset = (days: number) => {
    setTo(todayIso());
    setFrom(isoDaysAgo(days));
  };

  const isPresetActive = (days: number) => from === isoDaysAgo(days) && to === todayIso();

  return (
    <div className="space-y-5">
      {/* Time range + granularity */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              min={from}
              max={todayIso()}
              onChange={(e) => {
                setTo(e.target.value);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  applyPreset(p.days);
                }}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  isPresetActive(p.days)
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Group by
            </label>
            <select
              value={granularity}
              onChange={(e) => {
                setGranularity(e.target.value as "day" | "week" | "month");
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={chartData.length === 0}
          onClick={() => {
            downloadCsv(
              "revenue",
              chartData,
              [
                { header: "Period", value: (r) => r.label },
                ...activeSources.map((s) => ({
                  header: s.label,
                  value: (r: RevenuePeriod) => r[s.key] ?? 0,
                })),
                { header: "Total", value: (r) => r.total },
              ],
            );
          }}
        >
          Export CSV
        </Button>
      </div>

      {/* Source picker -- pick and choose what to include */}
      <div className="flex flex-wrap gap-2">
        {REVENUE_SOURCE_OPTIONS.map((s) => {
          const active = sources.includes(s.key);
          return (
            <button
              key={s.key}
              onClick={() => {
                toggleSource(s.key);
              }}
              className={clsx(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "border-gray-300 bg-white text-gray-900 shadow-sm"
                  : "border-gray-200 bg-gray-50 text-gray-400",
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: active ? s.color : "#d1d5db" }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Totals for the selected sources */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {activeSources.map((s) => (
          <StatCard
            key={s.key}
            title={s.label}
            value={formatCurrency(totals[s.key] ?? 0)}
            icon={<CurrencyDollarIcon />}
            color={s.statColor}
          />
        ))}
        <StatCard
          title="Combined Total"
          value={formatCurrency(grandTotal)}
          icon={<CurrencyDollarIcon />}
          color="yellow"
        />
      </div>

      <Card title="Revenue Over Time">
        {isLoading ? (
          <PageSpinner />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">
            No revenue data for this range.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                minTickGap={20}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeSources.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                  Period
                </th>
                {activeSources.map((s) => (
                  <th
                    key={s.key}
                    className="text-right py-2 font-medium text-gray-500 text-xs uppercase"
                  >
                    {s.label}
                  </th>
                ))}
                <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {chartData.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeSources.length + 2}
                    className="py-8 text-center text-gray-400"
                  >
                    No revenue data for this range.
                  </td>
                </tr>
              ) : (
                chartData.map((d) => (
                  <tr key={d.period} className="hover:bg-gray-50">
                    <td className="py-2.5 text-gray-900">{d.label}</td>
                    {activeSources.map((s) => (
                      <td
                        key={s.key}
                        className="py-2.5 text-right text-gray-600"
                      >
                        {formatCurrency(d[s.key] ?? 0)}
                      </td>
                    ))}
                    <td className="py-2.5 text-right font-medium text-gray-900">
                      {formatCurrency(d.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function JobsTab() {
  const { data, isLoading } = useJobsReport();
  const { getLabel: getJobStatusLabel } = useLookup("jobStatus");
  if (isLoading) return <PageSpinner />;

  const report = data;
  const completionRate =
    report && report.total > 0
      ? Math.round((report.completed / report.total) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <StatCard
          title="Total Work Orders"
          value={report?.total ?? 0}
          icon={<BriefcaseIcon />}
          color="blue"
        />
        <StatCard
          title="Completed"
          value={report?.completed ?? 0}
          icon={<CheckCircleIcon />}
          color="green"
        />
        <StatCard
          title="Completion Rate"
          value={`${String(completionRate)}%`}
          icon={<CheckCircleIcon />}
          color="purple"
        />
        <StatCard
          title="Avg Duration"
          value={`${String(report?.avgDuration ?? 0)}h`}
          icon={<ClockIcon />}
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Work Orders by Status">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={report?.byStatus ?? []}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(entry: { status: string }) =>
                  getJobStatusLabel(entry.status)
                }
              >
                {(report?.byStatus ?? []).map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Work Orders by Type">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={report?.byType ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="type"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function TechniciansTab() {
  const { data, isLoading } = useTechniciansReport();
  if (isLoading) return <PageSpinner />;

  const techs = data ?? [];

  return (
    <Card title="Technician Performance">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
              Technician
            </th>
            <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
              Work Orders Completed
            </th>
            <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
              Revenue Generated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {techs.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-8 text-center text-gray-400">
                No data available
              </td>
            </tr>
          ) : (
            techs.map((t) => (
              <tr key={t.technicianId} className="hover:bg-gray-50">
                <td className="py-3 font-medium text-gray-900">{t.name}</td>
                <td className="py-3 text-right text-gray-600">
                  {t.jobsCompleted}
                </td>
                <td className="py-3 text-right font-medium text-gray-900">
                  {formatCurrency(t.revenue)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

function CustomersTab() {
  const { data, isLoading } = useCustomersReport();
  if (isLoading) return <PageSpinner />;

  const report = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Total Customers"
          value={report?.total ?? 0}
          icon={<UsersIcon />}
          color="blue"
        />
        <StatCard
          title="New This Month"
          value={report?.newThisMonth ?? 0}
          icon={<UsersIcon />}
          color="green"
        />
        <StatCard
          title="Avg Revenue/Customer"
          value={formatCurrency(report?.avgRevenue ?? 0)}
          icon={<UsersIcon />}
          color="purple"
        />
      </div>

      <Card title="Top 10 Customers">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                Customer
              </th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                Jobs
              </th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                Total Revenue
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(report?.topCustomers ?? []).length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-gray-400">
                  No data available
                </td>
              </tr>
            ) : (
              (report?.topCustomers ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="py-3 text-right text-gray-600">{c.jobs}</td>
                  <td className="py-3 text-right font-medium text-gray-900">
                    {formatCurrency(c.revenue)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ArAgingTab() {
  const { data, isLoading } = useArAgingReport();
  if (isLoading) return <PageSpinner />;

  const buckets = data?.buckets ?? [];
  const invoices = data?.invoices ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          title="Total Outstanding"
          value={formatCurrency(data?.totalOutstanding ?? 0)}
          icon={<CurrencyDollarIcon />}
          color="blue"
        />
        {buckets.map((b) => (
          <StatCard
            key={b.key}
            title={b.label}
            value={formatCurrency(b.amount)}
            subtitle={`${String(b.count)} invoice${b.count === 1 ? "" : "s"}`}
            icon={<ClockIcon />}
            color={
              b.key === "90+" ? "red" : b.key === "current" ? "green" : "yellow"
            }
          />
        ))}
      </div>

      <Card title="Outstanding Invoices">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[36rem]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                  Invoice
                </th>
                <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                  Customer
                </th>
                <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                  Due
                </th>
                <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                  Days Overdue
                </th>
                <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    No outstanding invoices to show.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="py-3 font-medium">
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="text-primary-600 hover:text-primary-700"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="py-3 text-gray-700">{inv.customerName}</td>
                    <td className="py-3 text-gray-500">
                      {formatDate(inv.dueDate)}
                    </td>
                    <td
                      className={clsx(
                        "py-3 text-right font-medium",
                        inv.daysOverdue > 60
                          ? "text-red-600"
                          : inv.daysOverdue > 0
                            ? "text-amber-600"
                            : "text-gray-500",
                      )}
                    >
                      {inv.daysOverdue > 0 ? inv.daysOverdue : "\u2014"}
                    </td>
                    <td className="py-3 text-right font-semibold text-gray-900">
                      {formatCurrency(inv.balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SalesTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, isLoading } = useSalesBySourceReport({
    from: from || undefined,
    to: to || undefined,
  });

  const sources = data?.sources ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={sources.length === 0}
          onClick={() => {
            downloadCsv("sales-by-source", sources, [
              { header: "Source", value: (r) => r.source },
              { header: "Invoices", value: (r) => r.invoiceCount },
              { header: "Invoiced", value: (r) => r.invoiced },
              { header: "Collected", value: (r) => r.collected },
            ]);
          }}
        >
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <StatCard
          title="Total Invoiced"
          value={formatCurrency(data?.totalInvoiced ?? 0)}
          icon={<CurrencyDollarIcon />}
          color="blue"
        />
        <StatCard
          title="Total Collected"
          value={formatCurrency(data?.totalCollected ?? 0)}
          icon={<CurrencyDollarIcon />}
          color="green"
        />
      </div>

      <Card title="Revenue by Source">
        {isLoading ? (
          <PageSpinner />
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sources}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="source" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar
                    dataKey="invoiced"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-sm mt-4">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                    Source
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                    Invoices
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                    Invoiced
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                    Collected
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sources.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400">
                      No data for this range.
                    </td>
                  </tr>
                ) : (
                  sources.map((s) => (
                    <tr key={s.source} className="hover:bg-gray-50">
                      <td className="py-3 font-medium text-gray-900 capitalize">
                        {s.source}
                      </td>
                      <td className="py-3 text-right text-gray-600">
                        {s.invoiceCount}
                      </td>
                      <td className="py-3 text-right text-gray-900">
                        {formatCurrency(s.invoiced)}
                      </td>
                      <td className="py-3 text-right text-green-600">
                        {formatCurrency(s.collected)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}

function EstimatesTab() {
  const { data, isLoading } = useEstimatePipelineReport();
  const { getLabel: getStatusLabel } = useLookup("estimateStatus");
  if (isLoading) return <PageSpinner />;

  const byStatus = data?.byStatus ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Win Rate"
          value={`${String(data?.winRate ?? 0)}%`}
          subtitle="approved of decided"
          icon={<CheckCircleIcon />}
          color="green"
        />
        <StatCard
          title="Approved Value"
          value={formatCurrency(data?.approvedValue ?? 0)}
          subtitle={`${String(data?.approvedCount ?? 0)} quotes`}
          icon={<CurrencyDollarIcon />}
          color="blue"
        />
        <StatCard
          title="Open Pipeline"
          value={formatCurrency(data?.openValue ?? 0)}
          subtitle="draft / sent / viewed"
          icon={<CurrencyDollarIcon />}
          color="yellow"
        />
      </div>

      <Card title="Quotes by Status">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                Status
              </th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                Count
              </th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {byStatus.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-gray-400">
                  No quotes yet.
                </td>
              </tr>
            ) : (
              byStatus.map((s) => (
                <tr key={s.status} className="hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-900">
                    {getStatusLabel(s.status)}
                  </td>
                  <td className="py-3 text-right text-gray-600">{s.count}</td>
                  <td className="py-3 text-right text-gray-900">
                    {formatCurrency(s.value)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function InventoryReportTab() {
  const { data, isLoading } = useInventoryReport();
  const { getLabel: getPoStatusLabel } = useLookup("poStatus");
  const { getLabel: getCostSourceLabel } = useLookup("costChangeSource");

  if (isLoading) return <PageSpinner />;
  if (!data) return null;

  const locationChart = data.valueByLocation.map((l) => ({
    name: l.code,
    value: l.value,
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <StatCard
          title="Inventory Value"
          value={formatCurrency(data.totals.totalValue)}
          icon={<CurrencyDollarIcon />}
          color="blue"
        />
        <StatCard
          title="Active Items"
          value={data.totals.totalItems}
          icon={<BriefcaseIcon />}
          color="purple"
        />
        <StatCard
          title="Below Reorder Point"
          value={data.totals.lowStockCount}
          icon={<ClockIcon />}
          color={data.totals.lowStockCount > 0 ? "yellow" : "green"}
        />
        <StatCard
          title="Received (30d)"
          value={formatCurrency(data.totals.received30d)}
          icon={<CheckCircleIcon />}
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Value by location">
          {locationChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={locationChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  labelFormatter={(label) => `Location: ${String(label)}`}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {locationChart.map((entry, idx) => (
                    <Cell
                      key={entry.name}
                      fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">
              No stocked locations
            </p>
          )}
        </Card>

        <Card title="Purchase orders by status">
          {data.poByStatus.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Count</th>
                  <th className="py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.poByStatus.map((g) => (
                  <tr key={g.status}>
                    <td className="py-2.5 text-gray-700">
                      {getPoStatusLabel(g.status)}
                    </td>
                    <td className="py-2.5 text-right text-gray-600">
                      {g.count}
                    </td>
                    <td className="py-2.5 text-right text-gray-700">
                      {formatCurrency(g.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">
              No purchase orders yet
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Top items by stock value">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium text-right">On hand</th>
                <th className="py-2 font-medium text-right">Avg cost</th>
                <th className="py-2 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.topItemsByValue.map((i) => (
                <tr key={i.id}>
                  <td className="py-2.5">
                    <span className="font-medium text-gray-900">{i.name}</span>
                    <span className="font-mono text-xs text-gray-400 ml-2">
                      {i.sku}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-gray-600">
                    {i.onHand}
                  </td>
                  <td className="py-2.5 text-right text-gray-600">
                    {formatCurrency(i.unitCost)}
                  </td>
                  <td className="py-2.5 text-right font-medium text-gray-900">
                    {formatCurrency(i.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Recent cost changes (weighted average)">
          {data.recentCostChanges.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="py-2 font-medium">Item</th>
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium text-right">Old → New</th>
                  <th className="py-2 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.recentCostChanges.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 text-gray-700">{c.name}</td>
                    <td className="py-2.5 text-gray-500 text-xs">
                      {getCostSourceLabel(c.changeSource)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="text-gray-400">
                        {formatCurrency(c.oldUnitCost)}
                      </span>{" "}
                      →{" "}
                      <span
                        className={
                          c.newUnitCost >= c.oldUnitCost
                            ? "text-red-600 font-medium"
                            : "text-green-700 font-medium"
                        }
                      >
                        {formatCurrency(c.newUnitCost)}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-gray-500 text-xs">
                      {formatDate(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">
              No cost changes recorded yet
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const tabs = [
    "Revenue",
    "Sales",
    "Quotes",
    "Work Orders",
    "Technicians",
    "Customers",
    "AR Aging",
    "Inventory",
  ];

  return (
    <div className="space-y-5">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full">
          {tabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                clsx(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selected
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="mt-5">
          <Tab.Panel>
            <RevenueTab />
          </Tab.Panel>
          <Tab.Panel>
            <SalesTab />
          </Tab.Panel>
          <Tab.Panel>
            <EstimatesTab />
          </Tab.Panel>
          <Tab.Panel>
            <JobsTab />
          </Tab.Panel>
          <Tab.Panel>
            <TechniciansTab />
          </Tab.Panel>
          <Tab.Panel>
            <CustomersTab />
          </Tab.Panel>
          <Tab.Panel>
            <ArAgingTab />
          </Tab.Panel>
          <Tab.Panel>
            <InventoryReportTab />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
