import { useState, useEffect } from "react";
import { Tab } from "@headlessui/react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import toast from "../lib/toast";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import {
  CompanySettings,
  User,
  BusinessUnit,
  ApiResponse,
  PermissionGroup,
  RolePermissions,
  AuditLogEntry,
  PaginatedResponse,
} from "../types";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import { LookupSelect } from "../components/ui/LookupSelect";
import Modal from "../components/ui/Modal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Pagination from "../components/ui/Pagination";
import { PageSpinner } from "../components/ui/Spinner";
import Switch from "../components/ui/Switch";
import SearchInput from "../components/ui/SearchInput";
import { formatDateTime } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import { usePermissions } from "../hooks/usePermissions";
import { resetAllPageHelpSeen } from "../hooks/usePageHelpSeen";
import {
  useCompanySettings,
  useUpdateCompanySettings,
} from "../hooks/useSettings";
import { useAuthStore } from "../store/authStore";
import QuickBooksTab from "../components/settings/QuickBooksTab";

interface BillingForm {
  currency?: string;
  invoiceTerms?: string;
  estimateTerms?: string;
  invoicePrefix?: string;
  estimatePrefix?: string;
}

interface InviteForm {
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

interface EditUserForm {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface BusinessUnitForm {
  name: string;
  type: string;
}

// ----- Data hooks -----
// useCompanySettings/useUpdateCompanySettings live in ../hooks/useSettings
// (shared with SendInvoiceModal, which needs the company phone number for
// its default message).

function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<User[]>>("/users", {
        params: { limit: 100 },
      });
      return res.data;
    },
  });
}

function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RolePermissions[]>>("/roles");
      return res.data;
    },
  });
}

function usePermissionCatalog() {
  return useQuery({
    queryKey: ["roles", "catalog"],
    queryFn: async () => {
      const res =
        await api.get<ApiResponse<PermissionGroup[]>>("/roles/catalog");
      return res.data;
    },
  });
}

function useBusinessUnits() {
  return useQuery({
    queryKey: ["business-units"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<BusinessUnit[]>>("/business-units");
      return res.data;
    },
  });
}

