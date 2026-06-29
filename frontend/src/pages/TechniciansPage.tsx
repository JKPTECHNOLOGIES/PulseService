import { useNavigate } from 'react-router-dom';
import { CalendarDaysIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useTechnicians } from '../hooks/useTechnicians';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';

export default function TechniciansPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useTechnicians();
  const technicians = data?.data || [];

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">{technicians.length} technicians</p>

      {technicians.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <EmptyState
            icon={<WrenchScrewdriverIcon />}
            title="No technicians found"
            description="Technicians are created from user accounts with the technician role."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {technicians.map((tech) => (
            <div
              key={tech.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                  <span className="text-lg font-bold text-primary-700">
                    {tech.user.firstName.charAt(0)}{tech.user.lastName.charAt(0)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">
                    {tech.user.firstName} {tech.user.lastName}
                  </h3>
                  <p className="text-xs text-gray-500">ID: {tech.employeeId}</p>
                  <Badge
                    className={clsx(
                      'mt-2',
                      tech.isAvailable ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    )}
                  >
                    {tech.isAvailable ? 'Available' : 'Busy'}
                  </Badge>
                </div>
              </div>

              {/* Skills */}
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {tech.skills && tech.skills.length > 0 ? (
                    tech.skills.map((skill) => (
                      <Badge key={skill} className="bg-gray-100 text-gray-600">
                        {skill}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">No skills listed</span>
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <div className="text-xs text-gray-500 truncate">{tech.user.email}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<CalendarDaysIcon className="h-4 w-4" />}
                  onClick={() => navigate('/dispatch')}
                >
                  Schedule
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
