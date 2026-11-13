import React from 'react';

interface FetanLogoProps {
  variant?: 'mark' | 'full';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: { box: 28, text: 'text-[15px]', badge: 'text-[9px] px-1.5 py-0.5' },
  md: { box: 34, text: 'text-[17px]', badge: 'text-[10px] px-1.5 py-0.5' },
  lg: { box: 42, text: 'text-xl', badge: 'text-[11px] px-2 py-0.5' },
};

export function FetanLogo({
  variant = 'full',
  size = 'md',
  className = '',
}: FetanLogoProps) {
  const dims = SIZE_MAP[size];

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={dims.box}
        height={dims.box}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-[0_2px_8px_rgba(0,135,81,0.22)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="fetan-bg" x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0E241C" />
            <stop offset="100%" stopColor="#06110D" />
          </linearGradient>
          <linearGradient id="fetan-emerald" x1="11" y1="18" x2="30" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="100%" stopColor="#008751" />
          </linearGradient>
          <linearGradient id="fetan-sheen" x1="20" y1="0" x2="20" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Continuous Apple-style squircle frame */}
        <rect x="1.5" y="1.5" width="37" height="37" rx="10.5" fill="url(#fetan-bg)" />
        <rect x="1.5" y="1.5" width="37" height="19" rx="10.5" fill="url(#fetan-sheen)" />
        <rect
          x="1.5"
          y="1.5"
          width="37"
          height="37"
          rx="10.5"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />

        {/* Upper forward wing (Swift F stroke) */}
        <path
          d="M11.5 11.5H28.5C29.3284 11.5 30 12.1716 30 13V13.6C30 14.9255 28.9255 16 27.6 16H16.2L11.5 20.5V11.5Z"
          fill="#FFFFFF"
        />

        {/* Interlocked lower settlement bar (Emerald P2P escrow arc) */}
        <path
          d="M11.5 22.8L16.2 18.5H24.6C25.9255 18.5 27 19.5745 27 20.9V21.2C27 22.415 26.015 23.4 24.8 23.4H16.2V28.5C16.2 29.0523 15.7523 29.5 15.2 29.5H12.5C11.9477 29.5 11.5 29.0523 11.5 28.5V22.8Z"
          fill="url(#fetan-emerald)"
        />

        {/* Gold settlement anchor node */}
        <circle cx="26.5" cy="27.2" r="2.6" fill="#F5C518" />
      </svg>

      {variant === 'full' && (
        <span className="inline-flex items-center gap-1.5 leading-none">
          <span className={`font-bold tracking-[-0.03em] text-brand-ink ${dims.text}`}>
            Fetan
          </span>
          <span
            className={`font-semibold tracking-[0.06em] uppercase rounded-full bg-brand-ink/[0.06] text-brand-ink/80 border border-brand-ink/10 leading-none ${dims.badge}`}
          >
            P2P
          </span>
        </span>
      )}
    </span>
  );
}

