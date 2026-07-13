import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BoltIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import Button from "../components/ui/Button";
import type { User } from "../types";

const schema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "admin@primecomfortac.com", password: "admin123" },
  });

  const onSubmit = async (data: FormData) => {
    setServerError("");
    try {
      const response = await api.post<{
        data?: { user: User; token: string };
        user?: User;
        token?: string;
      }>("/auth/login", data);
      const payload = response.data ?? response;
      if (payload.user && payload.token) {
        setAuth(payload.user, payload.token);
        navigate("/dashboard", { replace: true });
      } else {
        setServerError("Invalid email or password");
      }
    } catch (err: unknown) {
      setServerError(getErrorMessage(err, "Invalid email or password"));
    }
  };

  return (
    <div className="min-h-screen-safe bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-oncolor/10 backdrop-blur mb-4">
            <BoltIcon className="h-9 w-9 text-oncolor" />
          </div>
          <h1 className="text-3xl font-bold text-oncolor">
            Prime Comfort Solutions
          </h1>
          <p className="text-primary-300 mt-1 text-sm">
            Field Service Management Platform
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            Sign in to your account
          </h2>

          {serverError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {serverError}
            </div>
          )}

          <form
            onSubmit={(e) => void handleSubmit(onSubmit)(e)}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email Address
              </label>
              <input
                {...register("email")}
                type="email"
                autoComplete="email"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                  placeholder-gray-400"
                placeholder="you@company.com"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  {...register("password")}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="w-full px-3.5 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm
                    focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword(!showPassword);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isSubmitting}
              className="w-full mt-2"
            >
              {isSubmitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          {/* Demo credentials info */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-lg">
            <div className="flex gap-2">
              <InformationCircleIcon className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-800 mb-1">
                  Demo Credentials
                </p>
                <p className="text-xs text-blue-700">
                  Email:{" "}
                  <span className="font-mono">admin@primecomfortac.com</span>
                </p>
                <p className="text-xs text-blue-700">
                  Password: <span className="font-mono">admin123</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-primary-400 text-xs mt-6">
          &copy; {new Date().getFullYear()} Prime Comfort Solutions. All rights
          reserved.
        </p>
      </div>
    </div>
  );
}
