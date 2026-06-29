import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon, EyeIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useInvoices, useSendInvoice } from '../hooks/useInvoices';
import Button from '../components/ui/Button';
import SearchInput from '../components/ui/SearchInput';
import Pagination from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency, formatDate, capitalize } from '../utils/formatters';

const STATUS_FILTERS = ['all', 'draft', 'sent', 'paid', 'overdue', 'void'];

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const { data, isLoading } = useInvoices({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== 'all' ? status : undefined,
  });
  const sendInvoice = useSendInvoice();

  const invoices = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{pagination ? `${pagination.total} invoices` : ''}</p>
        <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('/invoices/new')}>
          New Invoice
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search invoices..."
          className="sm:w-72"
        />
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors',
                status === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {s === 'all' ? 'All' : capitalize(s)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices found"
            action={{ label: 'New Invoice', onClick: () => navigate('/invoices/new') }}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">Invoice</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Customer</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Due Date</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">Total</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">Balance</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Status</th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3.5 px-5 font-medium text-primary-600">#{inv.invoiceNumber}</td>
                      <td className="py-3.5 px-3 text-gray-900">
                        {inv.customer ? `${inv.customer.firstName} ${inv.customer.lastName}` : '-'}
                      </td>
                      <td className="py-3.5 px-3 text-gray-500 text-xs">{formatDate(inv.dueDate)}</td>
                      <td className="py-3.5 px-3 text-right font-medium text-gray-900">{formatCurrency(inv.total)}</td>
                      <td className="py-3.5 px-3 text-right font-medium">
                        <span className={inv.balance > 0 ? 'text-red-600' : 'text-green-600'}>
                          {formatCurrency(inv.balance)}
                        </span>
                      </td>
                      <td className="py-3.5 px-3"><StatusBadge status={inv.status} type="invoice" /></td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => navigate(`/invoices/${inv.id}`)}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="View"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          {inv.status === 'draft' && (
                            <button
                              onClick={() => sendInvoice.mutate(inv.id)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Send"
                            >
                              <PaperAirplaneIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
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
