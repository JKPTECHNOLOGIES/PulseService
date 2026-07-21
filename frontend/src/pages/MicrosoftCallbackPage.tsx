import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { PageSpinner } from "../components/ui/Spinner";
import type { User } from "../types";

// Lands here after the backend's Microsoft OAuth callback redirects back with
// our app JWT in the URL fragment (never sent to servers/logs, unlike a query
// string). Exchanges it for the full user profile, then hands off to the
// normal auth store exactly like a password login would.
export default function MicrosoftCallbackPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const ranOnce = useRef(false);

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");

    if (!token) {
      navigate("/login?error=microsoft_login_failed", { replace: true });
      return;
    }

    // Set the token first so the api client's request interceptor attaches
    // it as a Bearer token for this /auth/me call.
    localStorage.setItem("token", token);

    api
      .get<{ data?: User } & Partial<User>>("/auth/me")
      .then((response) => {
        const user = (response.data ?? response) as User;
        setAuth(user, token);
        navigate("/", { replace: true });
      })
      .catch(() => {
        localStorage.removeItem("token");
        navigate("/login?error=microsoft_login_failed", { replace: true });
      });
  }, [navigate, setAuth]);

  return <PageSpinner />;
}
