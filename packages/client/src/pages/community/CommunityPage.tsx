import { useMemo } from 'react';
import { Megaphone, CalendarDays } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import AnnouncementsPage from '../announcements/AnnouncementsPage';
import EventsPage from '../events/EventsPage';

type CommunityTab = 'announcements' | 'events';

const COMMUNITY_TABS: Array<{ id: CommunityTab; label: string; icon: typeof Megaphone }> = [
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'events', label: 'Events', icon: CalendarDays },
];

function getCommunityTab(value: string | null): CommunityTab {
  return value === 'events' ? 'events' : 'announcements';
}

export default function CommunityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(() => getCommunityTab(searchParams.get('tab')), [searchParams]);

  return (
    <div className="space-y-5">
      {/* Compact header */}
      <div>
        <p className="section-label mb-1">Community</p>
        <h1 className="page-title">Community Hub</h1>
      </div>

      {/* Full-width segmented tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-container-lowest p-1 ghost-border">
        {COMMUNITY_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
              onClick={() => {
                const nextSearchParams = new URLSearchParams(searchParams);
                nextSearchParams.set('tab', tab.id);
                setSearchParams(nextSearchParams, { replace: true });
              }}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'announcements' ? <AnnouncementsPage embedded /> : <EventsPage embedded />}
    </div>
  );
}