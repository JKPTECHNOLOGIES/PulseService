import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  HomeIcon,
  UsersIcon,
  BriefcaseIcon,
  MapIcon,
  DocumentTextIcon,
  DocumentDuplicateIcon,
  CreditCardIcon,
  WrenchScrewdriverIcon,
  BookOpenIcon,
  ArchiveBoxIcon,
  ClipboardDocumentCheckIcon,
  MegaphoneIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowRightOnRectangleIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../../store/authStore';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/customers', label: 'Customers', icon: UsersIcon },
  { to: '/jobs', label: 'Jobs', icon: BriefcaseIcon },
  { to: '/dispatch', label: 'Dispatch', icon: MapIcon },
  { to: '/estimates', label: 'Estimates', icon: DocumentTextIcon },
  { to: '/invoices', label: 'Invoices', icon: DocumentDuplicateIcon },
  { to: '/payments', label: 'Payments', icon: CreditCardIcon },
  { to: '/technicians', label: 'Technicians', icon: WrenchScrewdriverIcon },
  { to: '/pricebook', label: 'Pricebook', icon: BookOpenIcon },
  { to: '/inventory', label: 'Inventory', icon: ArchiveBoxIcon },
  { to: '/agreements', label: 'Agreements', icon: ClipboardDocumentCheckIcon },
  { to: '/marketing', label: 'Marketing', icon: MegaphoneIcon },
  { to: '/reports', label: 'Reports', icon: ChartBarIcon },
  { to: '/settings', label: 'Settings', icon: Cog6ToothIcon },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
    : 'U';

  return (
    <div
      className={clsx(
        'flex flex-col bg-white border-r border-gray-200 transition-all duration-300 shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <BoltIcon className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-sm">PulseService</span>
          </div>
        )}
        {collapsed && (
          <div className="h-8 w-8 rounded-lg bg-primary-600 flex items-center justify-center mx-auto">
            <BoltIcon className="h-5 w-5 text-white" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={clsx(
            'p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0',
            collapsed && 'mx-auto'
          )}
        >
          {collapsed ? (
            <ChevronRightIcon className="h-4 w-4" />
          ) : (
            <ChevronLeftIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                collapsed && 'justify-center px-2'
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className="border-t border-gray-200 p-3">
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-primary-700">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            title="Logout"
            className="w-full flex items-center justify-center p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
