import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import LoginPage from './pages/auth/LoginPage';
import AdminLoginPage from './pages/auth/AdminLoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import SelectSocietyPage from './pages/auth/SelectSocietyPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import CommunityPage from './pages/community/CommunityPage';
import FlatsPage from './pages/flats/FlatsPage';
import MyFlatPage from './pages/flats/MyFlatPage';
import BillingPage from './pages/billing/BillingPage';
import LateFeeAuditPage from './pages/billing/LateFeeAuditPage';
import PaymentStatusRedirect from './pages/billing/PaymentStatusRedirect';
import PaymentHistoryPage from './pages/billing/PaymentHistoryPage';
import PaymentReportPage from './pages/billing/PaymentReportPage';
import ComplaintsPage from './pages/complaints/ComplaintsPage';
import ExpensesPage from './pages/expenses/ExpensesPage';
import BylawsPage from './pages/bylaws/BylawsPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import ChangePasswordSettingsPage from './pages/settings/ChangePasswordSettingsPage';
import RegisterPage from './pages/auth/RegisterPage';
import StaffPage from './pages/staff/StaffPage';
import GateManagementPage from './pages/security/GateManagementPage';
import AssetsPage from './pages/assets/AssetsPage';
import CrmSocietiesPage from './pages/crm/CrmSocietiesPage';
import CrmSocietyDetailPage from './pages/crm/CrmSocietyDetailPage';
import { WebOnlyRestrictionPage } from './components/restrictions/WebOnlyRestriction';
import { getRouteRestriction, type RestrictedRoutePath } from './lib/appRestrictions';
import { getDefaultAuthenticatedRoute, getPostLoginRoute, isSecurityServiceStaff } from './lib/serviceStaff';
import { isNativePlatform } from './lib/platform';
import { SOCIETY_ADMINS, SOCIETY_MANAGERS, FINANCIAL_ROLES } from './types';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, accessToken, refreshToken } = useAuthStore();
  const hasValidSession = Boolean(isAuthenticated && user && accessToken && refreshToken);
  if (!hasValidSession) return <Navigate to="/login" replace />;
  // Force password change for users with mustChangePassword flag
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Layout>{children}</Layout>;
}

function RoleRoute({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { isAuthenticated, user, accessToken, refreshToken } = useAuthStore();
  const hasValidSession = Boolean(isAuthenticated && user && accessToken && refreshToken);
  if (!hasValidSession) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!roles.includes(user?.role || '')) return <Navigate to={getDefaultAuthenticatedRoute(user)} replace />;
  return <Layout>{children}</Layout>;
}

function SecurityServiceStaffRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, accessToken, refreshToken } = useAuthStore();
  const hasValidSession = Boolean(isAuthenticated && user && accessToken && refreshToken);
  if (!hasValidSession) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!isSecurityServiceStaff(user)) return <Navigate to={getDefaultAuthenticatedRoute(user)} replace />;
  return <Layout>{children}</Layout>;
}

