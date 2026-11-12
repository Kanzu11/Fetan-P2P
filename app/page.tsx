'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRealtime } from '@/client/components/realtime-provider';
import { GoogleSignInButton } from '@/client/components/google-signin-button';
import { useI18n } from '@/client/i18n';
import { PaymentMethod, PAYMENT_METHODS_META } from '@/client/types';
import {
  ShieldCheck,
  ArrowRight,
  Lock,
  UserCheck,
  Check,
  Zap,
  ChevronDown,
  ArrowUpDown,
  AlertCircle,
  CheckCircle2,
  Mail,
  Wallet,
  Smartphone,
  ExternalLink,
  Sparkles,
  Camera,
  Scale,
} from 'lucide-react';
import { ApplyMerchantModal } from '@/client/components/apply-merchant-modal';
import { KycModal } from '@/client/components/kyc-modal';
import { TermsModal } from '@/client/components/terms-modal';

export default function LandingPage() {
  const router = useRouter();
  const {
    currentUser,
    latestActiveOrderId,
    openAuthModal,
    requestLoginOtp,
    verifyLoginOtp,
    loginWithGoogle,
    googleClientId,
    setNotification,
  } = useRealtime();
  const { lang, t } = useI18n();

  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [heroTab, setHeroTab] = useState<'LOGIN' | 'CALCULATOR'>('LOGIN');

  // Inline Email OTP Login State
  const [inlineEmail, setInlineEmail] = useState('');
  const [inlineOtpStep, setInlineOtpStep] = useState<'EMAIL' | 'CODE'>('EMAIL');
  const [inlineOtpCode, setInlineOtpCode] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);

  const handleInlineRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineEmail.trim()) {
      setAuthError('Please enter your email.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const res = await requestLoginOtp(inlineEmail.trim());
      if (res.success) {
        setInlineOtpStep('CODE');
        setAuthInfo(res.message || `6-digit code sent to ${inlineEmail.trim()}.`);
      } else {
        setAuthError(res.error || 'Could not send verification code');
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleInlineVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(inlineOtpCode.trim())) {
      setAuthError('Enter the 6-digit verification code sent to your email.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await verifyLoginOtp(inlineEmail.trim(), inlineOtpCode.trim());
      if (res.success && res.user) {
        setNotification(`Welcome to Fetan P2P, ${res.user.name}!`);
        setInlineEmail('');
        setInlineOtpCode('');
        setInlineOtpStep('EMAIL');
        setAuthInfo(null);
      } else {
        setAuthError(res.error || 'Invalid or expired code');
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleInlineGoogleToken = async (idToken: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await loginWithGoogle(idToken);
      if (res.success && res.user) {
        setNotification(`Signed in with Google as ${res.user.name}!`);
      } else {
        setAuthError(res.error || 'Google Sign-In failed');
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setAuthLoading(false);
    }
  };

  // Interactive Hero Calculator State
  const [calcSide, setCalcSide] = useState<'BUY' | 'SELL'>('BUY');
  const [etbInput, setEtbInput] = useState<string>('15000');
  const [selectedRail, setSelectedRail] = useState<PaymentMethod>('TELEBIRR');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [referenceRate, setReferenceRate] = useState<number>(
    Number(process.env.NEXT_PUBLIC_REFERENCE_ETB_PER_USDT || 158.35)
  );

  useEffect(() => {
    fetch('/api/prices/live')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.stats?.referencePriceEtb) {
          setReferenceRate(Number(data.stats.referencePriceEtb));
        }
      })
      .catch(() => {});
  }, []);

  const unitRate = calcSide === 'BUY' ? referenceRate : referenceRate * 0.994;
  const parsedEtb = parseFloat(etbInput) || 0;
  const calculatedUsdt = parsedEtb > 0 ? parsedEtb / unitRate : 0;

  const handleHeroQuoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams({
      side: calcSide,
      amount: etbInput || '',
      method: selectedRail,
    });
    router.push(`/market?${params.toString()}`);
  };

  const faqs =
    lang === 'am'
      ? [
          {
            q: 'ብር ከላክሁ በኋላ ሻጩ USDT ባይለቅስ ምን ይፈጠራል?',
            a: 'ትዕዛዝ ሲከፍቱ የሻጩ USDT ወዲያውኑ በፈጣን እስክሮው ተቆልፎ ይቀመጣል። የክፍያ ደረሰኝዎን አያይዘው "እገዛ / ቅሬታ" የሚለውን ሲጫኑ አድሚኑ ደረሰኙን አይቶ USDT በቀጥታ ወደ ዋሌትዎ ይለቃል።',
          },
          {
            q: 'በቴሌብር ወይም በባንክ ማስታወሻ (Remark) ላይ ምን መጻፍ አለብኝ?',
            a: 'በባንክ ወይም በቴሌብር ዝውውር ወቅት "USDT"፣ "Crypto" ወይም "P2P" የሚሉ ቃላትን አይጻፉ። ማስታወሻውን ባዶ ይተዉት ወይም የግል ክፍያ ብለው ይላኩ።',
          },
          {
            q: 'በሌላ ሰው (በቤተሰብ ወይም በጓደኛ) የባንክ ሂሳብ መክፈል እችላለሁ?',
            a: 'አይቻልም። ለደህንነት ሲባል ክፍያ የሚፈጽሙበት የቴሌብር ወይም የባንክ ሂሳብ ስም በFetan P2P ላይ ከተመዘገበው ስምዎ ጋር አንድ መሆን አለበት።',
          },
          {
            q: 'ነጋዴ (Merchant) ለመሆን ምን ያስፈልጋል?',
            a: 'መታወቂያዎን (ፋይዳ፣ ፓስፖርት ወይም መንጃ ፍቃድ) ያረጋግጡ እና በዋሌትዎ ውስጥ ቢያንስ 10 USDT ይኑርዎት። ከዚያ ያለምንም ክፍያ የመግዣ እና የመሸጫ ማስታወቂያ ማውጣት ይችላሉ።',
          },
        ]
      : [
          {
            q: 'What if I send the Birr and the seller does not release the USDT?',
            a: 'The seller’s USDT is locked by Fetan as soon as you open the order, so they cannot take it back. If the seller does not respond after you pay, tap "Need Help / Appeal" and share your payment receipt. Our admin team will check your receipt and release the USDT to your wallet.',
          },
          {
            q: 'What should I write in the Telebirr or bank payment note?',
            a: 'Do not write "USDT", "Crypto", or "P2P" in the payment note. Leave it blank or write "Personal".',
          },
          {
            q: 'Can I pay using a friend’s or family member’s bank account?',
            a: 'No. You must pay from a Telebirr or bank account with your own name matching your Fetan account.',
          },
          {
            q: 'How do I become a Merchant and post my own ads?',
            a: 'Verify your ID (Fayda ID, Passport, or Driver’s License) and keep at least 10 USDT in your Fetan wallet. Once approved, you can post Buy and Sell ads for free.',
          },
        ];

  const featuredRails: PaymentMethod[] = [
    'TELEBIRR',
    'CBE',
    'ABYSSINIA',
    'AWASH',
    'CBE_BIRR',
    'DASHEN',
  ];

  return (
    <div className="space-y-10 pb-10">
      {/* 1. Split Hero Section with Quick Calculator */}
      <section className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left Column: Value Proposition */}
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-buy border border-brand-line text-brand-buy font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-brand-buy" />
                <span>{t.heroBadge}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 leading-[1.15]">
                {t.heroTitle}
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
                {t.heroSub}
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-3">
                {currentUser ? (
                  <>
                    <Link
                      href="/market"
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
                    >
                      <span>{t.btnStartTrading}</span>
                      <ArrowRight className="w-4 h-4" />
                    </Link>

                    <Link
                      href="/wallet"
                      className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
                    >
                      <Wallet className="w-4 h-4 text-emerald-600" />
                      <span>My Wallet</span>
                    </Link>

                    {currentUser?.role === 'USER' && (
                      <button
                        onClick={() => setMerchantModalOpen(true)}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors"
                      >
                        <UserCheck className="w-4 h-4 text-slate-600" />
                        <span>{t.btnBecomeMerchant}</span>
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openAuthModal()}
                      disabled={authLoading}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white border border-slate-300 text-slate-800 text-sm font-bold hover:bg-slate-50 shadow-sm transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                      <span>Continue with Google</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openAuthModal()}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
                    >
                      <Mail className="w-4 h-4 text-emerald-400" />
                      <span>Sign In with Email</span>
                    </button>

                    <Link
                      href={latestActiveOrderId ? `/trade/${latestActiveOrderId}` : '/market'}
                      className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
                    >
                      <Lock className="w-4 h-4 text-emerald-600" />
                      <span>{t.btnEscrowDemo}</span>
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Trust Highlights Row */}
            <div className="pt-6 border-t border-slate-100 grid grid-cols-3 gap-4 text-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>Safe Escrow</span>
                </div>
                <p className="text-slate-500 text-[11px]">USDT is locked before you pay</p>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>Fast Release</span>
                </div>
                <p className="text-slate-500 text-[11px]">Pay with Telebirr or bank</p>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>Verified Users</span>
                </div>
                <p className="text-slate-500 text-[11px]">Checked with Fayda ID</p>
              </div>
            </div>
          </div>

          {/* Right Column: Instant Sign In / Quick Price Calculator */}
          <div className="lg:col-span-5 bg-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-800">
            {!currentUser ? (
              <div className="space-y-4">
                {/* Switcher Pill between Instant Sign In and Calculator */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex p-1 bg-slate-800 rounded-xl text-xs font-semibold gap-1">
                    <button
                      type="button"
                      onClick={() => setHeroTab('LOGIN')}
                      className={`px-3 py-1.5 rounded-lg transition-colors ${
                        heroTab === 'LOGIN'
                          ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Instant Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => setHeroTab('CALCULATOR')}
                      className={`px-3 py-1.5 rounded-lg transition-colors ${
                        heroTab === 'CALCULATOR'
                          ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Calculator
                    </button>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 tabular-nums">
                    1 USDT ≈ {unitRate.toFixed(2)} ETB
                  </span>
                </div>

                {heroTab === 'LOGIN' ? (
                  <div className="space-y-4 py-1">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <h3 className="text-base font-bold text-white">Sign In to Fetan P2P</h3>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Access escrow protection, buy/sell USDT with Ethiopian Birr, or manage your wallet.
                      </p>
                    </div>

                    {authError && (
                      <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
                        <span>{authError}</span>
                        <button onClick={() => setAuthError(null)} className="text-rose-400 font-bold ml-2">✕</button>
                      </div>
                    )}

                    {authInfo && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs">
                        {authInfo}
                      </div>
                    )}

                    {/* Google OAuth Button */}
                    <GoogleSignInButton
                      clientId={googleClientId}
                      onIdToken={handleInlineGoogleToken}
                      disabled={authLoading}
                      variant="dark"
                    />

                    <div className="relative flex items-center justify-center">
                      <div className="border-t border-slate-800 w-full" />
                      <span className="bg-slate-900 px-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                        or email code
                      </span>
                    </div>

                    {/* Email OTP Form */}
                    {inlineOtpStep === 'EMAIL' ? (
                      <form onSubmit={handleInlineRequestOtp} className="space-y-2.5">
                        <input
                          type="email"
                          value={inlineEmail}
                          onChange={(e) => setInlineEmail(e.target.value)}
                          placeholder="Enter your email address..."
                          required
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span>{authLoading ? 'Sending code...' : 'Send 6-Digit Email Code'}</span>
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleInlineVerifyOtp} className="space-y-2.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={inlineOtpCode}
                          onChange={(e) =>
                            setInlineOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                          placeholder="Enter 6-digit code..."
                          required
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-white placeholder-slate-500 font-mono text-xs tracking-[0.2em] focus:outline-none focus:border-emerald-500"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={authLoading || inlineOtpCode.length !== 6}
                            className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors disabled:opacity-50"
                          >
                            {authLoading ? 'Verifying...' : 'Verify & Sign In'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setInlineOtpStep('EMAIL');
                              setInlineOtpCode('');
                              setAuthInfo(null);
                            }}
                            className="px-3 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                          >
                            Back
                          </button>
                        </div>
                      </form>
                    )}

                    <p className="text-[11px] text-slate-500 text-center pt-1">
                      By continuing, you agree to the pre-funded escrow rules.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleHeroQuoteSubmit} className="space-y-4">
                    {/* Buy / Sell Switcher */}
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setCalcSide('BUY')}
                        className={`py-2 rounded-lg transition-colors ${
                          calcSide === 'BUY'
                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {lang === 'am' ? 'USDT ግዛ' : 'Buy USDT'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalcSide('SELL')}
                        className={`py-2 rounded-lg transition-colors ${
                          calcSide === 'SELL'
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {lang === 'am' ? 'USDT ሽጥ' : 'Sell USDT'}
                      </button>
                    </div>

                    {/* Birr Input Box */}
                    <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3 space-y-1.5">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>You {calcSide === 'BUY' ? 'pay' : 'receive'} (Birr)</span>
                        <span>300 – 850,000 ETB</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="number"
                          value={etbInput}
                          onChange={(e) => setEtbInput(e.target.value)}
                          placeholder="15000"
                          className="w-full bg-transparent text-xl font-bold text-white tabular-nums focus:outline-none"
                        />
                        <span className="px-2 py-0.5 rounded-lg bg-slate-700 text-xs font-bold text-slate-200">
                          ETB
                        </span>
                      </div>
                    </div>

                    {/* Calculated USDT Output */}
                    <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3 space-y-1">
                      <div className="text-[11px] text-slate-400">
                        Estimated {calcSide === 'BUY' ? 'Received' : 'Sold'} (0% fee)
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-bold text-emerald-400 tabular-nums">
                          {calculatedUsdt.toFixed(2)}
                        </span>
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-xs font-bold text-emerald-300">
                          USDT
                        </span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2"
                    >
                      <span>Explore Market Offers</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <form onSubmit={handleHeroQuoteSubmit} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Quick Calculator
                    </span>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full tabular-nums">
                    1 USDT ≈ {unitRate.toFixed(2)} ETB
                  </span>
                </div>

                {/* Buy / Sell Switcher */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setCalcSide('BUY')}
                    className={`py-2.5 rounded-lg transition-colors ${
                      calcSide === 'BUY'
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {lang === 'am' ? 'USDT ግዛ' : 'Buy USDT'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcSide('SELL')}
                    className={`py-2.5 rounded-lg transition-colors ${
                      calcSide === 'SELL'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {lang === 'am' ? 'USDT ሽጥ' : 'Sell USDT'}
                  </button>
                </div>

                {/* Birr Input Box */}
                <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3.5 space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>
                      {calcSide === 'BUY'
                        ? lang === 'am'
                          ? 'የሚከፍሉት ብር'
                          : 'You pay (Birr)'
                        : lang === 'am'
                        ? 'የሚቀበሉት ብር'
                        : 'You get (Birr)'}
                    </span>
                    <span>300 – 850,000 ETB</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="number"
                      value={etbInput}
                      onChange={(e) => setEtbInput(e.target.value)}
                      placeholder="15000"
                      className="w-full bg-transparent text-2xl font-bold text-white tabular-nums focus:outline-none"
                    />
                    <span className="px-2.5 py-1 rounded-lg bg-slate-700 text-xs font-bold text-slate-200 flex-shrink-0">
                      ETB
                    </span>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    {['2000', '10000', '25000', '100000'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEtbInput(preset)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                          etbInput === preset
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {Number(preset).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Calculated USDT Output */}
                <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3.5 space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>
                      {calcSide === 'BUY'
                        ? lang === 'am'
                          ? 'የሚቀበሉት USDT (0% ክፍያ)'
                          : 'You get (0% fee)'
                        : lang === 'am'
                        ? 'የሚሸጡት USDT'
                        : 'You sell'}
                    </span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold text-emerald-400 tabular-nums">
                      {calculatedUsdt.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-xs font-bold text-emerald-300">
                      USDT
                    </span>
                  </div>
                </div>

                {/* Payment Method Quick Picker */}
                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-400">
                    {lang === 'am' ? 'የክፍያ ዘዴ' : 'Payment Method'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {(['TELEBIRR', 'CBE', 'ABYSSINIA', 'AWASH'] as PaymentMethod[]).map((m) => {
                      const meta = PAYMENT_METHODS_META[m];
                      const active = selectedRail === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setSelectedRail(m)}
                          className={`px-3 py-2 rounded-xl border text-left flex items-center gap-2 transition-colors ${
                            active
                              ? 'bg-white text-slate-900 border-white font-semibold'
                              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          <span
                            className="w-1.5 h-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: meta.accentColor }}
                          />
                          <span className="truncate">{meta.shortName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm ${
                    calcSide === 'BUY'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                      : 'bg-rose-500 hover:bg-rose-400 text-white'
                  }`}
                >
                  <span>
                    {calcSide === 'BUY'
                      ? lang === 'am'
                        ? 'የመግዣ ዋጋዎችን ይመልከቱ'
                        : 'See Buy Offers'
                      : lang === 'am'
                      ? 'የመሸጫ ዋጋዎችን ይመልከቱ'
                      : 'See Sell Offers'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* 1.5. Interactive User Hub / Instant Google & Email Auth Section */}
      {currentUser ? (
        <section className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 border border-slate-800 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                  {currentUser.role}
                </span>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                    currentUser.kycStatus === 'VERIFIED'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : currentUser.kycStatus === 'PENDING'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }`}
                >
                  KYC: {currentUser.kycStatus}
                </span>
                {currentUser.merchantStatus === 'APPROVED' ? (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">
                    Certified Merchant
                  </span>
                ) : (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                    Regular Trader
                  </span>
                )}
              </div>

              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  Welcome back, <span className="text-emerald-400">{currentUser.name}</span>!
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Account: {currentUser.email} • Telegram: {currentUser.telegramHandle || 'Not linked'}
                </p>
              </div>

              {currentUser.kycStatus !== 'VERIFIED' && (
                <div className="inline-flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {currentUser.kycStatus === 'PENDING'
                      ? 'Your ID document is under admin review. You can trade once approved.'
                      : 'Complete Fayda / Passport verification to unlock full P2P trading.'}
                  </span>
                  {currentUser.kycStatus === 'UNVERIFIED' && (
                    <button
                      onClick={() => setKycModalOpen(true)}
                      className="ml-2 font-bold underline hover:text-white"
                    >
                      Verify Now →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Quick Balances & Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 min-w-[200px]">
                <div className="text-xs text-slate-400 font-medium">Available Balance</div>
                <div className="text-2xl font-bold text-white tabular-nums mt-0.5">
                  {currentUser.usdtBalance.toFixed(2)}{' '}
                  <span className="text-xs text-emerald-400 font-mono">USDT</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  ≈ {(currentUser.usdtBalance * referenceRate).toLocaleString()} ETB
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Link
                  href="/market"
                  className="py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <span>Go to P2P Market</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  href="/orders"
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <span>My Orders</span>
                </Link>
                <Link
                  href="/wallet"
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Wallet & Deposit</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>Zero Registration Fee • Instant Access</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Join Ethiopia&apos;s Most Trusted P2P Crypto Exchange
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-xl">
                Sign in with Google or enter your Email to start buying and selling USDT directly with
                Ethiopian Birr via Telebirr, CBE, Abyssinia, and Awash Bank. Protected by automated escrow.
              </p>
              <div className="pt-2 flex flex-wrap gap-4 text-xs text-slate-600 font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Automatic Escrow Release</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Encrypted Payment Proofs</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Telegram Bot (@fetanp2probot)</span>
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="space-y-1">
                <div className="font-bold text-slate-900 text-sm">Instant Sign In</div>
                <p className="text-xs text-slate-500">Sign in with Google or your email address</p>
              </div>

              {authError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
                  <span>{authError}</span>
                  <button onClick={() => setAuthError(null)} className="text-rose-500 font-bold ml-2">✕</button>
                </div>
              )}

              {authInfo && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                  {authInfo}
                </div>
              )}

              {/* 1. Google OAuth Button */}
              <GoogleSignInButton
                clientId={googleClientId}
                onIdToken={handleInlineGoogleToken}
                disabled={authLoading}
                variant="light"
              />

              <div className="relative flex items-center justify-center">
                <div className="border-t border-slate-200 w-full" />
                <span className="bg-slate-50 px-2 text-[11px] text-slate-400 font-medium uppercase">or email code</span>
              </div>

              {/* 2. Email OTP Form */}
              {inlineOtpStep === 'EMAIL' ? (
                <form onSubmit={handleInlineRequestOtp} className="space-y-2">
                  <input
                    type="email"
                    value={inlineEmail}
                    onChange={(e) => setInlineEmail(e.target.value)}
                    placeholder="Enter your email address..."
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-slate-900 bg-white"
                  />
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Mail className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{authLoading ? 'Sending Code...' : 'Send 6-Digit Email Code'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleInlineVerifyOtp} className="space-y-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={inlineOtpCode}
                    onChange={(e) =>
                      setInlineOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder="Enter 6-digit email code..."
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-xs tracking-[0.2em] focus:outline-none focus:border-slate-900 bg-white"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={authLoading || inlineOtpCode.length !== 6}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      {authLoading ? 'Verifying...' : 'Verify & Sign In'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInlineOtpStep('EMAIL');
                        setInlineOtpCode('');
                        setAuthInfo(null);
                      }}
                      className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100"
                    >
                      Back
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 1.7. Platform Safety, Escrow Standards & Terms of Service */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <h3 className="font-bold text-sm text-slate-900">Platform Safety &amp; Escrow Agreement</h3>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Every trade on Fetan P2P is governed by mandatory pre-funding escrow, verified Ethiopian legal identity
              matching, and strict anti-fraud payment remark regulations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTermsModalOpen(true)}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors whitespace-nowrap self-start md:self-auto shadow-sm"
          >
            Review Terms &amp; Conditions
          </button>
        </div>
      </section>

      {/* 2. Key Exchange Numbers */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricVol}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            642,850 <span className="text-xs text-slate-400 font-medium">USDT</span>
          </div>
          <div className="text-[11px] text-emerald-600 font-medium">Traded in the last 24 hours</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricPrice}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            158.35 <span className="text-xs text-slate-400 font-medium">ETB</span>
          </div>
          <div className="text-[11px] text-slate-500">Current market price</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricMerchants}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            48 <span className="text-xs text-emerald-600 font-semibold">Online</span>
          </div>
          <div className="text-[11px] text-slate-500">ID checked & verified</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-1 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t.metricSpeed}</div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">1–2 mins</div>
          <div className="text-[11px] text-slate-500">Usual time to get your USDT</div>
        </div>
      </section>

      {/* 3. How It Works (3 Simple Steps) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {t.whatIsEscrowTitle}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-3xl leading-relaxed">
              {t.whatIsEscrowDesc}
            </p>
          </div>
          <Link
            href={`/trade/${latestActiveOrderId}`}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 flex-shrink-0"
          >
            <span>{t.btnEscrowDemo}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Step 1 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  01
                </span>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Step 1
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{t.step1Title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.step1Desc}</p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <Link
                href="/market"
                className="text-xs font-semibold text-slate-900 hover:text-emerald-700 inline-flex items-center gap-1"
              >
                <span>Open P2P Market</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Step 2 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  02
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">
                  Step 2
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{t.step2Title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.step2Desc}</p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              {currentUser?.kycStatus === 'VERIFIED' ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <Check className="w-4 h-4" />
                  <span>{t.verified} Account</span>
                </span>
              ) : (
                <button
                  onClick={() => setKycModalOpen(true)}
                  className="text-xs font-semibold text-slate-900 hover:text-emerald-700 inline-flex items-center gap-1"
                >
                  <span>{t.verifyId}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white font-mono text-xs font-bold flex items-center justify-center">
                  03
                </span>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Step 3
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900">{t.step3Title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{t.step3Desc}</p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <Link
                href="/wallet"
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
              >
                <span>Open Wallet</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Supported Ethiopian Banks & Mobile Money */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              {t.railsTitle}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{t.railsSub}</p>
          </div>
          <Link
            href="/wallet"
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 border border-slate-200 px-3 py-1.5 rounded-lg self-start sm:self-auto"
          >
            Save Your Bank / Telebirr Numbers →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {featuredRails.map((railId) => {
            const meta = PAYMENT_METHODS_META[railId];
            return (
              <Link
                key={railId}
                href={`/market?method=${railId}`}
                className="group rounded-2xl border border-slate-200 p-4 hover:border-slate-300 hover:bg-slate-50 transition-colors flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1.5 h-4 rounded-full"
                        style={{ backgroundColor: meta.accentColor }}
                      />
                      <span className="font-bold text-slate-900 text-sm">
                        {lang === 'am' ? meta.nameAm : meta.name}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}`}
                    >
                      {meta.settlementTime}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 pl-3.5">{meta.channelHint}</p>
                </div>

                <div className="pl-3.5 flex items-center justify-between text-xs font-semibold text-slate-700 group-hover:text-emerald-700">
                  <span>See {meta.shortName} Ads</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 5. Simple Safety Rules & Common Questions */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-3xl bg-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <AlertCircle className="w-4 h-4" />
              <span>Simple Safety Rules</span>
            </span>
            <h3 className="text-xl font-bold tracking-tight">
              Three easy rules to keep every trade safe
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Follow these rules on every order to protect your money and your USDT.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-800 border border-slate-700 space-y-1">
              <div className="font-bold text-white">1. Only Use Accounts With Your Own Name</div>
              <p className="text-slate-300 leading-relaxed">
                Always send or receive Birr using a Telebirr or bank account that matches your name on Fetan.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800 border border-slate-700 space-y-1">
              <div className="font-bold text-white">2. Do Not Write &ldquo;Crypto&rdquo; in Payment Notes</div>
              <p className="text-slate-300 leading-relaxed">
                Never write &ldquo;USDT&rdquo;, &ldquo;Crypto&rdquo;, or &ldquo;P2P&rdquo; when sending money. Leave the note blank.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800 border border-slate-700 space-y-1">
              <div className="font-bold text-white">3. Check Your Balance Before Releasing USDT</div>
              <p className="text-slate-300 leading-relaxed">
                If you are selling USDT, always open your Telebirr or bank app and check that the Birr is in your balance before clicking &ldquo;Confirm Payment & Complete Order&rdquo;.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-4 shadow-sm">
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            {lang === 'am' ? 'ተደጋጋሚ ጥያቄዎች' : 'Common Questions'}
          </h3>

          <div className="divide-y divide-slate-200">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="py-3.5 first:pt-1 last:pb-1">
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between text-left gap-4 py-1 text-sm font-semibold text-slate-900 hover:text-emerald-700 transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-emerald-600' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed pr-6">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. Footer */}
      <footer className="border-t border-slate-200 pt-8 pb-4 text-xs text-slate-500 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <div className="font-bold text-slate-900">Fetan P2P • Ethiopia</div>
          <p className="text-slate-500">
            Buy and sell USDT with Ethiopian Birr safely with escrow protection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
          <Link href="/market" className="hover:text-slate-900">
            P2P Market
          </Link>
          <Link href="/orders" className="hover:text-slate-900">
            Orders
          </Link>
          <Link href="/wallet" className="hover:text-slate-900">
            Wallet
          </Link>
          <Link href={`/trade/${latestActiveOrderId}`} className="hover:text-slate-900">
            Active Order
          </Link>
          <button
            type="button"
            onClick={() => setTermsModalOpen(true)}
            className="hover:text-slate-900 underline text-slate-500"
          >
            Terms &amp; Escrow Agreement
          </button>
        </div>
      </footer>

      {/* Modals */}
      <ApplyMerchantModal isOpen={merchantModalOpen} onClose={() => setMerchantModalOpen(false)} />
      <KycModal isOpen={kycModalOpen} onClose={() => setKycModalOpen(false)} />
      <TermsModal isOpen={termsModalOpen} onClose={() => setTermsModalOpen(false)} />
    </div>
  );
}
