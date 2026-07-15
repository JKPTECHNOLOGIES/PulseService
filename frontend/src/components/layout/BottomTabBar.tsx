import { NavLink } from "react-router-dom";
import clsx from "clsx";
import {
  HomeIcon,
  CalendarDaysIcon,
  BriefcaseIcon,
  MapIcon,
  DocumentDuplicateIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "../../store/authStore";

// Thumb-reach nav. Technicians get their field-first set (My Day / Jobs /
// Map); office roles get the back-office set (Home / Jobs / Invoices). The
// tech's third slot is the job Map (locations + one-tap directions) rather
// than the Dispatch board, which a technician can only view (reassigning needs
// dispatch.manage) -- a dead end in the thumb zone. The "More" button opens
// the full, permission-filtered drawer for everything else.
const techTabs = [
  { to: "/my-day", label: "My Day", icon: CalendarDaysIcon },
  { to: "/jobs", label: "Work Orders", icon: BriefcaseIcon },
  { to: "/map", label: "Map", icon: MapIcon },
];

const officeTabs = [
  { to: "/dashboard", label: "Home", icon: HomeIcon },
  { to: "/jobs", label: "Work Orders", icon: BriefcaseIcon },
  { to: "/invoices", label: "Invoices", icon: DocumentDuplicateIcon },
];

interface BottomTabBarProps {
  onMore: () => void;
}

export default function BottomTabBar({ onMore }: BottomTabBarProps) {
  const role = useAuthStore((s) => s.user?.role);
  const tabs = role === "technician" ? techTabs : officeTabs;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 pb-safe-bottom pl-safe-left pr-safe-right"
      aria-label="Primary"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] px-1 text-[11px] font-medium transition-colors",
                isActive
                  ? "text-primary-600"
                  : "text-gray-500 hover:text-gray-700",
              )
            }
          >
            <Icon className="h-6 w-6 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMore}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] px-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          <Bars3Icon className="h-6 w-6 shrink-0" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