function RestrictionAwareContent({
  path,
  children,
  fullScreen = false,
}: {
  path: RestrictedRoutePath;
  children: React.ReactNode;
  fullScreen?: boolean;
}) {
  const restriction = getRouteRestriction(path);

  if (restriction) {
    return <WebOnlyRestrictionPage restriction={restriction} fullScreen={fullScreen} />;
  }

  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, user, accessToken, refreshToken, _hydrated } = useAuthStore();
  const nativePlatform = isNativePlatform();
  const hasValidSession = Boolean(isAuthenticated && user && accessToken && refreshToken);

  // Only gate on _hydrated for native (Android/iOS) where Capacitor Preferences is async.
  // On web, localStorage is synchronous — no hydration wait needed.
  if (nativePlatform && !_hydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <Routes>
        <Route
          path="/login"
          element={hasValidSession ? <Navigate to={getPostLoginRoute(user)} replace /> : <LoginPage />}
        />
        <Route
          path="/admin/login"
          element={hasValidSession ? <Navigate to={getPostLoginRoute(user)} replace /> : <AdminLoginPage />}
        />
        <Route
          path="/register"
          element={
            hasValidSession ? <Navigate to={getPostLoginRoute(user)} replace /> :
            <RestrictionAwareContent path="/register" fullScreen><RegisterPage /></RestrictionAwareContent>
          }
        />
        <Route
          path="/forgot-password"
          element={hasValidSession ? <Navigate to={getPostLoginRoute(user)} replace /> : <ForgotPasswordPage />}
        />
        <Route
          path="/reset-password"
          element={hasValidSession ? <Navigate to={getPostLoginRoute(user)} replace /> : <ResetPasswordPage />}
        />
        <Route
          path="/change-password"
          element={
            !hasValidSession ? <Navigate to="/login" replace /> :
            !user?.mustChangePassword ? <Navigate to={getPostLoginRoute(user)} replace /> :
            <ChangePasswordPage />
          }
        />

        <Route
          path="/select-society"
          element={!hasValidSession ? <Navigate to="/login" replace /> : <SelectSocietyPage />}
        />

        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/community" element={<ProtectedRoute><CommunityPage /></ProtectedRoute>} />
        <Route path="/announcements" element={<Navigate to="/community?tab=inbox" replace />} />
        <Route path="/events" element={<Navigate to="/community?tab=inbox" replace />} />
        <Route path="/flats" element={<RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_MANAGERS]}><RestrictionAwareContent path="/flats"><FlatsPage /></RestrictionAwareContent></RoleRoute>} />
        <Route path="/my-flat" element={<ProtectedRoute><MyFlatPage /></ProtectedRoute>} />
        <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
        <Route path="/billing/late-fee-audit" element={<RoleRoute roles={['SUPER_ADMIN', ...FINANCIAL_ROLES]}><LateFeeAuditPage /></RoleRoute>} />
        <Route path="/payments/status" element={<PaymentStatusRedirect />} />
        <Route path="/payments/history" element={<ProtectedRoute><PaymentHistoryPage /></ProtectedRoute>} />
        <Route path="/payments/report" element={<RoleRoute roles={['SUPER_ADMIN', ...FINANCIAL_ROLES]}><PaymentReportPage /></RoleRoute>} />
        <Route path="/complaints" element={<ProtectedRoute><ComplaintsPage /></ProtectedRoute>} />
        <Route path="/expenses" element={<RoleRoute roles={['SUPER_ADMIN', ...FINANCIAL_ROLES]}><ExpensesPage /></RoleRoute>} />
        <Route path="/assets" element={<RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_MANAGERS]}><RestrictionAwareContent path="/assets"><AssetsPage /></RestrictionAwareContent></RoleRoute>} />
        <Route path="/bylaws" element={<ProtectedRoute><BylawsPage /></ProtectedRoute>} />
        <Route path="/reports" element={<RoleRoute roles={['SUPER_ADMIN', ...FINANCIAL_ROLES]}><ReportsPage /></RoleRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/staff" element={<RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_ADMINS]}><StaffPage /></RoleRoute>} />
        <Route path="/gate-management" element={user?.role === 'SERVICE_STAFF' ? <SecurityServiceStaffRoute><GateManagementPage /></SecurityServiceStaffRoute> : <RoleRoute roles={['SUPER_ADMIN', ...SOCIETY_MANAGERS]}><GateManagementPage /></RoleRoute>} />
        <Route path="/entry-activity" element={<Navigate to="/community?tab=inbox" replace />} />
        <Route path="/settings/change-password" element={<ProtectedRoute><ChangePasswordSettingsPage /></ProtectedRoute>} />
        <Route path="/crm" element={<RoleRoute roles={['SUPER_ADMIN']}><CrmSocietiesPage /></RoleRoute>} />
        <Route path="/crm/:id" element={<RoleRoute roles={['SUPER_ADMIN']}><CrmSocietyDetailPage /></RoleRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
