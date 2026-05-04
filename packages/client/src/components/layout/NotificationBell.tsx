import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fetchNotifications, notificationInboxKeys } from '../../lib/notificationInbox';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../store/authStore';

export default function NotificationBell({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const activeSocietyId = user?.activeSocietyId || user?.societyId || undefined;

  useEffect(() => {
    setOpen(false);
  }, [location.key]);

  const { data: notifications = [] } = useQuery({
    queryKey: notificationInboxKeys.list(12, activeSocietyId),
    queryFn: () => fetchNotifications(12),
    enabled: !!user && open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'relative rounded-xl text-slate-400 transition-colors hover:bg-primary/5 hover:text-primary',
          compact ? 'p-2' : 'p-2',
        )}
        aria-label="Open notifications"
      >
        <Bell className="w-5 h-5" />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              'z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-elevated',
              compact
                ? 'fixed right-4 top-[calc(var(--sat)+3.75rem)]'
                : 'absolute right-0 mt-2',
            )}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-on-surface">Recent notifications</p>
                <p className="text-[11px] text-slate-400">Latest notifications for this society</p>
              </div>
            </div>

            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Bell className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-semibold text-on-surface">No notifications yet</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">New push messages will appear here as they are sent.</p>
              </div>
            ) : (
              <div className="max-h-[26rem] overflow-y-auto py-2">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate pr-2 text-sm font-semibold text-on-surface">{notification.title}</p>
                          <span className="whitespace-nowrap text-[11px] text-slate-400">
                            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-500">{notification.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}