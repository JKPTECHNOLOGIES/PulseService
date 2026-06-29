import axios from "axios";
import type { AxiosRequestConfig, AxiosResponse } from "axios";

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
    const response = (
      error as { response?: { status?: number; data?: unknown } }
    ).response;
    if (response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    // Reject with an Error whose message is the server's error text (read by
    // getErrorMessage in lib/errors.ts), so the rejection reason is always an Error.
    const body = response?.data;
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Request failed";
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
