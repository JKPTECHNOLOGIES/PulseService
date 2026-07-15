import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import RequirePermission from "./components/layout/RequirePermission";
import { PageSpinner } from "./components/ui/Spinner";
import { useAuthStore } from "./store/authStore";

// Route pages are code-split so each is fetched on demand, keeping the initial
// bundle small instead of shipping every page (and its heavy deps like charts
// and drag-and-drop) up front.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const MyDayPage = lazy(() => import("./pages/MyDayPage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("./pages/CustomerDetailPage"));
const CustomerFormPage = lazy(() => import("./pages/CustomerFormPage"));
const JobsPage = lazy(() => import("./pages/JobsPage"));
const JobDetailPage = lazy(() => import("./pages/JobDetailPage"));
const JobFormPage = lazy(() => import("./pages/JobFormPage"));
const DispatchPage = lazy(() => import("./pages/DispatchPage"));
const EstimatesPage = lazy(() => import("./pages/EstimatesPage"));
const EstimateDetailPage = lazy(() => import("./pages/EstimateDetailPage"));
const EstimateFormPage = lazy(() => import("./pages/EstimateFormPage"));
const InvoicesPage = lazy(() => import("./pages/InvoicesPage"));
const InvoiceDetailPage = lazy(() => import("./pages/InvoiceDetailPage"));
const InvoiceFormPage = lazy(() => import("./pages/InvoiceFormPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const TechniciansPage = lazy(() => import("./pages/TechniciansPage"));
const PricebookPage = lazy(() => import("./pages/PricebookPage"));
const PricingTiersPage = lazy(() => import("./pages/PricingTiersPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const VendorsPage = lazy(() => import("./pages/VendorsPage"));
const StockLocationsPage = lazy(() => import("./pages/StockLocationsPage"));
const CycleCountPage = lazy(() => import("./pages/CycleCountPage"));
const PurchaseOrdersPage = lazy(() => import("./pages/PurchaseOrdersPage"));
const PurchaseOrderDetailPage = lazy(
  () => import("./pages/PurchaseOrderDetailPage"),
);
const SerializedUnitsPage = lazy(() => import("./pages/SerializedUnitsPage"));
const AgreementsPage = lazy(() => import("./pages/AgreementsPage"));
const AgreementDetailPage = lazy(() => import("./pages/AgreementDetailPage"));
const MarketingPage = lazy(() => import("./pages/MarketingPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const HelpCenterPage = lazy(() => import("./pages/HelpCenterPage"));
const EquipmentPage = lazy(() => import("./pages/EquipmentPage"));
const RecurringPage = lazy(() => import("./pages/RecurringPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const PublicEstimatePage = lazy(() => import("./pages/PublicEstimatePage"));

// Technicians land on their field-first agenda; everyone else on the dashboard.
function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  return (
    <Navigate to={role === "technician" ? "/my-day" : "/dashboard"} replace />
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Public, token-gated customer estimate approval (no login) */}
        <Route path="/estimate/:id" element={<PublicEstimatePage />} />
        <Route path="/" element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="my-day" element={<MyDayPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/new" element={<CustomerFormPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="customers/:id/edit" element={<CustomerFormPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route
            path="jobs/new"
            element={
              <RequirePermission perm={["jobs.create"]}>
                <JobFormPage />
              </RequirePermission>
            }
          />
          <Route path="jobs/:id" element={<JobDetailPage />} />
          <Route
            path="jobs/:id/edit"
            element={
              <RequirePermission perm={["jobs.edit"]}>
                <JobFormPage />
              </RequirePermission>
            }
          />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="dispatch" element={<DispatchPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="estimates" element={<EstimatesPage />} />
          <Route path="estimates/new" element={<EstimateFormPage />} />
          <Route path="estimates/:id" element={<EstimateDetailPage />} />
          <Route path="estimates/:id/edit" element={<EstimateFormPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/new" element={<InvoiceFormPage />} />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="invoices/:id/edit" element={<InvoiceFormPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="technicians" element={<TechniciansPage />} />
          <Route path="pricebook" element={<PricebookPage />} />
          <Route
            path="pricebook/pricing-tiers"
            element={<PricingTiersPage />}
          />
          <Route path="inventory" element={<InventoryPage />} />
          <Route
            path="inventory/locations"
            element={
              <RequirePermission
                perm={[
                  "inventory.manage",
                  "inventory.issueToJob",
                  "purchasing.manage",
                  "purchasing.receive",
                  "vendors.manage",
                ]}
              >
                <StockLocationsPage />
              </RequirePermission>
            }
          />
          <Route path="inventory/cycle-count" element={<CycleCountPage />} />
          <Route
            path="vendors"
            element={
              <RequirePermission perm={["vendors.manage"]}>
                <VendorsPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing"
            element={
              <RequirePermission
                perm={["purchasing.manage", "purchasing.receive"]}
              >
                <PurchaseOrdersPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/:id"
            element={
              <RequirePermission
                perm={["purchasing.manage", "purchasing.receive"]}
              >
                <PurchaseOrderDetailPage />
              </RequirePermission>
            }
          />
          <Route path="serials" element={<SerializedUnitsPage />} />
          <Route path="equipment" element={<EquipmentPage />} />
          <Route path="agreements" element={<AgreementsPage />} />
          <Route path="agreements/:id" element={<AgreementDetailPage />} />
          <Route path="marketing" element={<MarketingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="help" element={<HelpCenterPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
