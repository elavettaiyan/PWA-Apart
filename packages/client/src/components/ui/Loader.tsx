import { Loader2 } from 'lucide-react';

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
        <p className="mt-3 text-xs text-[#8892a4] font-bold uppercase tracking-widest">Loading...</p>
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
      <div className="w-16 h-16 rounded-3xl bg-[#edf1f6] flex items-center justify-center mx-auto">
        <Icon className="w-8 h-8 text-[#8892a4]" />
      </div>
      <h3 className="mt-4 text-lg font-headline font-bold text-[#1a1f36]">{title}</h3>
      <p className="mt-1 text-sm text-[#5b6478] max-w-sm mx-auto">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
