import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import type { AuthResponse } from '../../types';

export default function AdminLoginPage() {
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

      if (data.user.role !== 'SUPER_ADMIN' && data.user.role !== 'ADMIN') {
        toast.error('This portal is only for admin accounts.');
        return;
      }

      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome back, ${data.user.name}!`);
      navigate('/');
    } catch (error: any) {
      const data = error.response?.data;
      const message =
        data?.error ||
        (Array.isArray(data?.errors) ? data.errors.map((entry: any) => entry.msg).join(', ') : null) ||
        (error.request ? 'Cannot reach the server. Please try again later.' : 'Login failed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-primary">
      <div className="hidden lg:flex flex-1 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-64 h-64 bg-tertiary-fixed/5 rounded-full blur-2xl"></div>
        <div className="relative z-10 max-w-md text-white">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur border border-white/10 flex items-center justify-center mb-6">
            <Shield className="w-8 h-8 text-primary-fixed" />
          </div>
          <h1 className="editorial-title text-4xl font-extrabold tracking-tight">Admin Portal</h1>
          <p className="mt-4 text-sm leading-6 text-primary-fixed/60">
            Sign in with an admin account. This portal only accepts ADMIN and SUPER_ADMIN roles.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 bg-surface">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-fixed" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-primary font-headline tracking-tight">Dwell Hub</h1>
              <p className="text-[10px] text-outline font-bold uppercase tracking-widest">Admin Access</p>
            </div>
          </div>

          <h2 className="editorial-title text-3xl font-extrabold text-primary mb-1">Admin Sign In</h2>
          <p className="text-sm text-on-surface-variant mb-8">Use the admin email ID and password for your society.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Admin Email ID</label>
              <input
                type="email"
                className="input"
                placeholder="admin@yourdomain.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                  onChange={(event) => setPassword(event.target.value)}
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

            <button type="submit" disabled={loading} className="btn-gradient w-full py-3">
              {loading ? 'Signing in...' : 'Open Admin Portal'}
            </button>
          </form>

          <div className="mt-6 rounded-2xl bg-surface-container-low px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-outline">Credential source</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Admin accounts are created during society registration or by existing admins.
            </p>
          </div>

          <div className="mt-5 text-center">
            <Link to="/login" className="text-sm font-medium text-primary hover:text-primary">
              Resident login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}