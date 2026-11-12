'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRealtime } from './realtime-provider';
import { AuthModal } from './auth-modal';
import { isAdminRole } from '@/client/types';
import { Lock, ShieldAlert, ArrowRight, ArrowLeft } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { currentUser, loadingUser } = useRealtime();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  if (loadingUser) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="text-xs font-medium text-slate-500 animate-pulse">
          Verifying secure session...
        </div>
      </div>
    );
  }

  // 1. Unauthenticated Wall
  if (!currentUser) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 text-center space-y-5 shadow-lg">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <Lock className="w-7 h-7" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Authentication Required
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Please sign in to access Fetan P2P trading, view your orders, or manage your secure wallet.
            </p>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              onClick={() => setAuthModalOpen(true)}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              <span>Sign In with Email Code or Google</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <Link
              href="/"
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              Back to Home
            </Link>
          </div>

          <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
        </div>
      </div>
    );
  }

  // 2. Admin Role Requirement Check
  if (requireAdmin && !isAdminRole(currentUser.role)) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 p-6 sm:p-8 text-center space-y-5 shadow-lg">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Admin Access Required
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              This area is restricted to authorized administrators and Superadmin. Your current account role is{' '}
              <b className="text-slate-900 dark:text-white uppercase font-mono">{currentUser.role}</b>.
            </p>
          </div>

          <div className="space-y-2.5 pt-2">
            <Link
              href="/market"
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
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
