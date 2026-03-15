import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export default function ChangePasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
      toast.success('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      navigate('/');
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to change password';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <KeyRound className="w-6 h-6" /> Change Password
          </h1>
          <p className="text-sm text-gray-500 mt-1">Update your account password</p>
        </div>
      </div>

      <div className="max-w-md">
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Current Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Enter your current password"
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

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !allValid}
                className="btn-primary disabled:opacity-50"
              >
                {loading ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
