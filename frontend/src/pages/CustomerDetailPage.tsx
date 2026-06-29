import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Tab } from '@headlessui/react';
import {
  PencilIcon,
  PlusIcon,
  ChevronRightIcon,
  BuildingOfficeIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useCustomer } from '../hooks/useCustomers';
import { useJobs } from '../hooks/useJobs';
import { useEstimates } from '../hooks/useEstimates';
import { useInvoices } from '../hooks/useInvoices';
import Button from '../components/ui/Button';
import { StatusBadge } from '../components/ui/Badge';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency, formatDate, formatDateTime, formatPhone } from '../utils/formatters';

const TABS = ['Overview', 'Jobs', 'Estimates', 'Invoices'];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);

  const { data: customer, isLoading } = useCustomer(id!);
  const { data: jobsData } = useJobs({ limit: 50 });
  const { data: estimatesData } = useEstimates({ customerId: id, limit: 50 });
  const { data: invoicesData } = useInvoices({ customerId: id, limit: 50 });

  const customerJobs = (jobsData?.data || []).filter((j) => j.customerId === id);
  const estimates = estimatesData?.data || [];
  const invoices = invoicesData?.data || [];

  if (isLoading) return <PageSpinner />;
  if (!customer) return <div className="text-center py-12 text-gray-500">Customer not found</div>;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link to="/customers" className="hover:text-primary-600 transition-colors">Customers</Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium">
          {customer.firstName} {customer.lastName}
        </span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-primary-700">
                {customer.firstName.charAt(0)}{customer.lastName.charAt(0)}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {customer.firstName} {customer.lastName}
              </h2>
              {customer.companyName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <BuildingOfficeIcon className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-sm text-gray-600">{customer.companyName}</span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                #{customer.customerNumber} &middot; Customer since {formatDate(customer.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => navigate('/jobs/new', { state: { customerId: id } })}
            >
              New Job
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<PencilIcon className="h-4 w-4" />}
              onClick={() => navigate(`/customers/${id}/edit`)}
            >
              Edit
            </Button>
          </div>
        </div>

        {/* Quick info */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 pt-5 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500">Phone</p>
            <div className="flex items-center gap-1.5 mt-1">
              <PhoneIcon className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-sm font-medium text-gray-900">{formatPhone(customer.phone)}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Email</p>
            <div className="flex items-center gap-1.5 mt-1">
              <EnvelopeIcon className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-sm font-medium text-gray-900 truncate">{customer.email || '-'}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Type</p>
            <span className={clsx(
              'mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
              customer.type === 'commercial' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            )}>
              {customer.type}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500">Balance</p>
            <p className={clsx(
              'text-sm font-bold mt-1',
              customer.balance > 0 ? 'text-red-600' : 'text-green-600'
            )}>
              {formatCurrency(customer.balance)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                clsx(
                  'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  selected
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          {/* Overview */}
          <Tab.Panel className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Contact Information</h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-gray-500">Full Name</dt>
                    <dd className="text-sm font-medium text-gray-900 mt-0.5">
                      {customer.firstName} {customer.lastName}
                    </dd>
                  </div>
                  {customer.phone && (
                    <div>
                      <dt className="text-xs text-gray-500">Phone</dt>
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">{formatPhone(customer.phone)}</dd>
                    </div>
                  )}
                  {customer.mobilePhone && (
                    <div>
                      <dt className="text-xs text-gray-500">Mobile</dt>
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">{formatPhone(customer.mobilePhone)}</dd>
                    </div>
                  )}
                  {customer.email && (
                    <div>
                      <dt className="text-xs text-gray-500">Email</dt>
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">{customer.email}</dd>
                    </div>
                  )}
                  {customer.notes && (
                    <div>
                      <dt className="text-xs text-gray-500">Notes</dt>
                      <dd className="text-sm text-gray-700 mt-0.5">{customer.notes}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Locations</h3>
                {customer.locations && customer.locations.length > 0 ? (
                  <div className="space-y-3">
                    {customer.locations.map((loc) => (
                      <div key={loc.id} className="flex gap-2">
                        <MapPinIcon className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {loc.name}
                            {loc.isPrimary && (
                              <span className="ml-2 text-xs text-primary-600">(Primary)</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            {loc.address}, {loc.city}, {loc.state} {loc.zip}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No locations on file</p>
                )}
              </div>
            </div>
          </Tab.Panel>

          {/* Jobs */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">JOB #</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">SUMMARY</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">STATUS</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">SCHEDULED</th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">AMOUNT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {customerJobs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">No jobs found</td>
                    </tr>
                  ) : (
                    customerJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/jobs/${job.id}`)}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">#{job.jobNumber}</td>
                        <td className="py-3 px-3 text-gray-900">{job.summary}</td>
                        <td className="py-3 px-3">
                          <StatusBadge status={job.status} type="job" />
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">{formatDateTime(job.scheduledStart)}</td>
                        <td className="py-3 px-5 text-right font-medium">{formatCurrency(job.totalAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>

          {/* Estimates */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">ESTIMATE #</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">TITLE</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">STATUS</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">DATE</th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {estimates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">No estimates</td>
                    </tr>
                  ) : (
                    estimates.map((est) => (
                      <tr
                        key={est.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/estimates/${est.id}`)}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">#{est.estimateNumber}</td>
                        <td className="py-3 px-3 text-gray-900">{est.title}</td>
                        <td className="py-3 px-3"><StatusBadge status={est.status} type="estimate" /></td>
                        <td className="py-3 px-3 text-gray-500 text-xs">{formatDate(est.createdAt)}</td>
                        <td className="py-3 px-5 text-right font-medium">{formatCurrency(est.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>

          {/* Invoices */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">INVOICE #</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">STATUS</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">DUE DATE</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs">TOTAL</th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">BALANCE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">No invoices</td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">#{inv.invoiceNumber}</td>
                        <td className="py-3 px-3"><StatusBadge status={inv.status} type="invoice" /></td>
                        <td className="py-3 px-3 text-gray-500 text-xs">{formatDate(inv.dueDate)}</td>
                        <td className="py-3 px-3 text-right font-medium">{formatCurrency(inv.total)}</td>
                        <td className="py-3 px-5 text-right font-medium text-red-600">{formatCurrency(inv.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
