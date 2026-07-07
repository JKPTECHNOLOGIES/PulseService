import axios from "axios";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { recordApiError } from "./apiErrorStore";

const instance = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The response interceptor unwraps the axios envelope so callers receive the
// JSON body directly. On 401 we clear the session and bounce to login.
instance.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => response.data as AxiosResponse,
  (error: unknown) => {
    const e = error as {
      response?: { status?: number; data?: unknown };
      config?: { method?: string; url?: string };
    };
    const response = e.response;
    const status = response?.status;
    if (status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    const body = response?.data;
    const serverMessage =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined;
    // Prefer the server's message; otherwise give a clearer default than a bare
    // "Request failed" that tells the user (and us) what kind of failure it was.
    const message =
      serverMessage ??
      (status === undefined
        ? "Couldn't reach the server. Check your connection and try again."
        : status >= 500
          ? `Something went wrong on the server (${String(status)}).`
          : `Request failed (${String(status)}).`);

    // Stash request diagnostics for the error toast's copy-to-clipboard.
    recordApiError({
      method: e.config?.method?.toUpperCase(),
      url: e.config?.url,
      status,
      serverMessage: message,
    });

    return Promise.reject(new Error(message));
  },
);

/**
 * Thin, fully-typed wrapper around axios. Every call resolves to the parsed
 * response body typed as `T` (the response interceptor already unwraps
 * `response.data`). This is the single place where the axios-to-body cast
 * lives, so hooks and components never need `as any`.
 */
const api = {
  get: <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    instance.get(url, config) as unknown as Promise<T>,
  post: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => instance.post(url, data, config) as unknown as Promise<T>,
  put: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => instance.put(url, data, config) as unknown as Promise<T>,
  patch: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => instance.patch(url, data, config) as unknown as Promise<T>,
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    instance.delete(url, config) as unknown as Promise<T>,
};

export default api;
