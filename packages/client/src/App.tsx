import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import LoginPage from './pages/auth/LoginPage';
import AdminLoginPage from './pages/auth/AdminLoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import FlatsPage from './pages/flats/FlatsPage';
import MyFlatPage from './pages/flats/MyFlatPage';
import BillingPage from './pages/billing/BillingPage';
import ComplaintsPage from './pages/complaints/ComplaintsPage';
import ExpensesPage from './pages/expenses/ExpensesPage';
import BylawsPage from './pages/bylaws/BylawsPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import ChangePasswordSettingsPage from './pages/settings/ChangePasswordSettingsPage';
import RegisterPage from './pages/auth/RegisterPage';
import StaffPage from './pages/staff/StaffPage';
import { SOCIETY_ADMINS, SOCIETY_MANAGERS, FINANCIAL_ROLES } from './types';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Force password change for users with mustChangePassword flag
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Layout>{children}</Layout>;
}

function RoleRoute({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />;
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!roles.includes(user?.role || '')) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { isAuthenticated, user } = useAuthStore();

  return (
    <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/admin/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <AdminLoginPage />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />}
        />
        <Route
          path="/forgot-password"
          element={isAuthenticated ? <Navigate to="/" replace /> : <ForgotPasswordPage />}
        />
        <Route
          path="/reset-password"
          element={isAuthenticated ? <Navigate to="/" replace /> : <ResetPasswordPage />}
        />
        <Route
          path="/change-password"
          element={
            !isAuthenticated ? <Navigate to="/login" replace /> :
            !user?.mustChangePassword ? <Navigate to="/" replace /> :
            <ChangePasswordPage />
          }
        />

        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/flats" element={<RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_MANAGERS]}><FlatsPage /></RoleRoute>} />
        <Route path="/my-flat" element={<ProtectedRoute><MyFlatPage /></ProtectedRoute>} />
        <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
        <Route path="/complaints" element={<ProtectedRoute><ComplaintsPage /></ProtectedRoute>} />
        <Route path="/expenses" element={<RoleRoute roles={['SUPER_ADMIN', ...FINANCIAL_ROLES]}><ExpensesPage /></RoleRoute>} />
        <Route path="/bylaws" element={<ProtectedRoute><BylawsPage /></ProtectedRoute>} />
        <Route path="/reports" element={<RoleRoute roles={['SUPER_ADMIN', ...FINANCIAL_ROLES]}><ReportsPage /></RoleRoute>} />
        <Route path="/settings" element={<RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_ADMINS]}><SettingsPage /></RoleRoute>} />
        <Route path="/staff" element={<RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_ADMINS]}><StaffPage /></RoleRoute>} />
        <Route path="/settings/change-password" element={<ProtectedRoute><ChangePasswordSettingsPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
