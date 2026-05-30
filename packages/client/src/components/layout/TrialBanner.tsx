import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Zap } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import type { PremiumStatusResponse } from '../../types';
import { cn } from '../../lib/utils';

export default function TrialBanner() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const canSeeBanner = user?.role === 'ADMIN' || user?.role === 'SECRETARY';

  const { data: premiumStatus } = useQuery<PremiumStatusResponse>({
    queryKey: ['premium-status'],
    queryFn: async () => (await api.get('/premium/status')).data,
    enabled: canSeeBanner && !!user?.societyId,
    staleTime: 5 * 60 * 1000,
  });

  if (!canSeeBanner) return null;
  if (!premiumStatus) return null;
  if (premiumStatus.isPremium) return null;
  if (!premiumStatus.trial?.trialEndsAt) return null;
  if (premiumStatus.trial.isExpired) return null;

  const { daysRemaining, trialEndsAt } = premiumStatus.trial;
  const isUrgent = daysRemaining <= 7;
  const progress = Math.max(0, Math.min(100, ((30 - daysRemaining) / 30) * 100));
  const endDate = new Date(trialEndsAt!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div
      className={cn(
        'w-full px-4 py-2.5 flex items-center gap-3 text-sm',
        isUrgent
          ? 'bg-red-50 border-b border-red-100'
          : 'bg-amber-50 border-b border-amber-100',
      )}
    >
      <Clock className={cn('w-4 h-4 shrink-0', isUrgent ? 'text-red-500' : 'text-amber-500')} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('font-semibold', isUrgent ? 'text-red-700' : 'text-amber-800')}>
            {isUrgent
              ? `Trial ends in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}!`
              : `${daysRemaining} days left in your free trial`}
          </span>
          <span className={cn('text-xs hidden sm:inline', isUrgent ? 'text-red-500' : 'text-amber-600')}>
            · Expires {endDate} · Up to {premiumStatus.trial.flatLimit} flats included
          </span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-white/60 overflow-hidden w-full max-w-xs hidden sm:block">
          <div
            className={cn('h-full rounded-full transition-all', isUrgent ? 'bg-red-400' : 'bg-amber-400')}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <button
        onClick={() => navigate('/flats')}
        className={cn(
          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap',
          isUrgent
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-amber-500 text-white hover:bg-amber-600',
        )}
      >
        <Zap className="w-3 h-3" />
        Upgrade
      </button>
    </div>
  );
}
