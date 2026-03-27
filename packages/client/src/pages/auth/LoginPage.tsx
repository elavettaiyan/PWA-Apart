import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import BrandMark from '../../components/ui/BrandMark';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { isNativePlatform } from '../../lib/platform';
import { useAuthStore } from '../../store/authStore';
import type { AuthResponse } from '../../types';

export default function LoginPage() {
  const showRegistrationLink = !isNativePlatform();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
      const premiumLifecycleMessage = data.premiumLifecycle?.message;

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
      navigate('/', { replace: true });
    } catch (error: any) {
      const data = error.response?.data;
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
    <div className="min-h-screen flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <BrandMark size={48} className="rounded-2xl" />
            <div>
              <h1 className="text-2xl font-extrabold text-primary font-headline tracking-tight">Dwell Hub</h1>
              <p className="text-[10px] text-outline font-bold uppercase tracking-widest">Management Portal</p>
            </div>
          </div>

          <h2 className="editorial-title text-3xl font-extrabold text-primary mb-1">Welcome back</h2>
          <p className="text-sm text-on-surface-variant mb-8">Sign in to manage your apartment complex</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-gradient w-full py-3"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-sm text-primary hover:text-primary font-medium"
              >
                Forgot Password?
              </Link>
            </div>
          </form>
          {showRegistrationLink && (
            <div className="mt-4 text-center">
            {/* <Link
              to="/admin/login"
              className="block text-sm text-on-surface-variant hover:text-on-surface-variant font-medium mb-3"
            >
              Admin portal login
            </Link> */}
            <Link
              to="/register"
              className="text-sm text-primary hover:text-primary font-medium"
            >
              Register a new apartment complex →
            </Link>
            </div>
          )}
        </div>
      </div>

      {/* Right: Editorial Decorative Panel */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#171C3F] to-[#2A3060] items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-64 h-64 bg-tertiary-fixed/5 rounded-full blur-2xl"></div>
        <div className="relative z-10 text-center text-white max-w-md">
          <div className="w-20 h-20 bg-white/10 backdrop-blur rounded-3xl flex items-center justify-center mx-auto mb-8">
            <BrandMark size={48} />
          </div>
          <h2 className="editorial-title text-4xl font-extrabold mb-4 leading-tight">Apartment<br/>Management,<br/><em className="text-primary-fixed">Made Clearer.</em></h2>
          <p className="text-primary-fixed/60 leading-relaxed mt-6">
            Complete solution for apartment management — billing,
            complaints, expenses, and reports all in one place.
          </p>
        </div>
      </div>
    </div>
  );
}
