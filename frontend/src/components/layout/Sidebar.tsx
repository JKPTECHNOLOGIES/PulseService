import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  HomeIcon,
  CalendarDaysIcon,
  UsersIcon,
  BriefcaseIcon,
  MapIcon,
  GlobeAltIcon,
  DocumentTextIcon,
  DocumentDuplicateIcon,
  CreditCardIcon,
  WrenchScrewdriverIcon,
  BookOpenIcon,
  ArchiveBoxIcon,
  TruckIcon,
  ShoppingCartIcon,
  QrCodeIcon,
  TagIcon,
  CpuChipIcon,
  ClipboardDocumentCheckIcon,
  MegaphoneIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowRightStartOnRectangleIcon,
  XMarkIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "../../store/authStore";
import { useLookup } from "../../hooks/useMetadata";
import { usePermissions } from "../../hooks/usePermissions";
import ThermometerLogo from "../ui/ThermometerLogo";

// `perm` (optional) hides the item unless the user holds one of the listed
// permissions -- the same rule the page's own actions are gated by, so a role
// only sees a tab it can actually do something with. `roles` (optional) is
// for the couple of items that aren't about a specific permission at all, but
// about which role the item even makes sense for (My Day is a technician's
// own agenda; Dashboard is the office landing page technicians never land on
// per HomeRedirect). Items with neither are universal (Settings' own tabs
// already self-filter by permission internally).
const FIELD_OPS = [
  "jobs.create",
  "jobs.edit",
  "jobs.status",
  "dispatch.manage",
];
const INVENTORY_FIELD = ["inventory.manage", "inventory.issueToJob"];

const navItems = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: HomeIcon,
    roles: ["admin", "manager", "csr", "exec"],
  },
  {
    to: "/my-day",
    label: "My Day",
    icon: CalendarDaysIcon,
    roles: ["technician"],
  },
  {
    to: "/customers",
    label: "Customers",
    icon: UsersIcon,
    perm: ["customers.create", "customers.edit", "customers.delete"],
  },
  { to: "/jobs", label: "Work Orders", icon: BriefcaseIcon, perm: FIELD_OPS },
  {
    to: "/recurring",
    label: "Recurring",
    icon: ArrowPathIcon,
    perm: ["jobs.create"],
  },
  { to: "/dispatch", label: "Dispatch", icon: MapIcon, perm: FIELD_OPS },
  { to: "/map", label: "Map", icon: GlobeAltIcon, perm: FIELD_OPS },
  {
    to: "/estimates",
    label: "Quotes",
    icon: DocumentTextIcon,
    perm: ["estimates.manage"],
  },
  {
    to: "/invoices",
    label: "Invoices",
    icon: DocumentDuplicateIcon,
    perm: ["invoices.manage"],
  },
  {
    to: "/payments",
    label: "Payments",
    icon: CreditCardIcon,
    perm: ["payments.view"],
  },
  {
    to: "/technicians",
    label: "Technicians",
    icon: WrenchScrewdriverIcon,
    perm: ["dispatch.manage", "jobs.assign"],
  },
  {
    to: "/pricebook",
    label: "Pricebook",
    icon: BookOpenIcon,
    perm: ["pricebook.manage"],
  },
  {
    to: "/pricebook/pricing-tiers",
    label: "Pricing Tiers",
    icon: TagIcon,
    roles: ["admin", "manager", "csr"],
  },
  {
    to: "/inventory",
    label: "Inventory",
    icon: ArchiveBoxIcon,
    perm: INVENTORY_FIELD,
  },
  {
    to: "/purchasing",
    label: "Purchase Orders",
    icon: ShoppingCartIcon,
    perm: ["purchasing.manage", "purchasing.receive"],
  },
  {
    to: "/vendors",
    label: "Vendors",
    icon: TruckIcon,
    perm: ["vendors.manage"],
  },
  {
    to: "/serials",
    label: "Serialized Units",
    icon: QrCodeIcon,
    perm: INVENTORY_FIELD,
  },
  { to: "/equipment", label: "Equipment", icon: CpuChipIcon },
  {
    to: "/agreements",
    label: "Agreements",
    icon: ClipboardDocumentCheckIcon,
    perm: ["agreements.manage", "agreements.visits"],
  },
  {
    to: "/marketing",
    label: "Marketing",
    icon: MegaphoneIcon,
    perm: ["calls.manage"],
  },
  {
    to: "/reports",
    label: "Reports",
    icon: ChartBarIcon,
    perm: ["reports.operational", "reports.financial"],
  },
  { to: "/settings", label: "Settings", icon: Cog6ToothIcon },
  { to: "/help", label: "Help", icon: QuestionMarkCircleIcon },
];

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export default function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { getLabel: getRoleLabel } = useLookup("userRole");
  const { canAny } = usePermissions();

  const visibleNavItems = navItems.filter((item) => {
    if (item.perm && !canAny(...item.perm)) return false;
    if (item.roles && !item.roles.includes(user?.role ?? "")) return false;
    return true;
  });

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
    : "U";

  // The drawer is always full width on mobile; `collapsed` only applies on
  // desktop (md+) where the sidebar is part of the page flow.
  const showLabels = !collapsed || mobileOpen;

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <div
        className={clsx(
          "flex flex-col bg-white border-r border-gray-200 transition-all duration-300 shrink-0",
          // Mobile: fixed off-canvas drawer that slides in when open. Safe-area
          // insets keep the logo/logout clear of the notch & home indicator
          // (they resolve to 0 on desktop, where the sidebar is md:static).
          "fixed inset-y-0 left-0 z-50 w-64 max-w-[80%] pt-safe-top pb-safe-bottom pl-safe-left",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: part of the flex layout, no transform, width toggled by collapse.
          "md:static md:translate-x-0 md:max-w-none",
          collapsed ? "md:w-16" : "md:w-60",
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
          {showLabels ? (
            <div className="flex items-center gap-2">
              <ThermometerLogo className="h-8 w-8 shrink-0" />
              <span className="font-bold text-gray-900 text-sm leading-tight">
                Prime Comfort Solutions
              </span>
            </div>
          ) : (
            <ThermometerLogo className="h-8 w-8 mx-auto" />
          )}

          {/* Close button (mobile only) */}
          <button
            onClick={onCloseMobile}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0 md:hidden"
            aria-label="Close menu"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={() => {
              setCollapsed(!collapsed);
            }}
            className={clsx(
              "hidden md:block p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0",
              collapsed && "mx-auto",
            )}
            aria-label="Toggle sidebar"
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
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onCloseMobile}
              title={!showLabels ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group",
                  isActive
                    ? "bg-primary-600 text-oncolor"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                  !showLabels && "md:justify-center md:px-2",
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {showLabels && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="border-t border-gray-200 p-3">
          {showLabels ? (
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-primary-700">
                  {initials}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-gray-500">
                  {getRoleLabel(user?.role)}
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Logout"
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogout}
              title="Logout"
              className="w-full flex items-center justify-center p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