// ----- Company Tab -----
function CompanyTab() {
  const { data: settings, isLoading } = useCompanySettings();
  const updateMutation = useUpdateCompanySettings();
  const { register, handleSubmit, reset } = useForm<Partial<CompanySettings>>();

  useEffect(() => {
    if (settings) reset(settings);
  }, [settings, reset]);

  if (isLoading) return <PageSpinner />;

  return (
    <Card title="Company Information">
      <form
        onSubmit={(e) =>
          void handleSubmit((d) => {
            updateMutation.mutate(d);
          })(e)
        }
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Company Name
          </label>
          <input
            {...register("name")}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Phone
            </label>
            <input
              {...register("phone")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email
            </label>
            <input
              {...register("email")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Website
          </label>
          <input
            {...register("website")}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Address
          </label>
          <input
            {...register("address")}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              City
            </label>
            <input
              {...register("city")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              State
            </label>
            <input
              {...register("state")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ZIP
            </label>
            <input
              {...register("zip")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={updateMutation.isPending}>
            Save Changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ----- Billing Tab -----
function BillingTab() {
  const { data: settings, isLoading } = useCompanySettings();
  const updateMutation = useUpdateCompanySettings();
  const { register, handleSubmit, reset } = useForm<BillingForm>();

  useEffect(() => {
    if (settings) reset(settings);
  }, [settings, reset]);

  if (isLoading) return <PageSpinner />;

  return (
    <Card title="Billing Settings">
      <form
        onSubmit={(e) =>
          void handleSubmit((d) => {
            updateMutation.mutate(d);
          })(e)
        }
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Currency
            </label>
            <input
              {...register("currency")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="USD"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Invoice Terms
          </label>
          <textarea
            {...register("invoiceTerms")}
            rows={3}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            placeholder="Payment due within 30 days..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Estimate Terms
          </label>
          <textarea
            {...register("estimateTerms")}
            rows={3}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            placeholder="This estimate is valid for 30 days..."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Invoice Prefix
            </label>
            <input
              {...register("invoicePrefix")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="INV-"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Estimate Prefix
            </label>
            <input
              {...register("estimatePrefix")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="EST-"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={updateMutation.isPending}>
            Save Changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ----- Users Tab -----
function UsersTab() {
  const { data: users, isLoading } = useUsers();
  const qc = useQueryClient();
  const [inviteModal, setInviteModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  // Holds a one-time credential to display after invite / password reset.
  const [credential, setCredential] = useState<{
    name: string;
    password: string;
  } | null>(null);
  const { getLabel: getRoleLabel, getColor: getRoleColor } =
    useLookup("userRole");
  const { register, handleSubmit, reset } = useForm<InviteForm>();

  const inviteMutation = useMutation({
    mutationFn: (payload: InviteForm) =>
      api.post<ApiResponse<User> & { temporaryPassword?: string }>(
        "/users",
        payload,
      ),
    onSuccess: (res, vars) => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      setInviteModal(false);
      reset();
      if (res.temporaryPassword) {
        setCredential({
          name: `${vars.firstName} ${vars.lastName}`,
          password: res.temporaryPassword,
        });
      } else {
        toast.success("User invited");
      }
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to invite user"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EditUserForm }) =>
      api.put(`/users/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated");
      setEditUser(null);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update user"));
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (u: User) =>
      api.post<ApiResponse<{ temporaryPassword: string }>>(
        `/users/${u.id}/reset-password`,
      ),
    onSuccess: (res, u) => {
      setCredential({
        name: `${u.firstName} ${u.lastName}`,
        password: res.data.temporaryPassword,
      });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reset password"));
    },
  });

  if (isLoading) return <PageSpinner />;

  return (
    <Card
      title="Team Members"
      actions={
        <Button
          size="sm"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            setInviteModal(true);
          }}
        >
          Invite User
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                Name
              </th>
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                Email
              </th>
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                Role
              </th>
              <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                Status
              </th>
              <th className="text-right py-2 font-medium text-gray-500 text-xs uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(users ?? []).map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="py-3 font-medium text-gray-900">
                  {u.firstName} {u.lastName}
                </td>
                <td className="py-3 text-gray-600">{u.email}</td>
                <td className="py-3">
                  <Badge className={getRoleColor(u.role)}>
                    {getRoleLabel(u.role)}
                  </Badge>
                </td>
                <td className="py-3">
                  <Badge
                    className={
                      u.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }
                  >
                    {u.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      className="text-primary-600 hover:text-primary-800 text-xs font-medium"
                      onClick={() => {
                        setEditUser(u);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-gray-500 hover:text-gray-700 text-xs font-medium"
                      onClick={() => {
                        resetPasswordMutation.mutate(u);
                      }}
                    >
                      Reset Password
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={inviteModal}
        onClose={() => {
          setInviteModal(false);
        }}
        title="Invite User"
      >
        <form
          onSubmit={(e) =>
            void handleSubmit((d) => {
              inviteMutation.mutate(d);
            })(e)
          }
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                First Name
              </label>
              <input
                {...register("firstName")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Last Name
              </label>
              <input
                {...register("lastName")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email
            </label>
            <input
              {...register("email")}
              type="email"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Phone
            </label>
            <input
              {...register("phone")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Role
            </label>
            <LookupSelect category="userRole" {...register("role")} />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setInviteModal(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={inviteMutation.isPending}>
              Send Invite
            </Button>
          </div>
        </form>
      </Modal>

      {editUser && (
        <EditUserModal
          user={editUser}
          isPending={updateMutation.isPending}
          onClose={() => {
            setEditUser(null);
          }}
          onSubmit={(payload) => {
            updateMutation.mutate({ id: editUser.id, payload });
          }}
        />
      )}

      <Modal
        isOpen={credential !== null}
        onClose={() => {
          setCredential(null);
        }}
        title="Temporary Password"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this one-time password with{" "}
            <span className="font-medium text-gray-900">
              {credential?.name}
            </span>
            . It won&apos;t be shown again — they should change it after signing
            in.
          </p>
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 font-mono text-lg text-gray-900 text-center select-all">
            {credential?.password}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setCredential(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function EditUserModal({
  user,
  isPending,
  onClose,
  onSubmit,
}: {
  user: User;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (payload: EditUserForm) => void;
}) {
  const { register, handleSubmit } = useForm<EditUserForm>({
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Edit ${user.firstName} ${user.lastName}`}
    >
      <form
        onSubmit={(e) =>
          void handleSubmit((d) => {
            onSubmit({
              firstName: d.firstName,
              lastName: d.lastName,
              email: d.email,
              role: d.role,
              isActive: String(d.isActive) === "true",
            });
          })(e)
        }
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              First Name
            </label>
            <input
              {...register("firstName")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Last Name
            </label>
            <input
              {...register("lastName")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Email
          </label>
          <input
            {...register("email")}
            type="email"
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Role
          </label>
          <LookupSelect category="userRole" {...register("role")} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Status
          </label>
          <select
            {...register("isActive")}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----- Business Units Tab -----
function BusinessUnitsTab() {
  const { data: units, isLoading } = useBusinessUnits();
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const { register, handleSubmit, reset } = useForm<BusinessUnitForm>();
  const { getLabel: getUnitTypeLabel } = useLookup("businessUnitType");

  const createMutation = useMutation({
    mutationFn: (payload: BusinessUnitForm) =>
      api.post("/business-units", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-units"] });
      toast.success("Business unit created");
      setModal(false);
      reset();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/business-units/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-units"] });
      toast.success("Business unit deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete"));
    },
  });

  if (isLoading) return <PageSpinner />;

  return (
    <Card
      title="Business Units"
      actions={
        <Button
          size="sm"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            setModal(true);
          }}
        >
          Add Unit
        </Button>
      }
    >
      {(units ?? []).length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">
          No business units configured
        </p>
      ) : (
        <div className="space-y-2">
          {(units ?? []).map((unit) => (
            <div
              key={unit.id}
              className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{unit.name}</p>
                <p className="text-xs text-gray-500">
                  {getUnitTypeLabel(unit.type)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    unit.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }
                >
                  {unit.isActive ? "Active" : "Inactive"}
                </Badge>
                <button
                  onClick={() => {
                    deleteMutation.mutate(unit.id);
                  }}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={modal}
        onClose={() => {
          setModal(false);
        }}
        title="Add Business Unit"
      >
        <form
          onSubmit={(e) =>
            void handleSubmit((d) => {
              createMutation.mutate(d);
            })(e)
          }
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              {...register("name")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type
            </label>
            <LookupSelect category="businessUnitType" {...register("type")} />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setModal(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Add Unit
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ----- Roles & Permissions Tab -----
function RolesTab() {
  const { data: roles, isLoading } = useRoles();
  const { data: catalog, isLoading: catalogLoading } = usePermissionCatalog();
  const qc = useQueryClient();
  const { getLabel: getRoleLabel } = useLookup("userRole");
  const [role, setRole] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  // Select a default role once data loads.
  useEffect(() => {
    if (!role && roles && roles.length > 0) {
      setRole(roles[0].role);
      setDraft(roles[0].permissions);
    }
  }, [roles, role]);

  const current = roles?.find((r) => r.role === role);
  const isSystem = current?.isSystem ?? false;
  const isDirty =
    !isSystem &&
    current != null &&
    [...draft].sort().join(",") !== [...current.permissions].sort().join(",");

  const switchRole = (r: string) => {
    setRole(r);
    const found = roles?.find((x) => x.role === r);
    setDraft(found ? found.permissions : []);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: { role: string; permissions: string[] }) =>
      api.put(`/roles/${payload.role}/permissions`, {
        permissions: payload.permissions,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roles"] });
      toast.success("Permissions updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update permissions"));
    },
  });

  if (isLoading || catalogLoading) return <PageSpinner />;

  const toggle = (key: string) => {
    if (isSystem) return;
    setDraft((d) =>
      d.includes(key) ? d.filter((k) => k !== key) : [...d, key],
    );
  };

  const setGroup = (keys: string[], grant: boolean) => {
    if (isSystem) return;
    setDraft((d) => {
      const rest = d.filter((k) => !keys.includes(k));
      return grant ? [...rest, ...keys] : rest;
    });
  };

  // Narrow to groups/permissions matching the search, keeping a whole group
  // if its name matches, otherwise just the permissions within it that do.
  const q = search.trim().toLowerCase();
  const filteredGroups = (catalog ?? [])
    .map((group) => {
      if (!q || group.group.toLowerCase().includes(q)) return group;
      const permissions = group.permissions.filter((p) =>
        p.label.toLowerCase().includes(q),
      );
      return { ...group, permissions };
    })
    .filter((group) => group.permissions.length > 0);

  const totalCount = (catalog ?? []).reduce(
    (sum, g) => sum + g.permissions.length,
    0,
  );
  const grantedCount = isSystem ? totalCount : draft.length;

  return (
    <>
      <Card
        title="Roles & Permissions"
        actions={
          <Button
            size="sm"
            loading={saveMutation.isPending}
            disabled={isSystem}
            onClick={() => {
              saveMutation.mutate({ role, permissions: draft });
            }}
          >
            Save
          </Button>
        }
      >
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="max-w-xs flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => {
                const r = e.target.value;
                if (r === role) return;
                if (isDirty) {
                  setPendingRole(r);
                } else {
                  switchRole(r);
                }
              }}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {(roles ?? []).map((r) => (
                <option key={r.role} value={r.role}>
                  {getRoleLabel(r.role)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Search permissions
            </label>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Find a permission or section..."
            />
          </div>
          <p className="pb-2.5 text-xs text-gray-400 whitespace-nowrap">
            {grantedCount} of {totalCount} granted
          </p>
        </div>

        {isSystem && (
          <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            The administrator role always has every permission and can&apos;t be
            edited.
          </p>
        )}

        {filteredGroups.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No permissions match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredGroups.map((group) => {
              const keys = group.permissions.map((p) => p.key);
              const allChecked =
                isSystem || keys.every((k) => draft.includes(k));
              return (
                <div key={group.group} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {group.group}
                    </h4>
                    {!isSystem && keys.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setGroup(keys, !allChecked);
                        }}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700"
                      >
                        {allChecked ? "Clear all" : "Select all"}
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-gray-50">
                    {group.permissions.map((p) => {
                      const checked = isSystem || draft.includes(p.key);
                      return (
                        <div
                          key={p.key}
                          className="flex items-center justify-between gap-4 py-2.5"
                        >
                          <span className="text-sm text-gray-700">
                            {p.label}
                          </span>
                          <Switch
                            checked={checked}
                            disabled={isSystem}
                            label={p.label}
                            onChange={() => {
                              toggle(p.key);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <ConfirmDialog
        isOpen={pendingRole !== null}
        onClose={() => {
          setPendingRole(null);
        }}
        onConfirm={() => {
          if (pendingRole) switchRole(pendingRole);
          setPendingRole(null);
        }}
        title="Discard unsaved changes?"
        message={`You've changed permissions for ${getRoleLabel(role)} that haven't been saved. Switching roles now will discard them.`}
        confirmLabel="Discard & switch"
      />
    </>
  );
}

// ----- Activity Log Tab -----
const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  void: "bg-red-100 text-red-700",
  login: "bg-gray-100 text-gray-600",
};

function AuditTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["audit", page],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<AuditLogEntry>>("/audit", {
        params: { page, limit: 25 },
      });
      return res;
    },
  });

  if (isLoading) return <PageSpinner />;

  const logs = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <Card title="Activity Log">
      {logs.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          No activity recorded yet
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                    When
                  </th>
                  <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                    User
                  </th>
                  <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                    Action
                  </th>
                  <th className="text-left py-2 font-medium text-gray-500 text-xs uppercase">
                    Resource
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="py-3 text-gray-500 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-3 text-gray-700">
                      {log.userEmail ?? "—"}
                    </td>
                    <td className="py-3">
                      <Badge
                        className={
                          ACTION_COLORS[log.action] ??
                          "bg-gray-100 text-gray-600"
                        }
                      >
                        {log.action}
                      </Badge>
                    </td>
                    <td className="py-3 text-gray-600 font-mono text-xs">
                      {log.method} {log.path}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="pt-4">
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ----- Account Tab (self-service, all users) -----
interface ProfileForm {
  firstName: string;
  lastName: string;
  phone?: string;
}
interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const accountInputClass =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500";

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const profileForm = useForm<ProfileForm>({
    defaultValues: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      phone: user?.phone ?? "",
    },
  });
  const passwordForm = useForm<PasswordForm>();

  const profileMutation = useMutation({
    mutationFn: (payload: ProfileForm) =>
      api.put<ApiResponse<User>>("/auth/profile", payload),
    onSuccess: (res) => {
      updateUser(res.data);
      toast.success("Profile updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update profile"));
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      api.put("/auth/password", payload),
    onSuccess: () => {
      toast.success("Password changed");
      passwordForm.reset();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to change password"));
    },
  });

  const submitPassword = (d: PasswordForm) => {
    if (d.newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (d.newPassword !== d.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    passwordMutation.mutate({
      currentPassword: d.currentPassword,
      newPassword: d.newPassword,
    });
  };

  return (
    <div className="space-y-5">
      <Card title="Profile">
        <form
          onSubmit={(e) =>
            void profileForm.handleSubmit((d) => {
              profileMutation.mutate(d);
            })(e)
          }
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                First Name
              </label>
              <input
                {...profileForm.register("firstName")}
                className={accountInputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Last Name
              </label>
              <input
                {...profileForm.register("lastName")}
                className={accountInputClass}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Phone
            </label>
            <input
              {...profileForm.register("phone")}
              type="tel"
              inputMode="tel"
              className={accountInputClass}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={profileMutation.isPending}>
              Save Profile
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Change Password">
        <form
          onSubmit={(e) => void passwordForm.handleSubmit(submitPassword)(e)}
          className="space-y-4 max-w-md"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Current Password
            </label>
            <input
              {...passwordForm.register("currentPassword")}
              type="password"
              autoComplete="current-password"
              className={accountInputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              New Password
            </label>
            <input
              {...passwordForm.register("newPassword")}
              type="password"
              autoComplete="new-password"
              className={accountInputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Confirm New Password
            </label>
            <input
              {...passwordForm.register("confirmPassword")}
              type="password"
              autoComplete="new-password"
              className={accountInputClass}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={passwordMutation.isPending}>
              Change Password
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Help & Onboarding">
        <p className="text-sm text-gray-600 mb-4">
          The first time you visit each page, a short guide pops up explaining
          what it does. If you've dismissed those and want to see them again
          (for yourself, or because you're training someone else on this
          device), you can bring them all back.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            resetAllPageHelpSeen();
            toast.success(
              "Page tours reset \u2014 they'll pop up again as you visit each page.",
            );
          }}
        >
          Show page tours again
        </Button>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const { can } = usePermissions();

  const tabs = [
    { label: "Account", panel: <AccountTab /> },
    ...(can("settings.manage")
      ? [
          { label: "Company", panel: <CompanyTab /> },
          { label: "Billing", panel: <BillingTab /> },
        ]
      : []),
    ...(can("users.manage")
      ? [
          { label: "Users", panel: <UsersTab /> },
          { label: "Roles", panel: <RolesTab /> },
        ]
      : []),
    ...(can("settings.manage")
      ? [{ label: "Business Units", panel: <BusinessUnitsTab /> }]
      : []),
    ...(can("audit.view")
      ? [{ label: "Activity Log", panel: <AuditTab /> }]
      : []),
    ...(can("quickbooks.manage")
      ? [{ label: "QuickBooks", panel: <QuickBooksTab /> }]
      : []),
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map((tab) => (
            <Tab
              key={tab.label}
              className={({ selected }) =>
                clsx(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selected
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )
              }
            >
              {tab.label}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="mt-5">
          {tabs.map((tab) => (
            <Tab.Panel key={tab.label}>{tab.panel}</Tab.Panel>
          ))}
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
