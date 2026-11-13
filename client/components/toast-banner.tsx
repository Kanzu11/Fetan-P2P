'use client';

import React, { useEffect } from 'react';
import { useRealtime } from './realtime-provider';
import { CheckCircle2, X } from 'lucide-react';

export function ToastBanner() {
  const { notification, setNotification } = useRealtime();

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 5200);
    return () => clearTimeout(timer);
  }, [notification, setNotification]);

  if (!notification) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-20 right-4 sm:right-6 z-50 max-w-sm w-[calc(100vw-2rem)] pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="liquid-glass-nav rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-brand-ink">
        <span className="w-6 h-6 rounded-full bg-brand-buy/12 text-brand-buy flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 font-medium leading-snug text-brand-ink">{notification}</span>
        <button
          type="button"
          onClick={() => setNotification(null)}
          className="p-1 rounded-full text-brand-ink-soft hover:text-brand-ink hover:bg-black/5 transition-colors"
          aria-label="Dismiss notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

