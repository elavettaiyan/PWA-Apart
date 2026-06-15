// No type imports needed - this component is simple

interface IosUpgradeInfoProps {
  onClose: () => void;
}

export function IosUpgradeInfo({ onClose }: IosUpgradeInfoProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-warning/20 bg-warning-container px-4 py-4">
        <p className="text-sm font-semibold text-on-warning-container">Flat limit reached</p>
        <p className="mt-2 text-sm text-on-surface-variant">
          Your society has reached its current flat capacity. Subscription changes are not available in the iOS app.
        </p>
      </div>
      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
        If your account needs support for more flats, please manage your plan from the web app and then return to the iOS app.
      </div>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
