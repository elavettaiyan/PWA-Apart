import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export default function RegisterPage() {
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
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-primary-600 rounded-2xl flex items-center justify-center">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">ApartEase</h1>
              <p className="text-sm text-gray-500">Register Your Apartment</p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-gray-900 mb-1">Create a New Apartment</h2>
          <p className="text-sm text-gray-500 mb-6">
            Set up your apartment complex and get started with management
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Society Details */}
            <div className="p-4 bg-gray-50 rounded-xl space-y-3">
              <p className="text-sm font-semibold text-gray-700">Apartment / Society Details</p>
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
                  placeholder="e.g., 123, MG Road, Sector 15"
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
                    placeholder="Bangalore"
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
                    placeholder="Karnataka"
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
                    placeholder="560001"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Creating your apartment...' : 'Register Apartment'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Already have an account? Sign in
            </Link>
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  title="Enter a valid 10-digit Indian mobile number"
          </div>
        </div>
      </div>

      {/* Right: Decorative */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-primary-600 to-primary-800 items-center justify-center p-12">
        <div className="text-center text-white max-w-md">
          <Building2 className="w-20 h-20 mx-auto mb-6 opacity-90" />
          <h2 className="text-3xl font-bold mb-4">Your Apartment, Your Way</h2>
          <p className="text-primary-100 leading-relaxed mb-6">
            Each apartment complex gets its own dedicated space. Register your society
            to start managing maintenance, billing, complaints, and more.
          </p>
          <div className="text-left bg-white/10 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold">What you get:</p>
            <ul className="text-sm text-primary-100 space-y-2">
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
