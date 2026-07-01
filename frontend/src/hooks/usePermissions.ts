import { useAuthStore } from "../store/authStore";

/**
 * Reads the current user's effective permissions (delivered on login / from
 * /auth/me) and exposes helpers for gating UI. Enforcement still happens on the
 * backend; this only controls what's shown.
 */
export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];

  const can = (permission: string) => permissions.includes(permission);
  const canAny = (...perms: string[]) =>
    perms.some((p) => permissions.includes(p));
  const canAll = (...perms: string[]) =>
    perms.every((p) => permissions.includes(p));

  return { permissions, can, canAny, canAll };
}
