import { NavLink } from "react-router-dom";
import clsx from "clsx";
import {
  HomeIcon,
  CalendarDaysIcon,
  BriefcaseIcon,
  MapIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";

// A curated, thumb-reach subset of the nav. All destinations are readable by
// every role, so no permission gating is needed here; the "More" button opens
// the full (permission-filtered) drawer for everything else.
const tabs = [
  { to: "/dashboard", label: "Home", icon: HomeIcon },
  { to: "/my-day", label: "My Day", icon: CalendarDaysIcon },
  { to: "/jobs", label: "Jobs", icon: BriefcaseIcon },
  { to: "/dispatch", label: "Dispatch", icon: MapIcon },
];

interface BottomTabBarProps {
  onMore: () => void;
}

export default function BottomTabBar({ onMore }: BottomTabBarProps) {
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
