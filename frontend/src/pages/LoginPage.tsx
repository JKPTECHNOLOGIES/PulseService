import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import Button from "../components/ui/Button";
import ThermometerLogo from "../components/ui/ThermometerLogo";
import type { User } from "../types";

const schema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormData = z.infer<typeof schema>;

// Maps the ?error= query param the Microsoft callback redirects back with
// (see backend microsoftAuth.controller.js) to a human-readable message.
const MICROSOFT_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "Your sign-in attempt expired or was invalid. Please try again.",
  no_email: "Your Microsoft account has no email address on file.",
  domain_not_allowed: "That Microsoft account isn't part of this organization.",
  account_disabled: "This account has been disabled. Contact an admin.",
  microsoft_login_failed: "Microsoft sign-in failed. Please try again.",
};

function microsoftErrorMessage(code: string): string {
  if (code.startsWith("microsoft_") && !(code in MICROSOFT_ERROR_MESSAGES)) {
    return "Microsoft sign-in failed. Please try again.";
  }
  return MICROSOFT_ERROR_MESSAGES[code] ?? "Sign-in failed. Please try again.";
}

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");

  // Surfaces errors the Microsoft sign-in callback redirects back with
  // (e.g. ?error=domain_not_allowed) as the same inline banner as a failed
  // password login.
  useEffect(() => {
    const errorCode = searchParams.get("error");
    if (errorCode) {
      setServerError(microsoftErrorMessage(errorCode));
    }
  }, [searchParams]);

  const signInWithMicrosoft = () => {
    window.location.href = "/api/v1/auth/microsoft/login";
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
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
            <ThermometerLogo className="h-10 w-10" />
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

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-gray-400">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={signInWithMicrosoft}
          >
            <MicrosoftLogo className="h-4 w-4" />
            Sign in with Microsoft
          </Button>
        </div>

        <p className="text-center text-primary-400 text-xs mt-6">
          &copy; {new Date().getFullYear()} Prime Comfort Solutions. All rights
          reserved.
        </p>
      </div>
    </div>
  );
}
