import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import api from "../../lib/api";
import type { User } from "../../types";
import Sidebar from "./Sidebar";
import Header from "./Header";
import BottomTabBar from "./BottomTabBar";
import CommandPalette from "./CommandPalette";
import KeyboardShortcuts from "./KeyboardShortcuts";
import OfflineIndicator from "../ui/OfflineIndicator";
import ErrorBoundary from "../ErrorBoundary";

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes so navigating from the
  // drawer doesn't leave it hanging open over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // The signed-in user (including their `permissions` array) is persisted to
  // localStorage at login time and otherwise never refreshed. If an admin
  // re-maps roles in Settings -> Roles & Permissions (or a one-off data fix
  // changes what a role can do) while someone is already logged in, their
  // session keeps showing the stale permission set -- e.g. a nav item just
  // silently disappears -- until they happen to log out and back in. Pull a
  // fresh copy once per app load so that class of bug self-heals instead.
  useEffect(() => {
    if (!isAuthenticated) return;
    api
      .get<{ success: boolean; data: User }>("/auth/me")
      .then((res) => {
        updateUser(res.data);
      })
      .catch(() => {
        // Offline or a transient error -- keep using the cached session.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

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
        <Header />
        {/* Extra bottom padding on mobile so content clears the fixed tab bar
            (bar height + home-indicator inset); normal padding on desktop. */}
        <main className="flex-1 overflow-auto scroll-momentum p-4 md:p-6 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-6">
          {/* Keyed by path so a crashed page recovers automatically once the
              user navigates elsewhere. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <BottomTabBar
        onMore={() => {
          setMobileOpen(true);
        }}
      />
      <CommandPalette />
      <KeyboardShortcuts />
      <OfflineIndicator />
    </div>
  );
}
