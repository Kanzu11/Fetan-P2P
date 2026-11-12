'use client';

import React, { useState } from 'react';
import { useRealtime } from './realtime-provider';
import { GoogleSignInButton } from './google-signin-button';
import {
  X,
  Mail,
  ShieldCheck,
  User as UserIcon,
  ArrowRight,
  KeyRound,
  RotateCcw,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { requestLoginOtp, verifyLoginOtp, loginWithGoogle, googleClientId, setNotification } =
    useRealtime();

  const [mode, setMode] = useState<'SIGNIN' | 'SIGNUP'>('SIGNIN');
  const [step, setStep] = useState<'EMAIL' | 'CODE'>('EMAIL');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setStep('EMAIL');
    setOtpCode('');
    setError(null);
    setInfoMsg(null);
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (mode === 'SIGNUP' && !name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    setLoading(true);
    setError(null);
    setInfoMsg(null);

    try {
      const res = await requestLoginOtp(email.trim());
      if (res.success) {
        setStep('CODE');
        setInfoMsg(
          res.message || `We sent a 6-digit verification code to ${email.trim()}.`
        );
      } else {
        setError(res.error || 'Could not send verification code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('Enter the 6-digit verification code from your email.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyLoginOtp(
        email.trim(),
        otpCode.trim(),
        mode === 'SIGNUP' ? name.trim() : undefined
      );
      if (res.success && res.user) {
        setNotification(`Welcome back, ${res.user.name}!`);
        resetForm();
        onClose();
      } else {
        setError(res.error || 'Invalid or expired code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleIdToken = async (idToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await loginWithGoogle(idToken);
      if (res.success && res.user) {
        setNotification(`Signed in with Google as ${res.user.name}!`);
        resetForm();
        onClose();
      } else {
        setError(res.error || 'Google authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">
                {mode === 'SIGNIN' ? 'Sign In to Fetan P2P' : 'Create Fetan P2P Account'}
              </h3>
              <p className="text-[11px] text-slate-400">Verified Email Code or Google OAuth</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Tabs: Sign In / Create Account */}
          <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('SIGNIN');
                setError(null);
              }}
              className={`py-2 rounded-lg transition-colors ${
                mode === 'SIGNIN'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('SIGNUP');
                setError(null);
              }}
              className={`py-2 rounded-lg transition-colors ${
                mode === 'SIGNUP'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Sign Up
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 font-medium">
              {error}
            </div>
          )}

          {infoMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-medium">
              {infoMsg}
            </div>
          )}

          <GoogleSignInButton
            clientId={googleClientId}
            onIdToken={handleGoogleIdToken}
            disabled={loading}
            variant="light"
          />

          <div className="relative flex items-center justify-center">
            <div className="border-t border-slate-200 dark:border-slate-800 w-full" />
            <span className="bg-white dark:bg-slate-950 px-3 text-[11px] text-slate-400 font-medium">
              OR VIA EMAIL CODE
            </span>
          </div>

          {step === 'EMAIL' ? (
            <form onSubmit={handleRequestCode} className="space-y-3.5">
              {mode === 'SIGNUP' && (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Full Legal Name (For Ethiopian Banks)
                  </label>
                  <div className="relative">
                    <UserIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Abebe Bikila"
                      required={mode === 'SIGNUP'}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
              >
                <span>{loading ? 'Sending Verification Code...' : 'Send 6-Digit Email Code'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Verification Code for {email}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('EMAIL');
                      setOtpCode('');
                      setError(null);
                      setInfoMsg(null);
                    }}
                    className="text-[11px] font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Change email</span>
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit code"
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-sm tracking-[0.25em] focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
                >
                  <span>{loading ? 'Verifying...' : 'Verify & Sign In'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleRequestCode}
                  className="px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  Resend
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
