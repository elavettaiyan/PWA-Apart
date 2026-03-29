import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import BrandMark from '../../components/ui/BrandMark';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export default function RegisterPage() {
  const legalBaseUrl = 'https://dwellhub.in';
  const [form, setForm] = useState({
    societyName: '',
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
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const passwordRequirements = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
      const { data } = await api.post('/auth/register-society', {
        ...form,
        pincode: trimmedPincode,
        phone: trimmedPhone,
      });
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome! ${data.society.name} has been created.`);
      navigate('/');
    } catch (error: any) {
      console.error('Registration error:', error);
      const data = error.response?.data;
      const message =
        data?.error ||
        (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg).join(', ') : null) ||
        (error.request ? 'Cannot reach the server. Please try again later.' : 'Registration failed');
      toast.error(message);
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
              <p className="text-[10px] text-outline font-bold uppercase tracking-widest">Register Apartment</p>
            </div>
          </div>

          <h2 className="editorial-title text-3xl font-extrabold text-primary mb-1">Create New Apartment</h2>
          <p className="text-sm text-on-surface-variant mb-8">
            Set up your apartment complex and get started with management
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Society Details */}
            <div className="p-4 bg-surface-container-low rounded-xl space-y-3">
              <p className="text-sm font-semibold text-on-surface-variant">Apartment / Society Details</p>
              <div>
                <label className="label">Apartment / Society Name *</label>
                <input
                  type="text"
                  name="societyName"
                  className="input"
                  placeholder="e.g., Green Valley Apartments"
                  value={form.societyName}
                  onChange={handleChange}
                  required
                />
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
            <div className="p-4 bg-blue-50 rounded-xl space-y-3">
              <p className="text-sm font-semibold text-blue-700">Admin Account</p>
              <div>
                <label className="label">Your Name *</label>
                <input
                  type="text"
                  name="adminName"
                  className="input"
                  placeholder="e.g., Rajesh Kumar"
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
                  placeholder="adminy_oursociety@gmail.com"
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
              {loading ? 'Creating your apartment...' : 'Register Apartment'}
            </button>
          </form>

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
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#171C3F] to-[#2A3060] items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-64 h-64 bg-tertiary-fixed/5 rounded-full blur-2xl"></div>
        <div className="relative z-10 text-center text-white max-w-md">
          <div className="w-20 h-20 bg-white/10 backdrop-blur rounded-3xl flex items-center justify-center mx-auto mb-8">
            <BrandMark size={48} />
          </div>
          <h2 className="editorial-title text-4xl font-extrabold mb-4 leading-tight">Your Apartment,<br/><em className="text-primary-fixed">Your Way.</em></h2>
          <p className="text-primary-fixed/60 leading-relaxed mb-8">
            Each apartment gets its own dedicated space. Register your society
            to start managing everything.
          </p>
          <div className="text-left bg-white/10 backdrop-blur rounded-2xl p-6 space-y-3">
            <p className="text-sm font-bold text-primary-fixed">What you get:</p>
            <ul className="text-sm text-primary-fixed/60 space-y-2">
              <li>✓ Separate dashboard for your apartment</li>
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
