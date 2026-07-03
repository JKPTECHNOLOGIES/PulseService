import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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

const schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().min(1, "Phone is required"),
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

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: "residential" },
  });

  const customerType = watch("type");

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
    }
  }, [customer, isEditing, reset]);

  const onSubmit = async (data: FormData) => {
    // address/city/state/zip are Location columns, not Customer columns, so
    // package them into a primary location instead of sending them as
    // top-level customer fields (which Prisma would reject).
    const { address, city, state, zip, ...customerFields } = data;
    const payload = {
      ...customerFields,
      type: customerFields.type as Customer["type"],
      // Prisma needs an explicit null to clear the relation, not "".
      pricingTierId:
        customerFields.pricingTierId === ""
          ? null
          : customerFields.pricingTierId,
    };
    const locations = address?.trim()
      ? [
          {
            name: "Primary",
            address,
            city: city ?? "",
            state: state ?? "",
            zip: zip ?? "",
            type: "service",
            isPrimary: true,
          },
        ]
      : undefined;

    if (isEditing) {
      await updateMutation.mutateAsync({ id: id, ...payload, locations });
      navigate(`/customers/${id}`);
    } else {
      const result = await createMutation.mutateAsync({
        ...payload,
        locations,
      });
      const newId = result.data.id;
      navigate(newId ? `/customers/${newId}` : "/customers");
    }
  };

  if (isEditing && isLoading) return <PageSpinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
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
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  {...register("phone")}
                  type="tel"
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
