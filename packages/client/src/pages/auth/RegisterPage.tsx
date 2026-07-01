import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft, Mail, ArrowRight } from 'lucide-react';
import BrandMark from '../../components/ui/BrandMark';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

type Step = 'form' | 'otp';

export default function RegisterPage() {
  const legalBaseUrl = 'https://dwellhub.in';
  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState({
    societyName: '',
    communityType: 'APARTMENT',
    address: '',
    city: '',
    state: '',
    pincode: '',
    adminName: '',
    email: '',
    password: '',
    phone: '',
  });
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const passwordRequirements = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedPincode = form.pincode.trim();
    const trimmedPhone = form.phone.trim();

    if (!/^\d{6}$/.test(trimmedPincode)) {
      toast.error('Pincode must be exactly 6 digits.');
      return;
    }
    if (!passwordRequirements.test(form.password)) {
      toast.error('Password must be at least 8 characters and include uppercase, lowercase, and a number.');
      return;
    }
    if (trimmedPhone && !/^[6-9]\d{9}$/.test(trimmedPhone)) {
      toast.error('Phone number must be a valid 10-digit Indian mobile number.');
      return;
    }
    if (!acceptedLegal) {
      toast.error('You must accept the Terms of Service and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/register-society/send-otp', {
        ...form,
        pincode: trimmedPincode,
        phone: trimmedPhone,
      });
      toast.success('Verification code sent to your email!');
      setStep('otp');
      setResendCooldown(60);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (error: any) {
      const data = error.response?.data;
      const message =
        data?.error ||
        (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg).join(', ') : null) ||
        (error.request ? 'Cannot reach the server. Please try again later.' : 'Failed to send OTP');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      toast.error('Please enter the 6-digit code.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/register-society/verify-otp', {
        email: form.email,
        otp: otpString,
      });
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome! ${data.society.name} has been created.`);
      navigate('/');
    } catch (error: any) {
      const data = error.response?.data;
      const message =
        data?.error ||
        (error.request ? 'Cannot reach the server. Please try again later.' : 'Verification failed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      await api.post('/auth/register-society/send-otp', {
        ...form,
        pincode: form.pincode.trim(),
        phone: form.phone.trim(),
      });
      toast.success('New code sent!');
      setResendCooldown(60);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.10),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_45%,_#f8fafc_100%)]">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center px-6 py-16 sm:px-8 lg:px-10">
        <div className="grid w-full gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.18)] sm:p-8 lg:p-10">
            <div className="flex items-center gap-3 mb-8">
              <BrandMark size={48} className="rounded-2xl" />
              <div>
                <h1 className="text-2xl font-extrabold text-primary font-headline tracking-tight">Dwell Hub</h1>
                <p className="text-[10px] text-[#4f46e5] font-bold uppercase tracking-widest">Register Community</p>
              </div>
            </div>

            <div className="mb-8">
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#4f46e5] font-label">
                Society onboarding
              </span>
              <h2 className="mt-4 text-3xl font-extrabold text-primary font-headline tracking-tight sm:text-4xl">Create your community workspace</h2>
              <p className="mt-2 text-sm text-on-surface-variant sm:text-base">
                Set up your society, verify your email, and start with billing, residents, complaints, visitors, and reports.
              </p>
            </div>

            {step === 'form' ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            {/* Society Details */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3 sm:p-5">
              <p className="text-sm font-semibold text-primary">Community Details</p>
              <div>
                <label className="label">Community Name *</label>
                <input
                  type="text"
                  name="societyName"
                  className="input"
                  placeholder="e.g., Green Valley Residences"
                  value={form.societyName}
                  onChange={handleChange}
                  required
                />
              </div>
              <div>
                <label className="label">Community Type</label>
                <select
                  name="communityType"
                  className="input"
                  value={form.communityType}
                  onChange={(e) => setForm((prev) => ({ ...prev, communityType: e.target.value }))}
                >
                  <option value="APARTMENT">Apartment / Society</option>
                  <option value="VILLA">Villa Community</option>
                  <option value="GATED_COMMUNITY">Gated Community</option>
                  <option value="TOWNSHIP">Township</option>
                </select>
              </div>
              <div>
                <label className="label">Address *</label>
                <input
                  type="text"
                  name="address"
                  className="input"
                  placeholder="e.g., 123, Mount Road, Chennai"
                  value={form.address}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">City *</label>
                  <input
                    type="text"
                    name="city"
                    className="input"
                    placeholder="Chennai"
                    value={form.city}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div>
                  <label className="label">State *</label>
                  <input
                    type="text"
                    name="state"
                    className="input"
                    placeholder="Tamil Nadu"
                    value={form.state}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div>
                  <label className="label">Pincode *</label>
                  <input
                    type="text"
                    name="pincode"
                    className="input"
                    placeholder="600001"
                    maxLength={6}
                    value={form.pincode}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Admin Account */}
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3 sm:p-5">
              <p className="text-sm font-semibold text-primary">Admin Account</p>
              <div>
                <label className="label">Your Name *</label>
                <input
                  type="text"
                  name="adminName"
                  className="input"
                  placeholder="e.g., Abishek Kumar"
                  value={form.adminName}
                  onChange={handleChange}
                  required
                />
              </div>
              <div>
                <label className="label">Email *</label>
                <input
                  type="email"
                  name="email"
                  className="input"
                  placeholder="admin@yoursociety.com"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
              </div>
              <div>
                <label className="label">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  className="input"
                  placeholder="9876543210"
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  title="Enter a valid 10-digit Indian mobile number"
                  value={form.phone}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="label">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    className="input pr-10"
                    placeholder="Min 8 chars, with Aa1"
                    value={form.password}
                    onChange={handleChange}
                    minLength={8}
                    pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
                    title="Password must be at least 8 characters and include uppercase, lowercase, and a number"
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
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-outline-variant/30 text-primary focus:ring-primary"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
              />
              <span className="text-sm text-on-surface-variant leading-6">
                I agree to the{' '}
                <a href={`${legalBaseUrl}/terms`} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:opacity-75 transition-opacity">
                  Terms of Service
                </a>{' '}
                and acknowledge the{' '}
                <a href={`${legalBaseUrl}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:opacity-75 transition-opacity">
                  Privacy Policy
                </a>
                . I also understand the{' '}
                <a href={`${legalBaseUrl}/refund-policy`} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:opacity-75 transition-opacity">
                  Refund Policy
                </a>
                .
              </span>
            </label>

            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-[#4f46e5] py-3 text-sm font-semibold text-white transition-all hover:bg-[#4338ca] hover:shadow-lg hover:shadow-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-70">
              {loading ? 'Sending verification code...' : (
                <span className="inline-flex items-center gap-2">Verify Email & Register <ArrowRight className="w-4 h-4" /></span>
              )}
            </button>
          </form>
          ) : (
            <>
              <button type="button" onClick={() => setStep('form')} className="inline-flex items-center gap-1 text-sm text-primary font-medium mb-6 hover:opacity-75">
                <ArrowLeft className="w-4 h-4" /> Back to form
              </button>

              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
                  <Mail className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="editorial-title text-2xl font-extrabold text-on-surface">Check your email</h2>
                  <p className="text-sm text-on-surface-variant">
                    We sent a 6-digit code to <span className="font-semibold text-on-surface">{form.email}</span>
                  </p>
                </div>
              </div>

              <form onSubmit={handleVerifyOtp} className="mt-8">
                <label className="label mb-3">Verification Code</label>
                <div className="flex gap-2 sm:gap-3 justify-center mb-6" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-bold rounded-2xl border-2 border-slate-200 bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                  ))}
                </div>

                <button type="submit" disabled={loading || otp.join('').length !== 6} className="mb-4 w-full rounded-2xl bg-[#4f46e5] py-3 text-sm font-semibold text-white transition-all hover:bg-[#4338ca] hover:shadow-lg hover:shadow-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-70">
                  {loading ? 'Verifying...' : 'Verify & Create Community'}
                </button>

                <div className="text-center">
                  <p className="text-sm text-on-surface-variant">
                    Didn't receive the code?{' '}
                    {resendCooldown > 0 ? (
                      <span className="text-outline">Resend in {resendCooldown}s</span>
                    ) : (
                      <button type="button" onClick={handleResendOtp} disabled={loading} className="text-primary font-medium hover:opacity-75">
                        Resend Code
                      </button>
                    )}
                  </p>
                </div>
              </form>
            </>
          )}

          <div className="mt-5 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Already have an account? Sign in
            </Link>
          </div>
        </div>

        <div className="hidden overflow-hidden rounded-[2rem] border border-indigo-100 bg-indigo-50/70 p-8 lg:block lg:p-10">
            <div className="relative h-full">
              <div className="absolute -top-16 right-0 h-56 w-56 rounded-full bg-indigo-200/35 blur-3xl" />
              <div className="absolute bottom-0 left-0 h-40 w-40 rounded-full bg-emerald-100/60 blur-3xl" />

              <div className="relative z-10 flex h-full flex-col gap-10">
                <div className="max-w-md">
                  <span className="inline-flex items-center rounded-full bg-white px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#4f46e5] shadow-sm">
                    Fast onboarding
                  </span>
                  <h2 className="mt-5 text-4xl font-extrabold leading-tight text-primary font-headline">
                    Launch your society workspace in minutes.
                  </h2>
                  <p className="mt-4 max-w-md text-base leading-7 text-on-surface-variant">
                    The same clean experience as the marketing site, but focused on getting your committee live quickly.
                  </p>
                </div>

                <div className="space-y-4 max-w-md">
                  <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#4f46e5] font-label">What you get</p>
                    <ul className="mt-3 space-y-2.5 text-sm text-on-surface-variant">
                      <li className="flex items-start gap-2.5"><span className="mt-0.5 text-emerald-500">•</span><span>Dedicated workspace for your community</span></li>
                      <li className="flex items-start gap-2.5"><span className="mt-0.5 text-emerald-500">•</span><span>Blocks, flats, owners, tenants, and staff</span></li>
                      <li className="flex items-start gap-2.5"><span className="mt-0.5 text-emerald-500">•</span><span>Billing, complaints, expenses, and AGM-ready reports</span></li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 font-label">Trial</p>
                      <p className="mt-2 text-2xl font-extrabold text-primary font-headline">30 days</p>
                      <p className="mt-1 text-xs text-on-surface-variant">Full product access</p>
                    </div>
                    <div className="rounded-2xl bg-[#4f46e5] p-5 shadow-sm">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-200 font-label">Pricing</p>
                      <p className="mt-2 text-2xl font-extrabold text-white font-headline">₹20 / flat</p>
                      <p className="mt-1 text-xs text-indigo-100">No lock-in</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
        </div>
        </div>
      </div>
    </div>
  );
}
