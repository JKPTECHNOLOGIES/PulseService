import { useState, useEffect } from "react";
import { Tab } from "@headlessui/react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import toast from "react-hot-toast";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { CompanySettings, User, BusinessUnit, ApiResponse } from "../types";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import { LookupSelect } from "../components/ui/LookupSelect";
import Modal from "../components/ui/Modal";
import { PageSpinner } from "../components/ui/Spinner";
import { useLookup } from "../hooks/useMetadata";

interface BillingForm {
  taxRate?: number;
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
}

interface BusinessUnitForm {
  name: string;
  type: string;
}

// ----- Data hooks -----
function useCompanySettings() {
  return useQuery({
    queryKey: ["settings", "company"],
    queryFn: async () => {
      const res =
        await api.get<ApiResponse<CompanySettings>>("/settings/company");
      return res.data;
    },
  });
}

function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<CompanySettings>) =>
      api.put("/settings/company", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    },
  });
}

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
        <div className="grid grid-cols-2 gap-4">
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
        <div className="grid grid-cols-3 gap-4">
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
    <Card title="Billing & Tax Settings">
      <form
        onSubmit={(e) =>
          void handleSubmit((d) => {
            updateMutation.mutate(d);
          })(e)
        }
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Default Tax Rate (%)
            </label>
            <input
              type="number"
              step="0.01"
              {...register("taxRate", { valueAsNumber: true })}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
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
        <div className="grid grid-cols-2 gap-4">
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
  const { getLabel: getRoleLabel, getColor: getRoleColor } =
    useLookup("userRole");
  const { register, handleSubmit, reset } = useForm<InviteForm>();

  const inviteMutation = useMutation({
    mutationFn: (payload: InviteForm) => api.post("/users", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User invited");
      setInviteModal(false);
      reset();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to invite user"));
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
      <table className="w-full text-sm">
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
            </tr>
          ))}
        </tbody>
      </table>

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
          <div className="grid grid-cols-2 gap-4">
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
    </Card>
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

export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const tabs = ["Company", "Billing", "Users", "Business Units"];

  return (
    <div className="max-w-3xl space-y-5">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                clsx(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selected
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="mt-5">
          <Tab.Panel>
            <CompanyTab />
          </Tab.Panel>
          <Tab.Panel>
            <BillingTab />
          </Tab.Panel>
          <Tab.Panel>
            <UsersTab />
          </Tab.Panel>
          <Tab.Panel>
            <BusinessUnitsTab />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
