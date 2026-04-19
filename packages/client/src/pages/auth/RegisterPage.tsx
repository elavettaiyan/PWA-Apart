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
    <div className="min-h-screen flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 mb-10">
            <BrandMark size={48} className="rounded-2xl" />
            <div>
              <h1 className="text-2xl font-extrabold text-primary font-headline tracking-tight">Dwell Hub</h1>
              <p className="text-[10px] text-outline font-bold uppercase tracking-widest">Register Community</p>
            </div>
          </div>

          <h2 className="editorial-title text-3xl font-extrabold text-primary mb-1">Create New Community</h2>
          <p className="text-sm text-on-surface-variant mb-8">
            Set up your community and get started with management
          </p>

          {step === 'form' ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            {/* Society Details */}
            <div className="p-4 bg-surface-container-low rounded-xl space-y-3">
              <p className="text-sm font-semibold text-on-surface-variant">Community Details</p>
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
            <div className="p-4 bg-primary-container/40 rounded-xl space-y-3">
              <p className="text-sm font-semibold text-on-primary-container">Admin Account</p>
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

            <label className="flex items-start gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
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

            <button type="submit" disabled={loading} className="btn-gradient w-full py-3">
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
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
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
                      className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-bold rounded-xl border-2 border-outline-variant/30 bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                  ))}
                </div>

                <button type="submit" disabled={loading || otp.join('').length !== 6} className="btn-gradient w-full py-3 mb-4">
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

          <div className="mt-4 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Right: Editorial Decorative Panel */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary to-secondary items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-64 h-64 bg-tertiary-fixed/5 rounded-full blur-2xl"></div>
        <div className="relative z-10 text-center text-white max-w-md">
          <div className="w-20 h-20 bg-white/10 backdrop-blur rounded-3xl flex items-center justify-center mx-auto mb-8">
            <BrandMark size={48} />
          </div>
          <h2 className="editorial-title text-4xl font-extrabold mb-4 leading-tight">Your Community,<br/><em className="text-primary-fixed">Your Way.</em></h2>
          <p className="text-primary-fixed/60 leading-relaxed mb-8">
            Each community gets its own dedicated space. Register your society
            to start managing everything.
          </p>
          <div className="text-left bg-white/10 backdrop-blur rounded-2xl p-6 space-y-3">
            <p className="text-sm font-bold text-primary-fixed">What you get:</p>
            <ul className="text-sm text-primary-fixed/60 space-y-2">
              <li>✓ Separate dashboard for your community</li>
              <li>✓ Manage blocks, flats, owners & tenants</li>
              <li>✓ Monthly maintenance billing</li>
              <li>✓ Online payment collection (PhonePe)</li>
              <li>✓ Complaints & expense tracking</li>
              <li>✓ Financial reports</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
