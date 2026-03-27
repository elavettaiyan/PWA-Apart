import { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export default function BrandMark({ size = 48, className = '' }: BrandMarkProps) {
  const uid = useId();
  const filterId = `bm-window-blur-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <rect x="0" y="0" width="512" height="512" rx="128" fill="#171C3F" />
      <rect x="124" y="248" width="70" height="143" rx="12" stroke="#FFFFFF" strokeWidth="20" />
      <rect x="318" y="178" width="85" height="216" rx="12" stroke="#FFFFFF" strokeWidth="20" />
      <rect x="183" y="100" width="163" height="293" rx="12" fill="#171C3F" stroke="#FFFFFF" strokeWidth="20" />
      <g filter={`url(#${filterId})`}>
        <rect x="218" y="143" width="85" height="25" rx="10" fill="#FFFFFF" />
        <rect x="218" y="199" width="85" height="25" rx="10" fill="#FFFFFF" />
        <rect x="218" y="252" width="85" height="25" rx="10" fill="#FFFFFF" />
        <rect x="218" y="307" width="85" height="25" rx="10" fill="#FFFFFF" />
      </g>
      <defs>
        <filter id={filterId} x="203" y="128" width="114" height="219" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
    </svg>
  );
}
