import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { getDefaultAuthenticatedRoute } from '../../lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';

type SocietyChoice = {
  id: string;
  name: string;
  role?: string;
};

type SocietyResponse = {
  activeSocietyId?: string;
  societies: SocietyChoice[];
};

export default function SelectSocietyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, setTokens, setActiveSociety, setUser } = useAuthStore();

  const { data, isLoading } = useQuery<SocietyResponse>({
    queryKey: ['my-societies'],
    queryFn: async () => (await api.get('/auth/my-societies')).data,
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    if (!isLoading && (data?.societies.length || 0) <= 1) {
      navigate(getDefaultAuthenticatedRoute(user), { replace: true });
    }
  }, [data?.societies.length, isLoading, navigate, user]);

  const switchSocietyMutation = useMutation({
    mutationFn: async (societyId: string) => (await api.post('/auth/switch-society', { societyId })).data,
    onSuccess: (response, societyId) => {
      setTokens(response.accessToken, response.refreshToken);
      setActiveSociety(societyId);
      if (user) {
        setUser({
          ...user,
          ...(response.user || {}),
          societyId,
          activeSocietyId: societyId,
        });
      }
      queryClient.removeQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] !== 'my-societies',
      });
      toast.success(`Switched to ${response.user?.societyId ? data?.societies.find((society) => society.id === societyId)?.name || 'selected society' : 'selected society'}`);
      navigate(getDefaultAuthenticatedRoute({ ...user, ...(response.user || {}), societyId, activeSocietyId: societyId }), { replace: true });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to switch society');
    },
  });

  if (isLoading || !user) {
    return <PageLoader />;
  }

  const activeSocietyId = user.societyId || data?.activeSocietyId;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-surface shadow-sm border border-outline-variant/30 p-6 sm:p-8">
        <div className="mb-8">
          <p className="section-label mb-2">Choose Apartment</p>
          <h1 className="page-title">Select a society to continue</h1>
          <p className="text-sm text-on-surface-variant mt-2">
            This account is mapped to multiple apartments. Choose the society you want to work in for this session.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {data?.societies.map((society) => {
            const isActive = society.id === activeSocietyId;

            return (
              <button
                key={society.id}
                type="button"
                onClick={() => switchSocietyMutation.mutate(society.id)}
                disabled={switchSocietyMutation.isPending}
                className="text-left rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 hover:bg-surface-container transition-colors disabled:opacity-60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-on-surface">
                      <Building2 className="w-5 h-5 text-primary" />
                      <span className="font-semibold">{society.name}</span>
                    </div>
                    {society.role && (
                      <p className="mt-2 text-xs uppercase tracking-widest text-on-surface-variant">
                        Role in this society: {society.role.replace('_', ' ')}
                      </p>
                    )}
                  </div>
                  {isActive && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                </div>
                <p className="mt-4 text-sm text-on-surface-variant">
                  {isActive ? 'Currently selected. Tap to continue.' : 'Switch to this society and continue.'}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}