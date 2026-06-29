import { useState } from 'react';
import { Tab } from '@headlessui/react';
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
} from 'recharts';
import {
  BriefcaseIcon,
  CheckCircleIcon,
  ClockIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import {
  useRevenueReport,
  useJobsReport,
  useTechniciansReport,
  useCustomersReport,
} from '../hooks/useReports';
import StatCard from '../components/ui/StatCard';
import Card from '../components/ui/Card';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency, capitalize } from '../utils/formatters';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

function RevenueTab() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = useRevenueReport({ months });

  const chartData = data || [];
  const totalRevenue = chartData.reduce((sum, d) => sum + d.revenue, 0);

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { label: 'This Month', value: 1 },
          { label: 'Last 3 Months', value: 3 },
          { label: 'Last 12 Months', value: 12 },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setMonths(opt.value)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              months === opt.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <Card title={`Revenue Overview (${formatCurrency(totalRevenue)} total)`}>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
              <Area type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Monthly Breakdown">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">Month</th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Invoices</th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {chartData.map((d, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="py-2.5 text-gray-900">{d.month}</td>
                <td className="py-2.5 text-right text-gray-600">{d.invoiceCount}</td>
                <td className="py-2.5 text-right font-medium text-gray-900">{formatCurrency(d.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function JobsTab() {
  const { data, isLoading } = useJobsReport();
  if (isLoading) return <PageSpinner />;

  const report = data;
  const completionRate = report && report.total > 0 ? Math.round((report.completed / report.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <StatCard title="Total Jobs" value={report?.total || 0} icon={<BriefcaseIcon />} color="blue" />
        <StatCard title="Completed" value={report?.completed || 0} icon={<CheckCircleIcon />} color="green" />
        <StatCard title="Completion Rate" value={`${completionRate}%`} icon={<CheckCircleIcon />} color="purple" />
        <StatCard title="Avg Duration" value={`${report?.avgDuration || 0}h`} icon={<ClockIcon />} color="yellow" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Jobs by Status">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={report?.byStatus || []}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(entry: any) => capitalize(entry.status)}
              >
                {(report?.byStatus || []).map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Jobs by Type">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={report?.byType || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="type" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
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

  const techs = data || [];

  return (
    <Card title="Technician Performance">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">Technician</th>
            <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Jobs Completed</th>
            <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Revenue Generated</th>
            <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Avg Jobs/Week</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {techs.length === 0 ? (
            <tr><td colSpan={4} className="py-8 text-center text-gray-400">No data available</td></tr>
          ) : (
            techs.map((t) => (
              <tr key={t.technicianId} className="hover:bg-gray-50">
                <td className="py-3 font-medium text-gray-900">{t.name}</td>
                <td className="py-3 text-right text-gray-600">{t.jobsCompleted}</td>
                <td className="py-3 text-right font-medium text-gray-900">{formatCurrency(t.revenue)}</td>
                <td className="py-3 text-right text-gray-600">{t.avgJobsPerWeek.toFixed(1)}</td>
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
        <StatCard title="Total Customers" value={report?.total || 0} icon={<UsersIcon />} color="blue" />
        <StatCard title="New This Month" value={report?.newThisMonth || 0} icon={<UsersIcon />} color="green" />
        <StatCard title="Avg Revenue/Customer" value={formatCurrency(report?.avgRevenue || 0)} icon={<UsersIcon />} color="purple" />
      </div>

      <Card title="Top 10 Customers">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">Customer</th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Jobs</th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">Total Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(report?.topCustomers || []).length === 0 ? (
              <tr><td colSpan={3} className="py-8 text-center text-gray-400">No data available</td></tr>
            ) : (
              (report?.topCustomers || []).map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="py-3 text-right text-gray-600">{c.jobs}</td>
                  <td className="py-3 text-right font-medium text-gray-900">{formatCurrency(c.revenue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const tabs = ['Revenue', 'Jobs', 'Technicians', 'Customers'];

  return (
    <div className="space-y-5">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                clsx(
                  'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  selected ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="mt-5">
          <Tab.Panel><RevenueTab /></Tab.Panel>
          <Tab.Panel><JobsTab /></Tab.Panel>
          <Tab.Panel><TechniciansTab /></Tab.Panel>
          <Tab.Panel><CustomersTab /></Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
