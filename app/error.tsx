'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { FetanLogo } from '@/client/components/fetan-logo';
import { RotateCcw, ShieldAlert } from 'lucide-react';

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Fetan UI boundary error:', error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="liquid-glass-card rounded-[28px] p-8 sm:p-10 max-w-md w-full text-center space-y-5">
        <div className="flex justify-center">
          <FetanLogo variant="full" size="md" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-brand-sell border border-rose-200 text-[11px] font-bold">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Temporary Session Error</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-extrabold tracking-tight text-brand-ink">
            Unable to Render View
          </h1>
          <p className="text-xs text-brand-ink-soft leading-relaxed">
            Your wallet balances and open escrows remain safely protected on-server. Refresh or retry below.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-brand-ink text-white text-xs font-bold hover:bg-neutral-800 transition-colors shadow-sm"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry View</span>
          </button>
          <Link
            href="/market"
            className="px-5 py-2.5 rounded-full border border-black/10 bg-white/80 text-brand-ink text-xs font-bold hover:bg-white transition-colors"
          >
            Go to Market
          </Link>
        </div>
      </div>
    </div>
  );
}
