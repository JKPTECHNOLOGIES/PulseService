import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import {
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
} from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import { usePricingTiers } from "../hooks/usePricingTiers";
import type { Customer } from "../types";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { PageSpinner } from "../components/ui/Spinner";
import { useFormDraft } from "../hooks/useFormDraft";

// Extra phone/email contacts and extra addresses beyond the primary ones on
// the main form - each gets a label so it's clear what it's for ("Spouse",
// "Billing", "Warehouse", etc.). Kept as plain state (not registered with
// react-hook-form) to match the LineItemsTable pattern used elsewhere for
// repeatable rows.
interface ContactRow {
  id?: string;
  label: string;
  phone: string;
  email: string;
}

interface AddressRow {
  id?: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  mobilePhone: z.string().optional(),
  type: z.string().min(1),
  companyName: z.string().optional(),
  notes: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  source: z.string().optional(),
  pricingTierId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface CustomerDraft {
  form: Partial<FormData>;
  contacts: ContactRow[];
  addresses: AddressRow[];
}

// See EstimateFormPage: autosave a New Customer draft so navigating away or a
// reload doesn't lose it. Cleared once the customer is created.
const DRAFT_KEY = "draft:customer:new";
const DEFAULT_VALUES: Partial<FormData> = { type: "residential" };

const SOURCES = [
  "website",
  "referral",
  "google",
  "yelp",
  "social_media",
  "direct_mail",
  "other",
];

export default function CustomerFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = !!id;

  const { data: customer, isLoading } = useCustomer(id ?? "");
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const { options: customerTypeOptions } = useLookup("customerType");
  const { data: pricingTiers } = usePricingTiers();

  // Extra contacts (beyond the primary phone/mobile/email above) and extra
  // addresses (beyond the primary address below). The primary location's id
  // is tracked separately so edits update that same Location row instead of
  // creating a duplicate.
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [primaryLocationId, setPrimaryLocationId] = useState<
    string | undefined
  >(undefined);

