import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import Sidebar from "./Sidebar";
import Header from "./Header";
import CommandPalette from "./CommandPalette";
import ErrorBoundary from "../ErrorBoundary";

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes so navigating from the
  // drawer doesn't leave it hanging open over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen-safe bg-gray-50 overflow-hidden pl-safe-left pr-safe-right">
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => {
          setMobileOpen(false);
        }}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          onMenuClick={() => {
            setMobileOpen(true);
          }}
        />
        <main className="flex-1 overflow-auto scroll-momentum p-4 md:p-6 pb-safe-bottom">
          {/* Keyed by path so a crashed page recovers automatically once the
              user navigates elsewhere. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
