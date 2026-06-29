import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useInvoice, useCreateInvoice, useUpdateInvoice } from '../hooks/useInvoices';
import { useCustomers } from '../hooks/useCustomers';
import { useJobs } from '../hooks/useJobs';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import LineItemsTable, { LineItem } from '../components/ui/LineItemsTable';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency } from '../utils/formatters';

const schema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  jobId: z.string().optional(),
  dueDate: z.string().optional(),
  discountType: z.enum(['fixed', 'percent']).optional(),
  discountValue: z.number().min(0).optional(),
  taxRate: z.number().min(0).max(100),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = !!id;

  const { data: invoice, isLoading } = useInvoice(id || '');
  const { data: customersData } = useCustomers({ limit: 200 });
  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();

  const customers = customersData?.data || [];
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { taxRate: 8.25, discountType: 'fixed', discountValue: 0 },
  });

  const customerId = watch('customerId');
  const discountType = watch('discountType');
  const discountValue = watch('discountValue') || 0;
  const taxRate = watch('taxRate') || 0;

  const { data: jobsData } = useJobs({ limit: 100 });
  const customerJobs = (jobsData?.data || []).filter(j => j.customerId === customerId);

  useEffect(() => {
    if (invoice && isEditing) {
      reset({
        customerId: invoice.customerId,
        jobId: invoice.jobId || '',
        dueDate: invoice.dueDate ? invoice.dueDate.slice(0, 10) : '',
        discountType: (invoice.discountType as any) || 'fixed',
        discountValue: invoice.discountValue || 0,
        taxRate: invoice.taxRate,
        notes: invoice.notes || '',
        terms: invoice.terms || '',
      });
      setLineItems(
        (invoice.lineItems || []).map((li) => ({
          id: li.id,
          type: li.type,
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
        }))
      );
    }
  }, [invoice, isEditing, reset]);

  const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
  const discountAmt = discountType === 'percent' ? subtotal * (discountValue / 100) : discountValue;
  const taxable = subtotal - discountAmt;
  const taxAmt = taxable * (taxRate / 100);
  const total = taxable + taxAmt;

  const onSubmit = async (data: FormData) => {
    const payload = {
      ...data,
      lineItems: lineItems.map((li, idx) => ({ ...li, sortOrder: idx })),
      subtotal,
      taxAmount: taxAmt,
      total,
    };

    if (isEditing) {
      await updateMutation.mutateAsync({ id: id!, ...payload });
      navigate(`/invoices/${id}`);
    } else {
      const result = await createMutation.mutateAsync(payload) as any;
      const newId = result?.data?.id || result?.id;
      navigate(newId ? `/invoices/${newId}` : '/invoices');
    }
  };

  if (isEditing && isLoading) return <PageSpinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card title="Invoice Details">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Customer <span className="text-red-500">*</span>
              </label>
              <select
                {...register('customerId')}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                ))}
              </select>
              {errors.customerId && <p className="mt-1 text-xs text-red-600">{errors.customerId.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {customerId && customerJobs.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Related Job</label>
                  <select
                    {...register('jobId')}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">None</option>
                    {customerJobs.map((j) => (
                      <option key={j.id} value={j.id}>#{j.jobNumber} - {j.summary}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Due Date</label>
                <input
                  {...register('dueDate')}
                  type="date"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </Card>

        <Card title="Line Items">
          <LineItemsTable items={lineItems} onChange={setLineItems} />
        </Card>

        <Card title="Pricing">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Discount</label>
                <div className="flex gap-2">
                  <select
                    {...register('discountType')}
                    className="w-28 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="fixed">Fixed $</option>
                    <option value="percent">Percent %</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    {...register('discountValue', { valueAsNumber: true })}
                    className="flex-1 px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tax Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  {...register('taxRate', { valueAsNumber: true })}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Discount</span>
                  <span className="font-medium text-red-600">-{formatCurrency(discountAmt)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax ({taxRate}%)</span>
                <span className="font-medium">{formatCurrency(taxAmt)}</span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                <span>Total</span>
                <span className="text-primary-600">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Notes & Terms">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea
                {...register('notes')}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Terms</label>
              <textarea
                {...register('terms')}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting || createMutation.isPending || updateMutation.isPending}>
            {isEditing ? 'Save Changes' : 'Create Invoice'}
          </Button>
        </div>
      </form>
    </div>
  );
}
