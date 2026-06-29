import { useState } from 'react';
import { Tab } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { PlusIcon, PhoneArrowDownLeftIcon, PhoneArrowUpRightIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';
import { Campaign, Call, PaginatedResponse } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency, formatDate, formatDateTime, capitalize } from '../utils/formatters';

function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const data = await api.get('/campaigns', { params: { limit: 50 } });
      return data as unknown as PaginatedResponse<Campaign>;
    },
  });
}

function useCalls() {
  return useQuery({
    queryKey: ['calls'],
    queryFn: async () => {
      const data = await api.get('/calls', { params: { limit: 50 } });
      return data as unknown as PaginatedResponse<Call>;
    },
  });
}

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  ended: 'bg-gray-100 text-gray-500',
  draft: 'bg-gray-100 text-gray-600',
};

function CampaignsTab() {
  const { data, isLoading } = useCampaigns();
  const campaigns = data?.data || [];

  if (isLoading) return <PageSpinner />;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Campaigns</h3>
        <Button size="sm" icon={<PlusIcon className="h-4 w-4" />}>New Campaign</Button>
      </div>
      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns" description="Track your marketing campaigns and their performance." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">Name</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Type</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Status</th>
                <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">Budget</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Period</th>
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">Tracking #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="py-3.5 px-5 font-medium text-gray-900">{c.name}</td>
                  <td className="py-3.5 px-3 capitalize text-gray-600 text-xs">{c.type}</td>
                  <td className="py-3.5 px-3">
                    <Badge className={CAMPAIGN_STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-600'}>
                      {capitalize(c.status)}
                    </Badge>
                  </td>
                  <td className="py-3.5 px-3 text-right text-gray-900">{c.budget ? formatCurrency(c.budget) : '-'}</td>
                  <td className="py-3.5 px-3 text-gray-500 text-xs">
                    {formatDate(c.startDate)} – {formatDate(c.endDate)}
                  </td>
                  <td className="py-3.5 px-5 font-mono text-xs text-gray-600">{c.trackingNumber || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CallsTab() {
  const { data, isLoading } = useCalls();
  const calls = data?.data || [];

  if (isLoading) return <PageSpinner />;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Recent Calls</h3>
      </div>
      {calls.length === 0 ? (
        <EmptyState title="No calls logged" description="Call tracking records will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">Date</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Direction</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Customer</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">Number</th>
                <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">Duration</th>
                <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {calls.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50">
                  <td className="py-3.5 px-5 text-gray-700">{formatDateTime(call.createdAt)}</td>
                  <td className="py-3.5 px-3">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {call.direction === 'inbound' ? (
                        <><PhoneArrowDownLeftIcon className="h-3.5 w-3.5 text-green-600" /> In</>
                      ) : (
                        <><PhoneArrowUpRightIcon className="h-3.5 w-3.5 text-blue-600" /> Out</>
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-3 text-gray-900">
                    {call.customer ? `${call.customer.firstName} ${call.customer.lastName}` : 'Unknown'}
                  </td>
                  <td className="py-3.5 px-3 text-gray-600">
                    {call.direction === 'inbound' ? call.fromNumber : call.toNumber}
                  </td>
                  <td className="py-3.5 px-3 text-right text-gray-600">
                    {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '-'}
                  </td>
                  <td className="py-3.5 px-5">
                    <Badge className="bg-gray-100 text-gray-600 capitalize">{call.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MarketingPage() {
  const [selectedTab, setSelectedTab] = useState(0);

  return (
    <div className="space-y-5">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {['Campaigns', 'Calls'].map((tab) => (
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
          <Tab.Panel><CampaignsTab /></Tab.Panel>
          <Tab.Panel><CallsTab /></Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
