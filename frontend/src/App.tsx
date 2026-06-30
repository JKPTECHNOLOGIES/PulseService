import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import CustomerFormPage from "./pages/CustomerFormPage";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import JobFormPage from "./pages/JobFormPage";
import DispatchPage from "./pages/DispatchPage";
import EstimatesPage from "./pages/EstimatesPage";
import EstimateDetailPage from "./pages/EstimateDetailPage";
import EstimateFormPage from "./pages/EstimateFormPage";
import InvoicesPage from "./pages/InvoicesPage";
import InvoiceDetailPage from "./pages/InvoiceDetailPage";
import InvoiceFormPage from "./pages/InvoiceFormPage";
import PaymentsPage from "./pages/PaymentsPage";
import TechniciansPage from "./pages/TechniciansPage";
import PricebookPage from "./pages/PricebookPage";
import InventoryPage from "./pages/InventoryPage";
import AgreementsPage from "./pages/AgreementsPage";
import MarketingPage from "./pages/MarketingPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import NotificationsPage from "./pages/NotificationsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="agreements" element={<AgreementsPage />} />
        <Route path="marketing" element={<MarketingPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
