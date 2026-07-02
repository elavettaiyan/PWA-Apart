import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, ShieldAlert } from 'lucide-react';
import BrandMark from '../../components/ui/BrandMark';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getPostLoginRoute } from '../../lib/serviceStaff';
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
        const updatedUser = { ...user, mustChangePassword: false };
        setAuth(updatedUser, accessToken, refreshToken);
        toast.success('Password changed successfully!');
        navigate(getPostLoginRoute(updatedUser), { replace: true });
        return;
      }
      toast.success('Password changed successfully!');
      navigate('/', { replace: true });
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to change password';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="auth-surface w-full max-w-md p-8 sm:p-10">
          <div className="auth-brand-lockup mb-10">
            <span className="auth-brand-frame">
              <BrandMark size={40} />
            </span>
            <div>
              <h1 className="auth-brand-wordmark">Dwell Hub</h1>
              <p className="auth-brand-caption">Secure Account</p>
            </div>
          </div>

          <div className="mb-6 p-4 bg-warning-container border border-warning/20 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-on-warning-container">Password Change Required</p>
              <p className="text-xs text-warning mt-1">
                Your account was created by your society admin. Please set a new secure password to continue.
                Your current password is your registered phone number.
              </p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-on-surface mb-1">Change Password</h2>
          <p className="text-sm text-on-surface-variant mb-6">
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
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
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
            <div className="p-3 bg-surface-container-low rounded-xl space-y-1.5">
              <p className="text-xs font-semibold text-on-surface-variant mb-2">Password Requirements:</p>
              {[
                { check: passwordChecks.length, label: 'At least 8 characters' },
                { check: passwordChecks.uppercase, label: 'One uppercase letter' },
                { check: passwordChecks.lowercase, label: 'One lowercase letter' },
                { check: passwordChecks.number, label: 'One number' },
                { check: passwordChecks.match, label: 'Passwords match' },
                { check: passwordChecks.notSame, label: 'New password differs from current' },
              ].map(({ check, label }) => (
                <div key={label} className={`flex items-center gap-2 text-xs ${check ? 'text-secondary' : 'text-outline'}`}>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={loading || !allValid}
              className="btn-primary btn-lg w-full shadow-sm hover:shadow-card-hover disabled:opacity-50"
            >
              {loading ? 'Changing...' : 'Set New Password & Continue'}
            </button>
          </form>
        </div>
      </div>

      <div className="auth-hero-panel">
        <div className="absolute top-20 -left-20 w-72 h-72 bg-secondary-container/15 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-56 h-56 bg-tertiary-fixed/12 rounded-full blur-2xl" />
        <div className="relative text-center text-white max-w-md">
          <div className="w-20 h-20 mx-auto mb-8 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/10">
            <ShieldAlert className="w-10 h-10 text-white/90" />
          </div>
          <span className="auth-hero-badge">Security step</span>
          <h2 className="font-manrope text-4xl font-extrabold tracking-tight mb-3 mt-5">Stay <span className="italic text-primary-fixed">Secure</span></h2>
          <p className="text-white/70 text-sm leading-relaxed">
            Choose a strong password that only you know. This keeps your account safe.
          </p>
        </div>
      </div>
    </div>
  );
}
