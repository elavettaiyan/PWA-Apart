import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Eye, EyeOff, CheckCircle, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, setAuth, accessToken, refreshToken } = useAuthStore();

  const passwordChecks = {
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    match: newPassword === confirmPassword && newPassword.length > 0,
    notSame: currentPassword !== newPassword && newPassword.length > 0,
  };

  const allValid = Object.values(passwordChecks).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!allValid) {
      toast.error('Please meet all password requirements');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      // Update user in store to remove mustChangePassword flag
      if (user && accessToken && refreshToken) {
        setAuth({ ...user, mustChangePassword: false }, accessToken, refreshToken);
      }
      toast.success('Password changed successfully!');
      navigate('/');
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to change password';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-primary-600 rounded-2xl flex items-center justify-center">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Resilynk</h1>
              <p className="text-sm text-gray-500">Your Apartment, Connected</p>
            </div>
          </div>

          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Password Change Required</p>
              <p className="text-xs text-amber-700 mt-1">
                Your account was created by your society admin. Please set a new secure password to continue.
                Your current password is your registered phone number.
              </p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-gray-900 mb-1">Change Password</h2>
          <p className="text-sm text-gray-500 mb-6">
            Welcome, {user?.name}! Please choose a secure password.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Current Password (Your Phone Number)</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Enter your phone number"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
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

            <div>
              <label className="label">New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                className="input"
                placeholder="Choose a strong password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Confirm New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                className="input"
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {/* Password requirements */}
            <div className="p-3 bg-gray-50 rounded-xl space-y-1.5">
              <p className="text-xs font-semibold text-gray-600 mb-2">Password Requirements:</p>
              {[
                { check: passwordChecks.length, label: 'At least 8 characters' },
                { check: passwordChecks.uppercase, label: 'One uppercase letter' },
                { check: passwordChecks.lowercase, label: 'One lowercase letter' },
                { check: passwordChecks.number, label: 'One number' },
                { check: passwordChecks.match, label: 'Passwords match' },
                { check: passwordChecks.notSame, label: 'New password differs from current' },
              ].map(({ check, label }) => (
                <div key={label} className={`flex items-center gap-2 text-xs ${check ? 'text-emerald-600' : 'text-gray-400'}`}>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={loading || !allValid}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? 'Changing...' : 'Set New Password & Continue'}
            </button>
          </form>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary-600 to-primary-800 items-center justify-center p-12">
        <div className="text-center text-white max-w-md">
          <ShieldAlert className="w-20 h-20 mx-auto mb-6 opacity-90" />
          <h2 className="text-3xl font-bold mb-4">Secure Your Account</h2>
          <p className="text-primary-100 leading-relaxed">
            Choose a strong password that only you know. This keeps your apartment
            account and personal information safe.
          </p>
        </div>
      </div>
    </div>
  );
}
