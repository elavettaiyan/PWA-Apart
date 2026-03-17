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
    <div className="min-h-screen flex bg-slate-950">
      <div className="hidden lg:flex flex-1 items-center justify-center p-12 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_32%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]">
        <div className="max-w-md text-white">
          <div className="w-16 h-16 rounded-2xl bg-cyan-400/15 border border-cyan-300/20 flex items-center justify-center mb-6">
            <Shield className="w-8 h-8 text-cyan-300" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Admin Portal</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Sign in with an admin account that already exists in the database. This portal only accepts ADMIN and SUPER_ADMIN roles.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center">
              <Shield className="w-6 h-6 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Resilynk Admin</h1>
              <p className="text-sm text-gray-500">Dedicated access for society admins</p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-gray-900 mb-1">Admin Sign In</h2>
          <p className="text-sm text-gray-500 mb-6">Use the admin email ID and password that were inserted into the database.</p>

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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full bg-slate-900 hover:bg-slate-800 focus:ring-slate-500">
              {loading ? 'Signing in...' : 'Open Admin Portal'}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credential source</p>
            <p className="mt-1 text-sm text-slate-700">
              Admin email IDs are expected to be created directly in the database, not from seeded demo values.
            </p>
          </div>

          <div className="mt-5 text-center">
            <Link to="/login" className="text-sm font-medium text-primary-600 hover:text-primary-700">
              Resident login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}