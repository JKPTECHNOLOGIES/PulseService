import { useState, useRef } from 'react';
import { format, addDays, subDays, parseISO } from 'date-fns';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  DragStartEvent,
} from '@dnd-kit/core';
import { useDispatchBoard, useReassignJob } from '../hooks/useDispatch';
import { useJobs } from '../hooks/useJobs';
import { useTechnicians } from '../hooks/useTechnicians';
import Modal from '../components/ui/Modal';
import { PageSpinner } from '../components/ui/Spinner';
import { formatCurrency } from '../utils/formatters';
import { Job, Technician } from '../types';

const HOUR_START = 7;
const HOUR_END = 19;
const HOUR_WIDTH = 80;
const ROW_HEIGHT = 60;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

const JOB_TYPE_COLORS: Record<string, string> = {
  service: 'bg-blue-500',
  installation: 'bg-green-500',
  maintenance: 'bg-yellow-500',
  inspection: 'bg-purple-500',
};

function getJobPosition(job: Job): { left: number; width: number } | null {
  if (!job.scheduledStart) return null;
  try {
    const start = parseISO(job.scheduledStart);
    const startMins = start.getHours() * 60 + start.getMinutes();
    const totalMins = (HOUR_END - HOUR_START) * 60;
    const offsetMins = startMins - HOUR_START * 60;
    if (offsetMins < 0 || offsetMins > totalMins) return null;

    let durationMins = 60;
    if (job.scheduledEnd) {
      const end = parseISO(job.scheduledEnd);
      durationMins = Math.max(30, (end.getTime() - start.getTime()) / 60000);
    }

    const left = (offsetMins / 60) * HOUR_WIDTH;
    const width = Math.max(HOUR_WIDTH / 2, (durationMins / 60) * HOUR_WIDTH - 4);
    return { left, width };
  } catch {
    return null;
  }
}

interface JobCardProps {
  job: Job;
  compact?: boolean;
  onClick?: () => void;
  draggable?: boolean;
}

function JobCard({ job, compact = false, onClick, draggable = false }: JobCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
    disabled: !draggable,
  });

  const color = JOB_TYPE_COLORS[job.type] || 'bg-gray-500';

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onClick}
        className={clsx(
          'rounded-md text-white px-2 py-1 cursor-pointer select-none',
          color,
          isDragging ? 'opacity-50' : 'hover:opacity-90',
          'shadow-sm'
        )}
        style={{ fontSize: '10px', lineHeight: '1.3' }}
      >
        <div className="font-semibold truncate">#{job.jobNumber}</div>
        <div className="truncate opacity-90">
          {job.customer ? `${job.customer.firstName} ${job.customer.lastName}` : ''}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onClick={onClick}
      className={clsx(
        'rounded-lg border border-gray-200 p-3 cursor-pointer hover:shadow-sm transition-all',
        'bg-white',
        isDragging && 'opacity-50'
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={clsx('h-2 w-2 rounded-full', color)} />
        <span className="text-xs font-bold text-gray-700">#{job.jobNumber}</span>
      </div>
      <p className="text-xs font-medium text-gray-900 truncate">
        {job.customer ? `${job.customer.firstName} ${job.customer.lastName}` : 'Unknown'}
      </p>
      <p className="text-xs text-gray-500 truncate mt-0.5">{job.summary}</p>
      <p className="text-xs font-semibold text-gray-700 mt-1">{formatCurrency(job.totalAmount)}</p>
    </div>
  );
}

interface DroppableTechRowProps {
  techId: string;
  jobs: Job[];
  onJobClick: (job: Job) => void;
}

function DroppableTechRow({ techId, jobs, onJobClick }: DroppableTechRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: techId });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'relative border-b border-gray-100 transition-colors',
        isOver ? 'bg-primary-50' : 'hover:bg-gray-50'
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {/* Hour grid lines */}
      {HOURS.map((h, idx) => (
        <div
          key={h}
          className="absolute top-0 bottom-0 border-l border-gray-100"
          style={{ left: idx * HOUR_WIDTH }}
        />
      ))}

      {/* Job cards */}
      {jobs.map((job) => {
        const pos = getJobPosition(job);
        if (!pos) return null;
        return (
          <div
            key={job.id}
            className="absolute top-1 bottom-1"
            style={{ left: pos.left + 2, width: pos.width }}
          >
            <JobCard job={job} compact onClick={() => onJobClick(job)} draggable />
          </div>
        );
      })}
    </div>
  );
}

