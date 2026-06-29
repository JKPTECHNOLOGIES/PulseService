import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CurrencyDollarIcon } from '@heroicons/react/24/outline';
import api from '../lib/api';
import { Payment, PaginatedResponse, Customer, Invoice } from '../types';
import StatCard from '../components/ui/StatCard';
import Pagination from '../components/ui/Pagination';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency, formatDateTime } from '../utils/formatters';

type PaymentWithRelations = Payment & { customer?: Customer; invoice?: Invoice };

const METHOD_COLORS: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  check: 'bg-blue-100 text-blue-700',
  credit_card: 'bg-purple-100 text-purple-700',
  ach: 'bg-indigo-100 text-indigo-700',
};

function usePayments(page: number) {
  return useQuery({
    queryKey: ['payments', page],
    queryFn: async () => {
      const data = await api.get('/payments', { params: { page, limit: 20 } });
      return data as unknown as PaginatedResponse<PaymentWithRelations>;
    },
  });
}

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePayments(page);

  const payments = data?.data || [];
  const pagination = data?.pagination;
  const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Total Collected"
          value={formatCurrency(totalRevenue)}
          subtitle="This page"
          icon={<CurrencyDollarIcon />}
          color="green"
        />
        <StatCard
          title="Payments Recorded"
          value={pagination?.total || payments.length}
          subtitle="All time"
          icon={<CurrencyDollarIcon />}
          color="blue"
        />
        <StatCard
          title="Average Payment"
          value={formatCurrency(payments.length > 0 ? totalRevenue / payments.length : 0)}
          icon={<CurrencyDollarIcon />}
          color="purple"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : payments.length === 0 ? (
          <EmptyState title="No payments recorded" description="Payments will appear here once recorded against invoices." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">Date</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Customer</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Invoice</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Method</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Reference</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Status</th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3.5 px-5 text-gray-700">{formatDateTime(p.paidAt)}</td>
                      <td className="py-3.5 px-3 text-gray-900">
                        {p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : '-'}
                      </td>
                      <td className="py-3.5 px-3 text-primary-600 font-medium">
                        {p.invoice ? `#${p.invoice.invoiceNumber}` : '-'}
                      </td>
                      <td className="py-3.5 px-3">
                        <Badge className={METHOD_COLORS[p.method] || 'bg-gray-100 text-gray-600'}>
                          {p.method.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-3 text-gray-500">{p.referenceNumber || '-'}</td>
                      <td className="py-3.5 px-3">
                        <Badge className="bg-green-100 text-green-700 capitalize">{p.status}</Badge>
                      </td>
                      <td className="py-3.5 px-5 text-right font-semibold text-green-600">
                        {formatCurrency(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && (
              <div className="px-5 py-4 border-t border-gray-100">
                <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
