import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import BrandMark from '../../components/ui/BrandMark';
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
    <div className="auth-screen min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="auth-surface w-full max-w-md p-8 sm:p-10">
          <div className="auth-brand-lockup mb-10">
            <span className="auth-brand-frame">
              <BrandMark size={40} />
            </span>
            <div>
              <h1 className="auth-brand-wordmark">Dwell Hub</h1>
              <p className="auth-brand-caption">Password Recovery</p>
            </div>
          </div>

          {!sent ? (
            <>
              <h2 className="editorial-title text-3xl font-extrabold text-primary mb-1">Forgot Password</h2>
              <p className="text-sm text-on-surface-variant mb-8">
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
                  className="btn-primary btn-lg w-full shadow-sm hover:shadow-card-hover"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div className="w-16 h-16 bg-secondary-container rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-secondary" />
              </div>
              <h2 className="text-xl font-semibold text-on-surface mb-2">Check Your Email</h2>
              <p className="text-sm text-on-surface-variant mb-6">
                If an account with that email exists, a password reset link has been sent.
              </p>

              {resetToken && (
                <div className="mb-6 p-4 bg-warning-container border border-warning/20 rounded-xl text-left">
                  <p className="text-xs text-warning font-semibold mb-2">
                    ⚠️ Dev Mode — Copy this reset token:
                  </p>
                  <code className="text-xs text-on-warning-container break-all block bg-amber-100 p-2 rounded">
                    {resetToken}
                  </code>
                  <button
                    className="mt-2 text-xs text-warning underline"
                    onClick={() => {
                      navigator.clipboard.writeText(resetToken);
                      toast.success('Token copied!');
                    }}
                  >
                    Copy to clipboard
                  </button>
                  <Link
                    to={`/reset-password?token=${resetToken}`}
                    className="mt-2 block text-xs text-primary underline font-medium"
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
              className="text-sm text-secondary hover:text-secondary/80 font-medium inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Login
            </Link>
          </div>
        </div>
      </div>

      <div className="auth-hero-panel">
        <div className="absolute top-20 -left-20 w-72 h-72 bg-secondary-container/15 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-56 h-56 bg-tertiary-fixed/12 rounded-full blur-2xl" />
        <div className="relative text-center text-white max-w-md">
          <div className="w-20 h-20 mx-auto mb-8 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/10">
            <BrandMark size={48} className="text-white" />
          </div>
          <span className="auth-hero-badge">Recovery flow</span>
          <h2 className="font-manrope text-4xl font-extrabold tracking-tight mb-3 mt-5">Don't <span className="italic text-primary-fixed">Worry</span></h2>
          <p className="text-white/70 text-sm leading-relaxed">
            We'll help you reset your password and get back to managing your community.
          </p>
        </div>
      </div>
    </div>
  );
}
