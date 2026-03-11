import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import LoginPage from './pages/auth/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import FlatsPage from './pages/flats/FlatsPage';
import MyFlatPage from './pages/flats/MyFlatPage';
import BillingPage from './pages/billing/BillingPage';
import ComplaintsPage from './pages/complaints/ComplaintsPage';
import ExpensesPage from './pages/expenses/ExpensesPage';
import BylawsPage from './pages/bylaws/BylawsPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import RegisterPage from './pages/auth/RegisterPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'SUPER_ADMIN' && user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />}
      />

      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/flats" element={<AdminRoute><FlatsPage /></AdminRoute>} />
      <Route path="/my-flat" element={<ProtectedRoute><MyFlatPage /></ProtectedRoute>} />
      <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
      <Route path="/complaints" element={<ProtectedRoute><ComplaintsPage /></ProtectedRoute>} />
      <Route path="/expenses" element={<AdminRoute><ExpensesPage /></AdminRoute>} />
      <Route path="/bylaws" element={<ProtectedRoute><BylawsPage /></ProtectedRoute>} />
      <Route path="/reports" element={<AdminRoute><ReportsPage /></AdminRoute>} />
      <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
