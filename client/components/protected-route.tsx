'use client';

import React from 'react';
import Link from 'next/link';
import { useRealtime } from './realtime-provider';
import { isAdminRole } from '@/client/types';
import { Lock, ShieldAlert, ArrowRight, ArrowLeft } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { currentUser, loadingUser, openAuthModal } = useRealtime();

  if (loadingUser) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="liquid-glass-card rounded-full px-5 py-2.5 text-xs font-medium text-brand-ink-soft flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-buy animate-pulse" />
          <span>Verifying secure session...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-[68vh] flex items-center justify-center p-4">
        <div className="liquid-glass-card max-w-md w-full rounded-[28px] p-7 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-brand-buy/10 border border-brand-buy/20 text-brand-buy flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-bold tracking-tight text-brand-ink">
              Sign In Required
            </h2>
            <p className="text-xs text-brand-ink-soft leading-relaxed">
              Sign in with Google or your 6-digit email verification code to access escrow trading, orders, and your wallet.
            </p>
          </div>

          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={() => openAuthModal()}
              className="w-full py-3 px-4 rounded-full bg-brand-ink hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              <span>Sign In with Google or Email</span>
              <ArrowRight className="w-3.5 h-3.5 text-brand-buy-400" />
            </button>

            <Link
              href="/"
              className="w-full py-2.5 px-4 rounded-full bg-white/75 border border-black/[0.08] hover:bg-white text-brand-ink-soft text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (requireAdmin && !isAdminRole(currentUser.role)) {
    return (
      <div className="min-h-[68vh] flex items-center justify-center p-4">
        <div className="liquid-glass-card max-w-md w-full rounded-[28px] p-7 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-brand-sell/10 border border-brand-sell/20 text-brand-sell flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-bold tracking-tight text-brand-ink">
              Admin Access Required
            </h2>
            <p className="text-xs text-brand-ink-soft leading-relaxed">
              This desk is restricted to platform administrators. Your current account role is{' '}
              <b className="text-brand-ink uppercase font-mono">{currentUser.role}</b>.
            </p>
          </div>

          <div className="pt-1">
            <Link
              href="/market"
              className="w-full py-2.5 px-4 rounded-full bg-white/75 border border-black/[0.08] hover:bg-white text-brand-ink text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to P2P Market</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
