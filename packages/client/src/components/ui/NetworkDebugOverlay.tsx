import { useEffect, useMemo, useState } from 'react';

const enabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG_NETWORK === '1';

export default function NetworkDebugOverlay() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>(() => (typeof window !== 'undefined' ? window.__networkDebugLogs ?? [] : []));

  useEffect(() => {
    if (!enabled) return;

    const onLog = () => {
      setLogs([...(window.__networkDebugLogs ?? [])]);
    };

    window.addEventListener('network-debug-log', onLog as EventListener);
    return () => {
      window.removeEventListener('network-debug-log', onLog as EventListener);
    };
  }, []);

  const status = useMemo(() => {
    if (typeof navigator === 'undefined') return 'unknown';
    return navigator.onLine ? 'online' : 'offline';
  }, [logs.length]);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-4 right-4 z-[9999] rounded-full bg-black px-3 py-2 text-xs font-semibold text-white shadow-lg"
      >
        {open ? 'Hide Net Logs' : 'Show Net Logs'}
      </button>

      {open && (
        <div className="fixed inset-x-3 bottom-16 z-[9999] max-h-[45vh] overflow-auto rounded-xl border border-gray-700 bg-black/95 p-3 text-xs text-green-300 shadow-2xl">
          <div className="mb-2 flex items-center justify-between text-[11px] text-gray-300">
            <span>Network Debug Panel</span>
            <span>Status: {status}</span>
          </div>

          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                window.__networkDebugLogs = [];
                setLogs([]);
              }}
              className="rounded bg-gray-800 px-2 py-1 text-[11px] text-white"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                const text = (window.__networkDebugLogs ?? []).join('\n');
                navigator.clipboard?.writeText(text).catch(() => {
                  // Ignore clipboard failures on older devices/webviews.
                });
              }}
              className="rounded bg-gray-800 px-2 py-1 text-[11px] text-white"
            >
              Copy
            </button>
          </div>

          <pre className="whitespace-pre-wrap break-words">
            {logs.length ? logs.join('\n') : 'No logs yet. Trigger a login/network call and reopen this panel.'}
          </pre>
        </div>
      )}
    </>
  );
}
