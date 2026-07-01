import { ReactNode } from "react";
import { usePermissions } from "../../hooks/usePermissions";

interface CanProps {
  /** A single permission key or a list (any-of grants access). */
  permission: string | string[];
  children: ReactNode;
  /** Rendered when the user lacks the permission (defaults to nothing). */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on the current user's permissions.
 *
 * @example
 *   <Can permission="invoices.void">
 *     <Button onClick={void}>Void</Button>
 *   </Can>
 */
export function Can({ permission, children, fallback = null }: CanProps) {
  const { canAny } = usePermissions();
  const perms = Array.isArray(permission) ? permission : [permission];
  return <>{canAny(...perms) ? children : fallback}</>;
}
