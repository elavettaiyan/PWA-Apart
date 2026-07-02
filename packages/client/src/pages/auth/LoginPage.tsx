import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Smartphone } from 'lucide-react';
import BrandMark from '../../components/ui/BrandMark';
import toast from 'react-hot-toast';
import { getActionRestriction } from '../../lib/appRestrictions';
import { getPostLoginRoute } from '@/lib/serviceStaff';
import api from '../../lib/api';
import { getApiBaseUrl, getClientMedium, isNativePlatform } from '../../lib/platform';
import { useAuthStore } from '../../store/authStore';
import type { AuthResponse } from '../../types';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const registerCommunityRestriction = getActionRestriction('register-community');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    const clientMedium = getClientMedium();
    console.info('[login] submitting resident login', {
      email: normalizedEmail,
      apiBaseUrl: getApiBaseUrl(),
      nativePlatform: isNativePlatform(),
      clientMedium,
    });

    try {
      const { data } = await api.post<AuthResponse>('/auth/login', { email, password, clientMedium });
      const premiumLifecycleMessage = data.premiumLifecycle?.message;

      console.info('[login] resident login succeeded', {
        email: normalizedEmail,
        role: data.user.role,
        societyId: data.user.societyId,
      });

      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome back, ${data.user.name}!`);
      if (premiumLifecycleMessage) {
        toast((t) => (
          <div className="max-w-sm">
            <p className="font-semibold text-sm">Premium renewal notice</p>
            <p className="mt-1 text-sm">{premiumLifecycleMessage}</p>
          </div>
        ), { duration: 7000 });
      }
      navigate(getPostLoginRoute(data.user), { replace: true });
    } catch (error: any) {
      const data = error.response?.data;
      console.error('[login] resident login failed', {
        email: normalizedEmail,
        apiBaseUrl: getApiBaseUrl(),
        nativePlatform: isNativePlatform(),
        status: error.response?.status,
        code: data?.code,
        error: data?.error,
        validationErrors: Array.isArray(data?.errors) ? data.errors : undefined,
        axiosCode: error.code,
        hasRequest: !!error.request,
        hasResponse: !!error.response,
        message: error.message,
      });

      const message =
        data?.error ||
        (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg).join(', ') : null) ||
        (error.request ? 'Cannot reach the server. Please try again later.' : 'Login failed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen min-h-screen flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="auth-surface w-full max-w-md p-8 sm:p-10">
          <div className="auth-brand-lockup mb-10">
            <span className="auth-brand-frame">
              <BrandMark size={40} />
            </span>
            <div>
              <h1 className="auth-brand-wordmark">Dwell Hub</h1>
              <p className="auth-brand-caption">Resident Login</p>
            </div>
          </div>

          <h2 className="editorial-title text-3xl font-extrabold text-on-surface mb-1">Welcome back</h2>
          <p className="text-sm text-on-surface-variant mb-8">Sign in to manage your community</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary btn-lg w-full shadow-sm hover:shadow-card-hover"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-sm text-secondary hover:text-secondary/80 font-medium"
              >
                Forgot Password?
              </Link>
            </div>
          </form>
          <div className="mt-6 text-center">
            {!registerCommunityRestriction && (
              <Link
                to="/register"
                className="text-sm text-secondary hover:text-secondary/80 font-medium"
              >
                Register a new community →
              </Link>
            )}
          </div>

          {!isNativePlatform() && (
            <div className="mt-8 rounded-2xl border border-outline-variant/55 bg-surface-container-low p-4 lg:hidden">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-secondary-container/70 flex items-center justify-center shrink-0 mt-0.5">
                  <Smartphone className="w-4.5 h-4.5 text-secondary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">Get the mobile app</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">Faster access with push notifications and offline support.</p>
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    <a
                      href="https://play.google.com/store/apps/details?id=com.resilynk.mobile&pcampaignid=web_share"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814 13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92ZM14.852 13.06l2.29 2.29-11.678 6.57 9.388-8.86ZM20.166 10.834l-2.57 1.445-2.537-2.28 2.536-2.278 2.57 1.445a1.25 1.25 0 0 1 0 1.668ZM5.464 2.08l11.678 6.57-2.29 2.29L5.464 2.08Z"/></svg>
                      Google Play
                    </a>
                    <a
                      href="https://apps.apple.com/in/app/dwell-hub/id6764814825"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                      App Store
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Decorative Panel — vibrant blue gradient */}
      <div className="auth-hero-panel">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 h-96 w-96 rounded-full bg-secondary-container/15 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 h-64 w-64 rounded-full bg-white/5 blur-2xl"></div>
        <div className="absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-3xl"></div>
        <div className="relative z-10 w-full max-w-xl text-white">
          <span className="auth-hero-badge">Resident access</span>

          <h2 className="editorial-title mt-8 max-w-lg text-5xl font-extrabold leading-[1.05] text-white">
            Community management,
            <span className="mt-2 block text-primary-fixed">made clearer.</span>
          </h2>

          <p className="mt-6 max-w-lg text-base leading-7 text-white/74">
            Complete solution for billing, complaints, visitors, reports, and everyday society operations in one place.
          </p>

          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3 text-left">
            <div className="auth-hero-card px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Billing</p>
              <p className="mt-2 text-sm font-semibold text-white/90">Collections and dues</p>
            </div>
            <div className="auth-hero-card px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Visitors</p>
              <p className="mt-2 text-sm font-semibold text-white/90">Gate and entry flow</p>
            </div>
            <div className="auth-hero-card px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Reports</p>
              <p className="mt-2 text-sm font-semibold text-white/90">Board-ready visibility</p>
            </div>
          </div>

          {!isNativePlatform() && (
            <div className="mt-10 max-w-lg rounded-[1.85rem] border border-white/12 bg-white/10 p-6 text-left backdrop-blur-md shadow-[0_26px_70px_-34px_rgba(0,0,0,0.5)]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary-container/18 ring-1 ring-white/12">
                    <Smartphone className="h-5 w-5 text-primary-fixed" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">Mobile app</p>
                    <p className="mt-2 text-lg font-bold text-white">Keep Dwell Hub on your phone</p>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-white/72">
                      Faster access, push notifications, and smoother day-to-day society workflows.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-primary-fixed/16 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-fixed">
                  iOS + Android
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <a
                  href="https://play.google.com/store/apps/details?id=com.resilynk.mobile&pcampaignid=web_share"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-2xl bg-white px-4 py-3 text-primary shadow-[0_12px_30px_-22px_rgba(0,0,0,0.45)] transition-all hover:-translate-y-0.5 hover:bg-primary-fixed"
                >
                  <div className="flex items-center gap-2.5">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814 13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92ZM14.852 13.06l2.29 2.29-11.678 6.57 9.388-8.86ZM20.166 10.834l-2.57 1.445-2.537-2.28 2.536-2.278 2.57 1.445a1.25 1.25 0 0 1 0 1.668ZM5.464 2.08l11.678 6.57-2.29 2.29L5.464 2.08Z"/></svg>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/55">Download on</p>
                      <p className="text-sm font-bold text-primary">Google Play</p>
                    </div>
                  </div>
                </a>
                <a
                  href="https://apps.apple.com/in/app/dwell-hub/id6764814825"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-2xl bg-white px-4 py-3 text-primary shadow-[0_12px_30px_-22px_rgba(0,0,0,0.45)] transition-all hover:-translate-y-0.5 hover:bg-primary-fixed"
                >
                  <div className="flex items-center gap-2.5">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/55">Download on</p>
                      <p className="text-sm font-bold text-primary">App Store</p>
                    </div>
                  </div>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
