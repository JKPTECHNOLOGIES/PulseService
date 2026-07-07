import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "../lib/toast";
import { useAuthStore } from "../store/authStore";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { User } from "../types";

interface LoginPayload {
  email: string;
  password: string;
}

interface LoginResponse {
  user: User;
  token: string;
  data?: { user: User; token: string };
}

export function useAuth() {
  const { user, token, isAuthenticated, setAuth, logout } = useAuthStore();
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const res = await api.post<LoginResponse>("/auth/login", payload);
      return res.data ?? res;
    },
    onSuccess: (data) => {
      setAuth(data.user, data.token);
      toast.success(`Welcome back, ${data.user.firstName}!`);
      navigate("/dashboard");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Login failed"));
    },
  });

  const logoutFn = () => {
    logout();
    navigate("/login");
    toast.success("Logged out successfully");
  };

  return {
    user,
    token,
    isAuthenticated,
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    logout: logoutFn,
  };
}
