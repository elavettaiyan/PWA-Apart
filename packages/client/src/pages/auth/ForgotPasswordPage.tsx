import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ArrowLeft, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetToken, setResetToken] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSent(true);
      // If the API returns a token (dev mode), show it
      if (data.resetToken) {
        setResetToken(data.resetToken);
      }
      toast.success('Reset instructions sent!');
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to send reset request';
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
              <h1 className="text-2xl font-bold text-gray-900">ApartEase</h1>
              <p className="text-sm text-gray-500">Apartment Management System</p>
            </div>
          </div>

          {!sent ? (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Forgot Password</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter your email and we'll generate a password reset link for you.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Check Your Email</h2>
              <p className="text-sm text-gray-500 mb-6">
                If an account with that email exists, a password reset link has been sent.
              </p>

              {resetToken && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-left">
                  <p className="text-xs text-amber-700 font-semibold mb-2">
                    ⚠️ Dev Mode — Copy this reset token:
                  </p>
                  <code className="text-xs text-amber-800 break-all block bg-amber-100 p-2 rounded">
                    {resetToken}
                  </code>
                  <button
                    className="mt-2 text-xs text-amber-700 underline"
                    onClick={() => {
                      navigator.clipboard.writeText(resetToken);
                      toast.success('Token copied!');
                    }}
                  >
                    Copy to clipboard
                  </button>
                  <Link
                    to={`/reset-password?token=${resetToken}`}
                    className="mt-2 block text-xs text-primary-600 underline font-medium"
                  >
                    Go to Reset Password page →
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-gray-500 hover:text-gray-700 font-medium inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Login
            </Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary-600 to-primary-800 items-center justify-center p-12">
        <div className="text-center text-white max-w-md">
          <Building2 className="w-20 h-20 mx-auto mb-6 opacity-90" />
          <h2 className="text-3xl font-bold mb-4">Don't Worry!</h2>
          <p className="text-primary-100 leading-relaxed">
            We'll help you reset your password and get back to managing your apartment complex.
          </p>
        </div>
      </div>
    </div>
  );
}
