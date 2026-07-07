import { Fragment, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BellIcon,
  ChevronDownIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  SunIcon,
  MoonIcon,
} from "@heroicons/react/24/outline";
import { Menu, Transition } from "@headlessui/react";
import clsx from "clsx";
import { useAuthStore } from "../../store/authStore";
import { useNotifications } from "../../hooks/useNotifications";
import { useTheme } from "../../hooks/useTheme";
import { usePageHelpSeen } from "../../hooks/usePageHelpSeen";
import { getPageHelp } from "../../content/pageHelp";
import { MOD_KEY } from "../../lib/keys";
import PageHelpModal from "./PageHelpModal";

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
  "/equipment": "Equipment",
  "/agreements": "Service Agreements",
  "/marketing": "Marketing",
  "/reports": "Reports",
  "/settings": "Settings",
  "/notifications": "Notifications",
  "/help": "Help Center",
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
  const { isDark, toggle: toggleTheme } = useTheme();
  const { data: notifData } = useNotifications();
  const notifCount = notifData?.unreadCount ?? 0;

  const helpContent = getPageHelp(location.pathname);
  const { hasSeen, markSeen } = usePageHelpSeen();
  const [helpOpen, setHelpOpen] = useState(false);

  // Tech-primary screens (the My Day agenda and any job screen) are where a
  // technician is actively working, so we never auto-pop a dimming modal over
  // them; the "?" button below still offers the guide on demand.
  const isTechPrimaryScreen =
    location.pathname === "/my-day" || location.pathname.startsWith("/jobs/");

  // Auto-open the help modal the first time this browser ever visits a page
  // that has help content, then remember not to do it again.
  useEffect(() => {
    if (!helpContent || isTechPrimaryScreen) return;
    if (!hasSeen(helpContent.key)) {
      setHelpOpen(true);
      markSeen(helpContent.key);
    }
  }, [helpContent, hasSeen, markSeen, isTechPrimaryScreen]);

  const title = getTitle(location.pathname);
  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
    : "U";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="min-h-[64px] pt-safe-top bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-lg md:text-xl font-semibold text-gray-900 truncate">
          {title}
        </h1>
        {helpContent && (
          <button
            onClick={() => {
              setHelpOpen(true);
            }}
            title="Help for this page"
            aria-label="Help for this page"
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          >
            <InformationCircleIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Search affordance — opens the command palette (also ⌘/Ctrl K or /) */}
        <button
          onClick={() => {
            window.dispatchEvent(new Event("pulse:open-palette"));
          }}
          title={`Search — ${MOD_KEY} K or /`}
          className="hidden sm:flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <MagnifyingGlassIcon className="h-4 w-4" />
          <span className="hidden lg:inline">Search…</span>
          <kbd className="hidden lg:inline text-[11px] font-medium px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-400">
            {MOD_KEY} K
          </kbd>
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle dark mode"
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          {isDark ? (
            <SunIcon className="h-5 w-5" />
          ) : (
            <MoonIcon className="h-5 w-5" />
          )}
        </button>

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
            <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-red-500 text-oncolor text-[10px] font-bold flex items-center justify-center">
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

      {helpContent && (
        <PageHelpModal
          isOpen={helpOpen}
          onClose={() => {
            setHelpOpen(false);
          }}
          content={helpContent}
        />
      )}
    </header>
  );
}
