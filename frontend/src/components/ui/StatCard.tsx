import clsx from 'clsx';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}

const colorClasses: Record<string, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
  green: { bg: 'bg-green-50', icon: 'text-green-600' },
  yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-600' },
  red: { bg: 'bg-red-50', icon: 'text-red-600' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
};

export default function StatCard({ title, value, subtitle, icon, trend, color = 'blue' }: StatCardProps) {
  const colors = colorClasses[color];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          {trend && (
            <div
              className={clsx(
                'mt-2 inline-flex items-center gap-1 text-xs font-medium',
                trend.value >= 0 ? 'text-green-600' : 'text-red-600'
              )}
            >
              {trend.value >= 0 ? (
                <ArrowTrendingUpIcon className="h-3.5 w-3.5" />
              ) : (
                <ArrowTrendingDownIcon className="h-3.5 w-3.5" />
              )}
              <span>
                {Math.abs(trend.value)}% {trend.label}
              </span>
            </div>
          )}
        </div>
        <div className={clsx('rounded-xl p-3', colors.bg)}>
          <div className={clsx('h-6 w-6', colors.icon)}>{icon}</div>
        </div>
      </div>
    </div>
  );
}