  const addContact = () => {
    setContacts([...contacts, { label: "", phone: "", email: "" }]);
  };
  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };
  const updateContact = (
    index: number,
    field: keyof ContactRow,
    value: string,
  ) => {
    setContacts(
      contacts.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  };

  const addAddress = () => {
    setAddresses([
      ...addresses,
      { label: "", address: "", city: "", state: "", zip: "" },
    ]);
  };
  const removeAddress = (index: number) => {
    setAddresses(addresses.filter((_, i) => i !== index));
  };
  const updateAddress = (
    index: number,
    field: keyof AddressRow,
    value: string,
  ) => {
    setAddresses(
      addresses.map((a, i) => (i === index ? { ...a, [field]: value } : a)),
    );
  };

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
  });

  const customerType = watch("type");

  const { restored: draftRestored, clearDraft } = useFormDraft<CustomerDraft>({
    key: DRAFT_KEY,
    enabled: !isEditing,
    value: { form: watch(), contacts, addresses },
    hasContent: (v) =>
      Boolean(v.form.firstName) ||
      Boolean(v.form.lastName) ||
      Boolean(v.form.companyName) ||
      Boolean(v.form.email) ||
      Boolean(v.form.phone) ||
      Boolean(v.form.address) ||
      v.contacts.length > 0 ||
      v.addresses.length > 0,
    onRestore: (v) => {
      reset({ ...DEFAULT_VALUES, ...v.form });
      setContacts(v.contacts);
      setAddresses(v.addresses);
    },
  });

  const discardDraft = () => {
    reset(DEFAULT_VALUES);
    setContacts([]);
    setAddresses([]);
    clearDraft();
  };

  useEffect(() => {
    if (customer && isEditing) {
      const primary =
        customer.locations?.find((l) => l.isPrimary) ?? customer.locations?.[0];
      reset({
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email ?? "",
        phone: customer.phone ?? "",
        mobilePhone: customer.mobilePhone ?? "",
        type: customer.type,
        companyName: customer.companyName ?? "",
        notes: customer.notes ?? "",
        source: customer.source ?? "",
        pricingTierId: customer.pricingTierId ?? "",
        address: primary?.address ?? "",
        city: primary?.city ?? "",
        state: primary?.state ?? "",
        zip: primary?.zip ?? "",
      });
      setPrimaryLocationId(primary?.id);
      setAddresses(
        (customer.locations ?? [])
          .filter((l) => l.id !== primary?.id)
          .map((l) => ({
            id: l.id,
            label: l.name,
            address: l.address,
            city: l.city,
            state: l.state,
            zip: l.zip,
          })),
      );
      setContacts(
        (customer.contacts ?? []).map((c) => ({
          id: c.id,
          label: c.role ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
        })),
      );
    }
  }, [customer, isEditing, reset]);

  const onSubmit = async (data: FormData) => {
    // address/city/state/zip are Location columns, not Customer columns, so
    // package them into a primary location instead of sending them as
    // top-level customer fields (which Prisma would reject).
    const { address, city, state, zip, ...customerFields } = data;
    const payload = {
      ...customerFields,
      // Phone is a required column in the database, but not every customer
      // has one on hand at intake time -- fall back to a clear placeholder
      // instead of blocking the whole form on it.
      phone: customerFields.phone?.trim() ? customerFields.phone.trim() : "N/A",
      type: customerFields.type as Customer["type"],
      // Prisma needs an explicit null to clear the relation, not "".
      pricingTierId:
        customerFields.pricingTierId === ""
          ? null
          : customerFields.pricingTierId,
    };
    const primaryLocation = address?.trim()
      ? {
          id: isEditing ? primaryLocationId : undefined,
          name: "Primary",
          address,
          city: city ?? "",
          state: state ?? "",
          zip: zip ?? "",
          type: "service",
          isPrimary: true,
        }
      : undefined;

    // Drop rows the user added but never filled in.
    const additionalAddresses = addresses
      .filter((a) => a.label.trim() || a.address.trim())
      .map((a) => ({
        id: a.id,
        name: a.label.trim() || undefined,
        address: a.address,
        city: a.city,
        state: a.state,
        zip: a.zip,
        type: "service",
      }));
    const locations = primaryLocation
      ? [primaryLocation, ...additionalAddresses]
      : additionalAddresses.length > 0
        ? additionalAddresses
        : undefined;

    // Additional contacts don't collect a first/last name of their own -
    // the label (e.g. "Spouse", "Billing") is what identifies them, so it
    // doubles as the stored Contact's name.
    const additionalContacts = contacts
      .filter((c) => c.label.trim() || c.phone.trim() || c.email.trim())
      .map((c) => ({
        id: c.id,
        firstName: c.label.trim() || "Contact",
        lastName: "",
        role: c.label.trim() || undefined,
        phone: c.phone.trim() || undefined,
        email: c.email.trim() || undefined,
      }));

    if (isEditing) {
      await updateMutation.mutateAsync({
        id: id,
        ...payload,
        locations,
        contacts: additionalContacts,
      });
      navigate(`/customers/${id}`);
    } else {
      const result = await createMutation.mutateAsync({
        ...payload,
        locations,
        contacts: additionalContacts,
      });
      clearDraft();
      const newId = result.data.id;
      navigate(newId ? `/customers/${newId}` : "/customers");
    }
  };

  if (isEditing && isLoading) return <PageSpinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {draftRestored && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm">
          <span className="text-primary-800">Restored your unsaved draft.</span>
          <button
            type="button"
            onClick={discardDraft}
            className="shrink-0 font-medium text-primary-700 underline underline-offset-2"
          >
            Start fresh
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="space-y-5"
      >
        {/* Basic Info */}
        <Card title="Customer Information">
          <div className="space-y-4">
            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customer Type
              </label>
              <div className="flex gap-3">
                {customerTypeOptions.map((t) => (
                  <label
                    key={t.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      {...register("type")}
                      type="radio"
                      value={t.value}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm capitalize text-gray-700">
                      {t.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {customerType === "commercial" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Company Name
                </label>
                <input
                  {...register("companyName")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  {...register("firstName")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {errors.firstName && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.firstName.message}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  {...register("lastName")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {errors.lastName && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.lastName.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Phone
                </label>
                <input
                  {...register("phone")}
                  type="tel"
                  placeholder="Leave blank for N/A"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {errors.phone && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.phone.message}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Mobile Phone
                </label>
                <input
                  {...register("mobilePhone")}
                  type="tel"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Additional Contacts
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<PlusIcon className="h-4 w-4" />}
                  onClick={addContact}
                >
                  Add Contact
                </Button>
              </div>
              {contacts.length === 0 ? (
                <p className="text-xs text-gray-400">
                  No additional contacts yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {contacts.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-gray-200 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={c.label}
                          onChange={(e) => {
                            updateContact(i, "label", e.target.value);
                          }}
                          placeholder="Label (e.g. Spouse, Billing)"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            removeContact(i);
                          }}
                          aria-label="Remove contact"
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="tel"
                          value={c.phone}
                          onChange={(e) => {
                            updateContact(i, "phone", e.target.value);
                          }}
                          placeholder="Phone"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                        <input
                          type="email"
                          value={c.email}
                          onChange={(e) => {
                            updateContact(i, "email", e.target.value);
                          }}
                          placeholder="Email"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Source
              </label>
              <select
                {...register("source")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                <option value="">Select source...</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Pricing Tier
              </label>
              <select
                {...register("pricingTierId")}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                <option value="">No tier (catalog pricing)</option>
                {(pricingTiers ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.discountValue > 0
                      ? ` (${
                          t.discountType === "percentage"
                            ? `${String(t.discountValue)}% off`
                            : `$${String(t.discountValue)} off`
                        })`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Notes
              </label>
              <textarea
                {...register("notes")}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                placeholder="Internal notes about this customer..."
              />
            </div>
          </div>
        </Card>

        {/* Primary Address */}
        <Card title="Primary Address">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Street Address
              </label>
              <input
                {...register("address")}
                type="text"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="123 Main St"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  City
                </label>
                <input
                  {...register("city")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  State
                </label>
                <input
                  {...register("state")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="CA"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  ZIP
                </label>
                <input
                  {...register("zip")}
                  type="text"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Additional Addresses */}
        <Card title="Additional Addresses">
          <div className="flex justify-end mb-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={addAddress}
            >
              Add Address
            </Button>
          </div>
          {addresses.length === 0 ? (
            <p className="text-xs text-gray-400">
              No additional addresses yet.
            </p>
          ) : (
            <div className="space-y-3">
              {addresses.map((a, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-200 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={a.label}
                      onChange={(e) => {
                        updateAddress(i, "label", e.target.value);
                      }}
                      placeholder="Label (e.g. Warehouse, Second Home)"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        removeAddress(i);
                      }}
                      aria-label="Remove address"
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={a.address}
                    onChange={(e) => {
                      updateAddress(i, "address", e.target.value);
                    }}
                    placeholder="Street address"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={a.city}
                      onChange={(e) => {
                        updateAddress(i, "city", e.target.value);
                      }}
                      placeholder="City"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={a.state}
                      onChange={(e) => {
                        updateAddress(i, "state", e.target.value);
                      }}
                      placeholder="State"
                      maxLength={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={a.zip}
                      onChange={(e) => {
                        updateAddress(i, "zip", e.target.value);
                      }}
                      placeholder="ZIP"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              navigate(-1);
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={
              isSubmitting ||
              createMutation.isPending ||
              updateMutation.isPending
            }
          >
            {isEditing ? "Save Changes" : "Create Customer"}
          </Button>
        </div>
      </form>
    </div>
  );
}
