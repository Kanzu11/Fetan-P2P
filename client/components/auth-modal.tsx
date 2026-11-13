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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-md p-4">
      <div className="liquid-glass-card rounded-[28px] max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="liquid-glass-dark p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-brand-buy-500/20 border border-brand-buy-400/30 flex items-center justify-center text-brand-buy-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">
                {mode === 'SIGNIN' ? 'Sign In to Fetan P2P' : 'Create Fetan P2P Account'}
              </h3>
              <p className="text-[11px] text-white/65">Verified Email Code or Google OAuth</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Tabs: Sign In / Create Account */}
          <div className="liquid-pill-track grid grid-cols-2 p-1 rounded-full font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('SIGNIN');
                setError(null);
              }}
              className={`py-2 rounded-full transition-all ${
                mode === 'SIGNIN'
                  ? 'bg-white text-brand-ink shadow-sm font-bold'
                  : 'text-brand-ink-soft hover:text-brand-ink'
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
              className={`py-2 rounded-full transition-all ${
                mode === 'SIGNUP'
                  ? 'bg-white text-brand-ink shadow-sm font-bold'
                  : 'text-brand-ink-soft hover:text-brand-ink'
              }`}
            >
              Sign Up
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 font-medium">
              {error}
            </div>
          )}

          {infoMsg && (
            <div className="p-3 rounded-2xl bg-brand-buy-50/90 border border-brand-buy-300/60 text-brand-buy-900 font-medium">
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
            <div className="border-t border-black/10 w-full" />
            <span className="px-3 text-[11px] text-brand-ink-soft font-medium whitespace-nowrap">
              OR VIA EMAIL CODE
            </span>
            <div className="border-t border-black/10 w-full" />
          </div>

          {step === 'EMAIL' ? (
            <form onSubmit={handleRequestCode} className="space-y-3.5">
              {mode === 'SIGNUP' && (
                <div>
                  <label className="block font-semibold text-brand-ink mb-1.5">
                    Full Legal Name (For Ethiopian Banks)
                  </label>
                  <div className="relative">
                    <UserIcon className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Abebe Bikila"
                      required={mode === 'SIGNUP'}
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-full bg-brand-ink hover:bg-neutral-800 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
              >
                <span>{loading ? 'Sending Verification Code...' : 'Send 6-Digit Email Code'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-brand-ink">
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
                    className="text-[11px] font-semibold text-brand-buy-700 hover:underline inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Change email</span>
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit code"
                    required
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/85 text-brand-ink font-mono text-sm tracking-[0.25em] focus:outline-none focus:border-brand-ink"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="flex-1 py-3 px-4 rounded-full bg-brand-buy-600 hover:bg-brand-buy-700 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
                >
                  <span>{loading ? 'Verifying...' : 'Verify & Sign In'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleRequestCode}
                  className="px-4 py-3 rounded-full border border-black/10 bg-white/75 text-brand-ink font-semibold hover:bg-white transition-colors"
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
