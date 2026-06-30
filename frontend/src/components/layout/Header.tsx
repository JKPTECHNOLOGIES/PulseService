import { Fragment } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BellIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { Menu, Transition } from "@headlessui/react";
import clsx from "clsx";
import { useAuthStore } from "../../store/authStore";
import { useNotifications } from "../../hooks/useNotifications";

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/customers": "Customers",
  "/jobs": "Jobs",
  "/dispatch": "Dispatch Board",
  "/estimates": "Estimates",
  "/invoices": "Invoices",
  "/payments": "Payments",
  "/technicians": "Technicians",
  "/pricebook": "Pricebook",
  "/inventory": "Inventory",
  "/agreements": "Service Agreements",
  "/marketing": "Marketing",
  "/reports": "Reports",
  "/settings": "Settings",
  "/notifications": "Notifications",
};

function getTitle(pathname: string): string {
  for (const [path, title] of Object.entries(routeTitles)) {
    if (pathname === path || pathname.startsWith(path + "/")) {
      if (pathname.endsWith("/new")) return `New ${title.replace(/s$/, "")}`;
      if (pathname.includes("/edit")) return `Edit ${title.replace(/s$/, "")}`;
      return title;
    }
  }
  return "PulseService";
}

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { data: notifData } = useNotifications();
  const notifCount = notifData?.unreadCount ?? 0;

  const title = getTitle(location.pathname);
  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
    : "U";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search..."
            className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white
              placeholder-gray-400 w-48 focus:w-64 transition-all"
          />
        </div>

        {/* Notifications */}
        <button
          onClick={() => {
            navigate("/notifications");
          }}
          title="Notifications"
          className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <BellIcon className="h-5 w-5" />
          {notifCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {notifCount}
            </span>
          )}
        </button>

        {/* User menu */}
        <Menu as="div" className="relative">
          <Menu.Button className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-xs font-semibold text-primary-700">
                {initials}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-700 hidden md:block">
              {user?.firstName}
            </span>
            <ChevronDownIcon className="h-4 w-4 text-gray-400 hidden md:block" />
          </Menu.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items className="absolute right-0 mt-2 w-48 origin-top-right rounded-xl bg-white shadow-lg ring-1 ring-black/5 focus:outline-none z-50 py-1">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
              </div>
              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={() => {
                      navigate("/settings");
                    }}
                    className={clsx(
                      "w-full text-left px-4 py-2 text-sm",
                      active ? "bg-gray-50 text-gray-900" : "text-gray-700",
                    )}
                  >
                    Settings
                  </button>
                )}
              </Menu.Item>
              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={handleLogout}
                    className={clsx(
                      "w-full text-left px-4 py-2 text-sm",
                      active ? "bg-red-50 text-red-600" : "text-red-500",
                    )}
                  >
                    Sign Out
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Transition>
        </Menu>
      </div>
    </header>
  );
}
