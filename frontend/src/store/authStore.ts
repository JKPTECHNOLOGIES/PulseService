import { create } from "zustand";
import { persist } from "zustand/middleware";
import { User } from "../types";
import { clearOfflineData } from "../lib/queryClient";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  updateUser: (patch: Partial<User>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        localStorage.setItem("token", token);
        set({ user, token, isAuthenticated: true });
      },
      updateUser: (patch) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...patch } : state.user,
        }));
      },
      logout: () => {
        localStorage.removeItem("token");
        set({ user: null, token: null, isAuthenticated: false });
        // Drop cached data + any queued offline mutations so the next account
        // that logs in on this device starts clean.
        void clearOfflineData();
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
