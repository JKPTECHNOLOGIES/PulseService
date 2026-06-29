import { useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useJob, useCreateJob, useUpdateJob } from '../hooks/useJobs';
import { useCustomers } from '../hooks/useCustomers';
import { useTechnicians } from '../hooks/useTechnicians';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { PageSpinner } from '../components/ui/Spinner';

const schema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  type: z.enum(['service', 'installation', 'maintenance', 'inspection']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  status: z.enum(['new', 'scheduled']),
  summary: z.string().min(1, 'Summary is required'),
  description: z.string().optional(),
  scheduledStart: z.string().optional(),
  scheduledEnd: z.string().optional(),
  notes: z.string().optional(),
  technicianIds: z.array(z.string()).optional(),
});

type FormData = z.infer<typeof schema>;

export default function JobFormPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditing = !!id;

  const { data: job, isLoading: jobLoading } = useJob(id || '');
  const { data: customersData } = useCustomers({ limit: 200 });
  const { data: techsData } = useTechnicians();
  const createMutation = useCreateJob();
  const updateMutation = useUpdateJob();

  const customers = customersData?.data || [];
  const techs = techsData?.data || [];

  const prefillCustomerId = (location.state as any)?.customerId || '';

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'service',
      priority: 'normal',
      status: 'new',
      customerId: prefillCustomerId,
      technicianIds: [],
    },
  });

  useEffect(() => {
    if (job && isEditing) {
      reset({
        customerId: job.customerId,
        type: job.type as any,
        priority: job.priority as any,
        status: job.status as any,
        summary: job.summary,
        description: job.description || '',
        scheduledStart: job.scheduledStart ? job.scheduledStart.slice(0, 16) : '',
        scheduledEnd: job.scheduledEnd ? job.scheduledEnd.slice(0, 16) : '',
        notes: job.notes || '',
        technicianIds: job.technicians?.map((jt) => jt.technicianId) || [],
      });
    }
  }, [job, isEditing, reset]);

  const technicianIds = watch('technicianIds') || [];

  const toggleTech = (techId: string) => {
    const current = watch('technicianIds') || [];
    if (current.includes(techId)) {
      setValue('technicianIds', current.filter((id) => id !== techId));
    } else {
      setValue('technicianIds', [...current, techId]);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (isEditing) {
      await updateMutation.mutateAsync({ id: id!, ...data });
      navigate(`/jobs/${id}`);
    } else {
      const result = await createMutation.mutateAsync(data) as any;
      const newId = result?.data?.id || result?.id;
      navigate(newId ? `/jobs/${newId}` : '/jobs');
    }
  };

  if (isEditing && jobLoading) return <PageSpinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card title="Job Details">
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
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}{c.companyName ? ` (${c.companyName})` : ''}
                  </option>
                ))}
              </select>
              {errors.customerId && (
                <p className="mt-1 text-xs text-red-600">{errors.customerId.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Job Type</label>
                <select
                  {...register('type')}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  <option value="service">Service</option>
                  <option value="installation">Installation</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Priority</label>
                <select
                  {...register('priority')}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
              <select
                {...register('status')}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="new">New</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Summary <span className="text-red-500">*</span>
              </label>
              <input
                {...register('summary')}
                type="text"
                placeholder="Brief description of the job..."
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {errors.summary && (
                <p className="mt-1 text-xs text-red-600">{errors.summary.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
              <textarea
                {...register('description')}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Detailed description..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Scheduled Start</label>
                <input
                  {...register('scheduledStart')}
                  type="datetime-local"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Scheduled End</label>
                <input
                  {...register('scheduledEnd')}
                  type="datetime-local"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Office Notes</label>
              <textarea
                {...register('notes')}
                rows={2}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Internal notes..."
              />
            </div>
          </div>
        </Card>

        {/* Technicians */}
        <Card title="Assign Technicians">
          <div className="grid grid-cols-2 gap-2">
            {techs.length === 0 ? (
              <p className="text-sm text-gray-400 col-span-2">No technicians available</p>
            ) : (
              techs.map((tech) => (
                <label
                  key={tech.id}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={technicianIds.includes(tech.id)}
                    onChange={() => toggleTech(tech.id)}
                    className="text-primary-600 focus:ring-primary-500 rounded"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {tech.user.firstName} {tech.user.lastName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {tech.isAvailable ? 'Available' : 'Busy'}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || createMutation.isPending || updateMutation.isPending}>
            {isEditing ? 'Save Changes' : 'Create Job'}
          </Button>
        </div>
      </form>
    </div>
  );
}
