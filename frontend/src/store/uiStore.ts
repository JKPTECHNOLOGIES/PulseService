import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Notification } from '../types';

interface UiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  notifications: Notification[];
  unreadCount: number;
  theme: 'light' | 'dark';

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  addNotification: (notification: Notification) => void;
  markNotificationRead: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      notifications: [],
      unreadCount: 0,
      theme: 'light',

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      addNotification: (notification) =>
        set((s) => ({
          notifications: [notification, ...s.notifications].slice(0, 50),
          unreadCount: s.unreadCount + (notification.isRead ? 0 : 1),
        })),

      markNotificationRead: (id) =>
        set((s) => {
          const notifications = s.notifications.map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          );
          const unreadCount = notifications.filter((n) => !n.isRead).length;
          return { notifications, unreadCount };
        }),

      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, isRead: true })),
          unreadCount: 0,
        })),

      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),

      setTheme: (theme) => {
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },
    }),
    {
      name: 'ps_ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
);
