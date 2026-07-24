import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Tab } from "@headlessui/react";
import {
  PencilIcon,
  PlusIcon,
  ChevronRightIcon,
  BuildingOfficeIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useCustomer, useDeleteCustomer } from "../hooks/useCustomers";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { useLookup } from "../hooks/useMetadata";
import { useJobs } from "../hooks/useJobs";
import { useEstimates } from "../hooks/useEstimates";
import { useInvoices } from "../hooks/useInvoices";
import { useEquipmentList } from "../hooks/useEquipment";
import { useAgreements } from "../hooks/useAgreements";
import Button from "../components/ui/Button";
import Badge, { StatusBadge } from "../components/ui/Badge";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import { PageSpinner } from "../components/ui/Spinner";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
} from "../utils/formatters";

const TABS = [
  "Overview",
  "Work Orders",
  "Quotes",
  "Invoices",
  "Equipment",
  "Agreements",
];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: customer, isLoading } = useCustomer(id ?? "");
  const deleteCustomer = useDeleteCustomer();

  const handleDelete = async () => {
    if (!id) return;
    await deleteCustomer.mutateAsync(id);
    navigate("/customers");
  };
  const { data: jobsData } = useJobs({ customerId: id, limit: 50 });
  const { data: estimatesData } = useEstimates({ customerId: id, limit: 50 });
  const { data: invoicesData } = useInvoices({ customerId: id, limit: 50 });
  const { data: equipmentData } = useEquipmentList({ customerId: id, limit: 50 });
  const { data: agreementsData } = useAgreements({ customerId: id, limit: 50 });
  const { getLabel: getCustomerTypeLabel, getColor: getCustomerTypeColor } =
    useLookup("customerType");
  const { getLabel: getEquipmentTypeLabel } = useLookup("equipmentType");
  const { getLabel: getConditionLabel, getColor: getConditionColor } =
    useLookup("equipmentCondition");
  const { getLabel: getBillingLabel } = useLookup("billingFrequency");

  const customerJobs = jobsData?.data ?? [];
  const estimates = estimatesData?.data ?? [];
  const invoices = invoicesData?.data ?? [];
  const equipment = equipmentData?.data ?? [];
  const agreements = agreementsData?.data ?? [];

  if (isLoading) return <PageSpinner />;
  if (!customer)
    return (
      <div className="text-center py-12 text-gray-500">Customer not found</div>
    );

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link
          to="/customers"
          className="hover:text-primary-600 transition-colors"
        >
          Customers
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium">
          {customer.firstName} {customer.lastName}
        </span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-primary-700">
                {customer.firstName.charAt(0)}
                {customer.lastName.charAt(0)}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {customer.firstName} {customer.lastName}
              </h2>
              {customer.companyName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <BuildingOfficeIcon className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {customer.companyName}
                  </span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                #{customer.customerNumber} &middot; Customer since{" "}
                {formatDate(customer.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                navigate("/jobs/new", { state: { customerId: id } });
              }}
            >
              New Work Order
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                navigate("/estimates/new", { state: { customerId: id } });
              }}
            >
              New Quote
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<PencilIcon className="h-4 w-4" />}
              onClick={() => {
                navigate(`/customers/${id ?? ""}/edit`);
              }}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<TrashIcon className="h-4 w-4" />}
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              Delete
            </Button>
          </div>
        </div>

        {/* Quick info */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 pt-5 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500">Phone</p>
            <div className="flex items-center gap-1.5 mt-1">
              <PhoneIcon className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-sm font-medium text-gray-900">
                {formatPhone(customer.phone)}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Email</p>
            <div className="flex items-center gap-1.5 mt-1">
              <EnvelopeIcon className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-sm font-medium text-gray-900 truncate">
                {customer.email ?? "-"}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Type</p>
            <span
              className={clsx(
                "mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                getCustomerTypeColor(customer.type),
              )}
            >
              {getCustomerTypeLabel(customer.type)}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500">Balance</p>
            <p
              className={clsx(
                "text-sm font-bold mt-1",
                customer.balance > 0 ? "text-red-600" : "text-green-600",
              )}
            >
              {formatCurrency(customer.balance)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Pricing Tier</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {customer.pricingTier
                ? customer.pricingTier.name
                : "Standard (catalog pricing)"}
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

        <Tab.Panels>
          {/* Overview */}
          <Tab.Panel className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">
                  Contact Information
                </h3>
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
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">
                        {formatPhone(customer.phone)}
                      </dd>
                    </div>
                  )}
                  {customer.mobilePhone && (
                    <div>
                      <dt className="text-xs text-gray-500">Mobile</dt>
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">
                        {formatPhone(customer.mobilePhone)}
                      </dd>
                    </div>
                  )}
                  {customer.email && (
                    <div>
                      <dt className="text-xs text-gray-500">Email</dt>
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">
                        {customer.email}
                      </dd>
                    </div>
                  )}
                  {customer.notes && (
                    <div>
                      <dt className="text-xs text-gray-500">Notes</dt>
                      <dd className="text-sm text-gray-700 mt-0.5">
                        {customer.notes}
                      </dd>
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
                              <span className="ml-2 text-xs text-primary-600">
                                (Primary)
                              </span>
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

            {/* Recent activity from every other tab, at a glance */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Work Orders */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Work Orders</h3>
                  {customerJobs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTab(TABS.indexOf("Work Orders"));
                      }}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      View all {customerJobs.length} &rarr;
                    </button>
                  )}
                </div>
                {customerJobs.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No work orders on file
                  </p>
                ) : (
                  <div className="space-y-1">
                    {customerJobs.slice(0, 5).map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-lg border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50"
                        onClick={() => {
                          navigate(`/jobs/${job.id}`);
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary-600 truncate">
                            #{job.jobNumber}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {job.summary}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={job.status} type="job" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(job.totalAmount)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quotes */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Quotes</h3>
                  {estimates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTab(TABS.indexOf("Quotes"));
                      }}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      View all {estimates.length} &rarr;
                    </button>
                  )}
                </div>
                {estimates.length === 0 ? (
                  <p className="text-sm text-gray-400">No quotes on file</p>
                ) : (
                  <div className="space-y-1">
                    {estimates.slice(0, 5).map((est) => (
                      <div
                        key={est.id}
                        className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-lg border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50"
                        onClick={() => {
                          navigate(`/estimates/${est.id}`);
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary-600 truncate">
                            #{est.estimateNumber}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {est.title}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={est.status} type="estimate" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(est.total)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Invoices */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Invoices</h3>
                  {invoices.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTab(TABS.indexOf("Invoices"));
                      }}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      View all {invoices.length} &rarr;
                    </button>
                  )}
                </div>
                {invoices.length === 0 ? (
                  <p className="text-sm text-gray-400">No invoices on file</p>
                ) : (
                  <div className="space-y-1">
                    {invoices.slice(0, 5).map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-lg border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50"
                        onClick={() => {
                          navigate(`/invoices/${inv.id}`);
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary-600 truncate">
                            #{inv.invoiceNumber}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            Due {formatDate(inv.dueDate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={inv.status} type="invoice" />
                          <span
                            className={clsx(
                              "text-sm font-medium",
                              inv.balance > 0 ? "text-red-600" : "text-gray-900",
                            )}
                          >
                            {formatCurrency(inv.balance)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Equipment */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Equipment</h3>
                  {equipment.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTab(TABS.indexOf("Equipment"));
                      }}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      View all {equipment.length} &rarr;
                    </button>
                  )}
                </div>
                {equipment.length === 0 ? (
                  <p className="text-sm text-gray-400">No equipment on file</p>
                ) : (
                  <div className="space-y-1">
                    {equipment.slice(0, 5).map((eq) => (
                      <div
                        key={eq.id}
                        className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-lg border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50"
                        onClick={() => {
                          navigate("/equipment", {
                            state: { customerId: id, equipmentId: eq.id },
                          });
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {eq.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {eq.serialNumber ?? "No serial"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {eq.condition ? (
                            <Badge className={getConditionColor(eq.condition)}>
                              {getConditionLabel(eq.condition)}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Agreements */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Agreements</h3>
                  {agreements.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTab(TABS.indexOf("Agreements"));
                      }}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      View all {agreements.length} &rarr;
                    </button>
                  )}
                </div>
                {agreements.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No service agreements on file
                  </p>
                ) : (
                  <div className="space-y-1">
                    {agreements.slice(0, 5).map((ag) => (
                      <div
                        key={ag.id}
                        className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-lg border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50"
                        onClick={() => {
                          navigate(`/agreements/${ag.id}`);
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary-600 truncate">
                            #{ag.agreementNumber}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {ag.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={ag.status} category="agreementStatus" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(ag.amount)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Photos & Attachments */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <AttachmentGallery entityType="customer" entityId={customer.id} />
            </div>
          </Tab.Panel>

          {/* Jobs */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">
                      WO #
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      SUMMARY
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      STATUS
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      SCHEDULED
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">
                      AMOUNT
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {customerJobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-gray-400"
                      >
                        No work orders found
                      </td>
                    </tr>
                  ) : (
                    customerJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          navigate(`/jobs/${job.id}`);
                        }}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">
                          #{job.jobNumber}
                        </td>
                        <td className="py-3 px-3 text-gray-900">
                          {job.summary}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={job.status} type="job" />
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {formatDateTime(job.scheduledStart)}
                        </td>
                        <td className="py-3 px-5 text-right font-medium">
                          {formatCurrency(job.totalAmount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>

          {/* Quotes */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">
                      QUOTE #
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      TITLE
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      STATUS
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      DATE
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">
                      TOTAL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {estimates.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-gray-400"
                      >
                        No quotes
                      </td>
                    </tr>
                  ) : (
                    estimates.map((est) => (
                      <tr
                        key={est.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          navigate(`/estimates/${est.id}`);
                        }}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">
                          #{est.estimateNumber}
                        </td>
                        <td className="py-3 px-3 text-gray-900">{est.title}</td>
                        <td className="py-3 px-3">
                          <StatusBadge status={est.status} type="estimate" />
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {formatDate(est.createdAt)}
                        </td>
                        <td className="py-3 px-5 text-right font-medium">
                          {formatCurrency(est.total)}
                        </td>
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
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">
                      INVOICE #
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      STATUS
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      DUE DATE
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs">
                      TOTAL
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">
                      BALANCE
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-gray-400"
                      >
                        No invoices
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          navigate(`/invoices/${inv.id}`);
                        }}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">
                          #{inv.invoiceNumber}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={inv.status} type="invoice" />
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {formatDate(inv.dueDate)}
                        </td>
                        <td className="py-3 px-3 text-right font-medium">
                          {formatCurrency(inv.total)}
                        </td>
                        <td className="py-3 px-5 text-right font-medium text-red-600">
                          {formatCurrency(inv.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>

          {/* Equipment */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-end p-3 border-b border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<PlusIcon className="h-4 w-4" />}
                  onClick={() => {
                    navigate("/equipment", {
                      state: { customerId: id, openNew: true },
                    });
                  }}
                >
                  Add Equipment
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">
                      EQUIPMENT
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      SERIAL #
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      INSTALLED
                    </th>
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">
                      CONDITION
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {equipment.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center py-8 text-gray-400"
                      >
                        No equipment on file
                      </td>
                    </tr>
                  ) : (
                    equipment.map((eq) => (
                      <tr
                        key={eq.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          navigate("/equipment", {
                            state: { customerId: id, equipmentId: eq.id },
                          });
                        }}
                      >
                        <td className="py-3 px-5">
                          <p className="font-medium text-gray-900">
                            {eq.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {[
                              eq.type ? getEquipmentTypeLabel(eq.type) : null,
                              eq.manufacturer,
                              eq.model,
                            ]
                              .filter(Boolean)
                              .join(" \u00b7 ")}
                          </p>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-gray-600">
                          {eq.serialNumber ?? "—"}
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {formatDate(eq.installDate)}
                        </td>
                        <td className="py-3 px-5">
                          {eq.condition ? (
                            <Badge className={getConditionColor(eq.condition)}>
                              {getConditionLabel(eq.condition)}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>

          {/* Agreements */}
          <Tab.Panel>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs">
                      AGREEMENT #
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      NAME
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      STATUS
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs">
                      NEXT BILLING
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs">
                      AMOUNT
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {agreements.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-gray-400"
                      >
                        No service agreements on file
                      </td>
                    </tr>
                  ) : (
                    agreements.map((ag) => (
                      <tr
                        key={ag.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          navigate(`/agreements/${ag.id}`);
                        }}
                      >
                        <td className="py-3 px-5 text-primary-600 font-medium">
                          #{ag.agreementNumber}
                        </td>
                        <td className="py-3 px-3 text-gray-900">{ag.name}</td>
                        <td className="py-3 px-3">
                          <StatusBadge
                            status={ag.status}
                            category="agreementStatus"
                          />
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {formatDate(ag.nextBillingDate)}
                        </td>
                        <td className="py-3 px-5 text-right font-medium">
                          {formatCurrency(ag.amount)}
                          <span className="text-gray-400 font-normal">
                            {" "}
                            / {getBillingLabel(ag.billingFrequency)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
        }}
        onConfirm={() => void handleDelete()}
        title="Delete customer"
        message={`Permanently delete ${customer.firstName} ${customer.lastName} and all associated work orders, quotes, invoices, payments, agreements, equipment and contacts? This cannot be undone.`}
        confirmLabel="Delete customer"
        loading={deleteCustomer.isPending}
      />
    </div>
  );
}
