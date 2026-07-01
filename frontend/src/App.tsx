import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import { PageSpinner } from "./components/ui/Spinner";

// Route pages are code-split so each is fetched on demand, keeping the initial
// bundle small instead of shipping every page (and its heavy deps like charts
// and drag-and-drop) up front.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
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
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const AgreementsPage = lazy(() => import("./pages/AgreementsPage"));
const AgreementDetailPage = lazy(() => import("./pages/AgreementDetailPage"));
const MarketingPage = lazy(() => import("./pages/MarketingPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const EquipmentPage = lazy(() => import("./pages/EquipmentPage"));
const PublicEstimatePage = lazy(() => import("./pages/PublicEstimatePage"));

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Public, token-gated customer estimate approval (no login) */}
        <Route path="/estimate/:id" element={<PublicEstimatePage />} />
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/new" element={<CustomerFormPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="customers/:id/edit" element={<CustomerFormPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/new" element={<JobFormPage />} />
          <Route path="jobs/:id" element={<JobDetailPage />} />
          <Route path="jobs/:id/edit" element={<JobFormPage />} />
          <Route path="dispatch" element={<DispatchPage />} />
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
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="equipment" element={<EquipmentPage />} />
          <Route path="agreements" element={<AgreementsPage />} />
          <Route path="agreements/:id" element={<AgreementDetailPage />} />
          <Route path="marketing" element={<MarketingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