export default function DispatchPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const dateStr = format(currentDate, 'yyyy-MM-dd');

  const { data: boardData, isLoading } = useDispatchBoard(dateStr);
  const { data: allJobsData } = useJobs({ status: 'new,scheduled', limit: 50 });
  const { data: techsData } = useTechnicians();
  const reassign = useReassignJob();

  const board = boardData;
  const allTechs = techsData?.data || [];
  const unassignedJobs = board?.unassigned || allJobsData?.data?.filter(j => !j.technicians?.length) || [];
  const techRows = board?.technicians || allTechs.map(t => ({ ...t, jobs: [] as Job[] }));

  const handleDragStart = (event: DragStartEvent) => {
    const job = unassignedJobs.find(j => j.id === event.active.id) ||
      techRows.flatMap(t => t.jobs || []).find(j => j.id === event.active.id);
    setActiveJob(job || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveJob(null);
    const { active, over } = event;
    if (!over) return;
    const jobId = active.id as string;
    const techId = over.id as string;
    if (techId && jobId) {
      reassign.mutate({ jobId, technicianId: techId, date: dateStr });
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Date Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentDate(subDays(currentDate, 1))}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
            <span className="font-semibold text-gray-900">
              {format(currentDate, 'EEEE, MMMM d, yyyy')}
            </span>
          </div>
          <button
            onClick={() => setCurrentDate(addDays(currentDate, 1))}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => setCurrentDate(new Date())}
          className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Today
        </button>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : (
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Board */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto">
              {/* Header row: Technician label + time slots */}
              <div className="flex sticky top-0 z-10 bg-white border-b border-gray-200">
                <div
                  className="shrink-0 border-r border-gray-200 flex items-center px-4 py-3"
                  style={{ width: 180 }}
                >
                  <span className="text-xs font-semibold text-gray-500 uppercase">Technician</span>
                </div>
                <div className="flex">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="border-l border-gray-100 flex items-center justify-start px-2 py-3"
                      style={{ width: HOUR_WIDTH, minWidth: HOUR_WIDTH }}
                    >
                      <span className="text-xs text-gray-400 font-medium">
                        {h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tech rows */}
              {techRows.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">
                  No technicians found. Add technicians to see the dispatch board.
                </div>
              ) : (
                techRows.map((techRow) => (
                  <div key={techRow.id} className="flex border-b border-gray-100">
                    {/* Tech info */}
                    <div
                      className="shrink-0 border-r border-gray-200 flex items-center gap-3 px-4 bg-gray-50"
                      style={{ width: 180, minHeight: ROW_HEIGHT }}
                    >
                      <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-primary-700">
                          {techRow.user.firstName.charAt(0)}{techRow.user.lastName.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">
                          {techRow.user.firstName} {techRow.user.lastName}
                        </p>
                        <p className={clsx(
                          'text-xs',
                          techRow.isAvailable ? 'text-green-600' : 'text-gray-400'
                        )}>
                          {techRow.isAvailable ? 'Available' : 'Busy'}
                        </p>
                      </div>
                    </div>

                    {/* Time grid */}
                    <div
                      className="relative flex-1"
                      style={{ minWidth: HOURS.length * HOUR_WIDTH, minHeight: ROW_HEIGHT }}
                    >
                      <DroppableTechRow
                        techId={techRow.id}
                        jobs={(techRow as any).jobs || []}
                        onJobClick={setSelectedJob}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Unassigned panel */}
            <div className="w-56 shrink-0">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 h-full flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase">
                    Unassigned ({unassignedJobs.length})
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {unassignedJobs.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">All jobs assigned</p>
                  ) : (
                    unassignedJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onClick={() => setSelectedJob(job)}
                        draggable
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeJob && (
              <div className="bg-white rounded-lg border border-primary-200 shadow-lg p-3 w-48 opacity-90">
                <p className="text-xs font-bold text-primary-700">#{activeJob.jobNumber}</p>
                <p className="text-xs text-gray-900 truncate">{activeJob.summary}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Job detail modal */}
      {selectedJob && (
        <Modal
          isOpen={!!selectedJob}
          onClose={() => setSelectedJob(null)}
          title={`Job #${selectedJob.jobNumber}`}
          size="md"
        >
          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-gray-500">Customer</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">
                {selectedJob.customer
                  ? `${selectedJob.customer.firstName} ${selectedJob.customer.lastName}`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Type</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5 capitalize">{selectedJob.type}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Summary</dt>
              <dd className="text-sm text-gray-700 mt-0.5">{selectedJob.summary}</dd>
            </div>
            {selectedJob.location && (
              <div>
                <dt className="text-xs text-gray-500">Location</dt>
                <dd className="text-sm text-gray-700 mt-0.5">
                  {selectedJob.location.address}, {selectedJob.location.city}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-gray-500">Amount</dt>
              <dd className="text-sm font-bold text-gray-900 mt-0.5">
                {formatCurrency(selectedJob.totalAmount)}
              </dd>
            </div>
          </dl>
        </Modal>
      )}
    </div>
  );
}
