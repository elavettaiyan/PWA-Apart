import { Loader2 } from 'lucide-react';

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
        <p className="mt-4 text-xs text-slate-400 font-semibold uppercase tracking-wider">Loading...</p>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
        <Icon className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="mt-5 text-lg font-headline font-bold text-on-surface">{title}</h3>
      <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
