import { useNavigate } from "react-router-dom";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { usePermissions } from "../../hooks/usePermissions";
import EmptyState from "../ui/EmptyState";

interface RequirePermissionProps {
  /** Any one of these permissions grants access (mirrors Sidebar's `perm`). */
  perm: string[];
  children: React.ReactNode;
}

/**
 * Route-level access control. `Sidebar` already hides nav links a role can't
 * use, but that only ever hid the *link* -- the page itself was still fully
 * reachable (and its data fully servable, wherever the backend route wasn't
 * separately gated) by typing the URL directly. This wraps a route's element
 * so the page itself refuses to render for a role without the permission,
 * matching whatever the backend now actually enforces.
 */
export default function RequirePermission({
  perm,
  children,
}: RequirePermissionProps) {
  const { canAny } = usePermissions();
  const navigate = useNavigate();

  if (!canAny(...perm)) {
    return (
      <EmptyState
        icon={<LockClosedIcon />}
        title="You don't have access to this page"
        description="If you think this is a mistake, ask an admin to check your role's permissions in Settings."
        action={{
          label: "Back to Dashboard",
          onClick: () => {
            navigate("/dashboard");
          },
        }}
      />
    );
  }

  return <>{children}</>;
}
