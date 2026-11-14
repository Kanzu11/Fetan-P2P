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
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const {
    loginWithPassword,
    signupWithPassword,
    verifySignupOtp,
    requestPasswordReset,
    resetPasswordWithOtp,
    loginWithGoogle,
    googleClientId,
    setNotification,
  } = useRealtime();

  const [mode, setMode] = useState<'SIGNIN' | 'SIGNUP' | 'FORGOT'>('SIGNIN');
  const [step, setStep] = useState<'EMAIL' | 'CODE'>('EMAIL');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setStep('EMAIL');
    setOtpCode('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setInfoMsg(null);
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    setInfoMsg(null);

    try {
      const res = await loginWithPassword(email.trim(), password);
      if (res.success && res.user) {
        setNotification(`Welcome back, ${res.user.name}!`);
        resetForm();
        onClose();
      } else if (res.requiresVerification) {
        setMode('SIGNUP');
        setStep('CODE');
        setInfoMsg(res.error || 'Enter the 6-digit verification code sent during signup.');
      } else {
        setError(res.error || 'Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignupRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);
    setInfoMsg(null);

    try {
      const res = await signupWithPassword(name.trim(), email.trim(), password);
      if (res.success) {
        setStep('CODE');
        setInfoMsg(
          res.message ||
            `We sent a 6-digit email verification code to ${email.trim()}.`
        );
      } else {
        setError(res.error || 'Could not start signup verification.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySignupCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('Enter the 6-digit verification code from your email.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifySignupOtp(email.trim(), otpCode.trim(), name.trim());
      if (res.success && res.user) {
        setNotification(`Email verified! Welcome to Fetan P2P, ${res.user.name}.`);
        resetForm();
        onClose();
      } else {
        setError(res.error || 'Invalid or expired verification code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your account email address.');
      return;
    }

    setLoading(true);
    setError(null);
    setInfoMsg(null);

    try {
      const res = await requestPasswordReset(email.trim());
      if (res.success) {
        setStep('CODE');
        setInfoMsg(
          res.message ||
            `If an account exists for ${email.trim()}, we sent a 6-digit password reset code.`
        );
      } else {
        setError(res.error || 'Could not send reset code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('Enter the 6-digit reset code from your email.');
      return;
    }
    if (password.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await resetPasswordWithOtp(email.trim(), otpCode.trim(), password);
      if (res.success && res.user) {
        setNotification(`Password updated! Signed in as ${res.user.name}.`);
        resetForm();
        setMode('SIGNIN');
        onClose();
      } else {
        setError(res.error || 'Failed to reset password.');
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
                {mode === 'SIGNIN'
                  ? 'Sign In to Fetan P2P'
                  : mode === 'SIGNUP'
                  ? 'Create Fetan P2P Account'
                  : 'Reset Your Password'}
              </h3>
              <p className="text-[11px] text-white/65">
                {mode === 'SIGNIN'
                  ? 'Email & Password or Google OAuth'
                  : mode === 'SIGNUP'
                  ? 'Password + First-Time Email OTP Verification'
                  : 'Verify 6-Digit Email Code to Set a New Password'}
              </p>
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
          {/* Tabs: Sign In / Sign Up */}
          {mode !== 'FORGOT' ? (
            <div className="liquid-pill-track grid grid-cols-2 p-1 rounded-full font-semibold">
              <button
                type="button"
                onClick={() => {
                  setMode('SIGNIN');
                  resetForm();
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
                  resetForm();
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
          ) : (
            <div className="flex items-center justify-between bg-black/[0.03] border border-black/[0.06] px-3.5 py-2 rounded-2xl">
              <span className="font-semibold text-brand-ink">Password Recovery</span>
              <button
                type="button"
                onClick={() => {
                  setMode('SIGNIN');
                  resetForm();
                }}
                className="text-[11px] font-semibold text-brand-buy-700 hover:underline inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Back to Sign In</span>
              </button>
            </div>
          )}

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

          {mode !== 'FORGOT' && step === 'EMAIL' && (
            <>
              <GoogleSignInButton
                clientId={googleClientId}
                onIdToken={handleGoogleIdToken}
                disabled={loading}
                variant="light"
              />

              <div className="relative flex items-center justify-center">
                <div className="border-t border-black/10 w-full" />
                <span className="px-3 text-[11px] text-brand-ink-soft font-medium whitespace-nowrap">
                  OR WITH EMAIL & PASSWORD
                </span>
                <div className="border-t border-black/10 w-full" />
              </div>
            </>
          )}

          {mode === 'SIGNIN' && (
            <form onSubmit={handlePasswordSignIn} className="space-y-3.5">
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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-brand-ink">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('FORGOT');
                      setStep('EMAIL');
                      setPassword('');
                      setConfirmPassword('');
                      setError(null);
                      setInfoMsg(null);
                    }}
                    className="text-[11px] font-semibold text-brand-buy-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="w-full pl-9 pr-10 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-2.5 text-brand-ink-soft hover:text-brand-ink"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-full bg-brand-ink hover:bg-neutral-800 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
              >
                <span>{loading ? 'Signing In...' : 'Sign In'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {mode === 'SIGNUP' && step === 'EMAIL' && (
            <form onSubmit={handleSignupRequestOtp} className="space-y-3.5">
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
                    required
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                </div>
              </div>

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

              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  Password (min 8 characters)
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    required
                    minLength={8}
                    className="w-full pl-9 pr-10 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-2.5 text-brand-ink-soft hover:text-brand-ink"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    minLength={8}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                </div>
              </div>

              <p className="text-[11px] text-brand-ink-soft leading-relaxed">
                First-time registration sends a 6-digit OTP to verify your email. After this, you sign in with your email and password only.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-full bg-brand-ink hover:bg-neutral-800 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
              >
                <span>{loading ? 'Sending Verification Code...' : 'Create Account & Verify Email'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {mode === 'SIGNUP' && step === 'CODE' && (
            <form onSubmit={handleVerifySignupCode} className="space-y-3.5">
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
                    <span>Edit details</span>
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
                  <span>{loading ? 'Verifying...' : 'Verify & Complete Signup'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSignupRequestOtp}
                  className="px-4 py-3 rounded-full border border-black/10 bg-white/75 text-brand-ink font-semibold hover:bg-white transition-colors"
                >
                  Resend
                </button>
              </div>
            </form>
          )}

          {mode === 'FORGOT' && step === 'EMAIL' && (
            <form onSubmit={handleForgotPasswordRequest} className="space-y-3.5">
              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  Account Email Address
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
                <span>{loading ? 'Sending Reset Code...' : 'Send Password Reset Code'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {mode === 'FORGOT' && step === 'CODE' && (
            <form onSubmit={handleResetPasswordSubmit} className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-brand-ink">
                    6-Digit Reset Code for {email}
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

              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  New Password (min 8 characters)
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    minLength={8}
                    className="w-full pl-9 pr-10 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-2.5 text-brand-ink-soft hover:text-brand-ink"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                    minLength={8}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="flex-1 py-3 px-4 rounded-full bg-brand-buy-600 hover:bg-brand-buy-700 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
                >
                  <span>{loading ? 'Updating Password...' : 'Reset Password & Sign In'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleForgotPasswordRequest}
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
