'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRealtime } from '@/client/components/realtime-provider';
import { GoogleSignInButton } from '@/client/components/google-signin-button';
import { useI18n } from '@/client/i18n';
import type { MarketPriceStats } from '@/client/pricing';
import { PaymentMethod, PAYMENT_METHODS_META } from '@/client/types';
import {
  ShieldCheck,
  ArrowRight,
  Lock,
  UserCheck,
  ChevronDown,
  ArrowUpDown,
  Mail,
  Wallet,
  Scale,
  LifeBuoy,
  CheckCircle2,
} from 'lucide-react';
import { ApplyMerchantModal } from '@/client/components/apply-merchant-modal';
import { KycModal } from '@/client/components/kyc-modal';
import { TermsModal } from '@/client/components/terms-modal';
import { SupportModal } from '@/client/components/support-modal';

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
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [heroTab, setHeroTab] = useState<'LOGIN' | 'CALCULATOR'>('LOGIN');

  // Inline Email OTP Login State
  const [inlineEmail, setInlineEmail] = useState('');
  const [inlineOtpStep, setInlineOtpStep] = useState<'EMAIL' | 'CODE'>('EMAIL');
  const [inlineOtpCode, setInlineOtpCode] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);

  // Interactive Hero Calculator + Live DB Telemetry
  const [calcSide, setCalcSide] = useState<'BUY' | 'SELL'>('BUY');
  const [etbInput, setEtbInput] = useState<string>('15000');
  const [selectedRail, setSelectedRail] = useState<PaymentMethod>('TELEBIRR');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [liveStats, setLiveStats] = useState<MarketPriceStats | null>(null);

  useEffect(() => {
    fetch('/api/prices/live')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.stats) {
          setLiveStats(data.stats);
        }
      })
      .catch(() => {});
  }, []);

  const fallbackRef = Number(process.env.NEXT_PUBLIC_REFERENCE_ETB_PER_USDT || 158.45);
  const referenceRate = liveStats?.referencePriceEtb ?? fallbackRef;
  const unitRate =
    calcSide === 'BUY'
      ? liveStats?.bestBuyPriceEtb ?? referenceRate
      : liveStats?.bestSellPriceEtb ?? Number((referenceRate * 0.994).toFixed(2));
  const parsedEtb = parseFloat(etbInput) || 0;
  const calculatedUsdt = parsedEtb > 0 && unitRate > 0 ? parsedEtb / unitRate : 0;

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
        setNotification(`Welcome back, ${res.user.name}.`);
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
        setNotification(`Signed in with Google as ${res.user.name}.`);
      } else {
        setAuthError(res.error || 'Google Sign-In failed');
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setAuthLoading(false);
    }
  };

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
            q: 'በሌላ ሰው የባንክ ሂሳብ መክፈል እችላለሁ?',
            a: 'አይቻልም። ለደህንነት ሲባል ክፍያ የሚፈጽሙበት የቴሌብር ወይም የባንክ ሂሳብ ስም በFetan P2P ላይ ከተመዘገበው ስምዎ ጋር አንድ መሆን አለበት።',
          },
          {
            q: 'ነጋዴ (Merchant) ለመሆን ምን ያስፈልጋል?',
            a: 'መታወቂያዎን (ፋይዳ፣ ፓስፖርት ወይም መንጃ ፍቃድ) ያረጋግጡ እና በዋሌትዎ ውስጥ ቢያንስ 10 USDT ይኑርዎት።',
          },
        ]
      : [
          {
            q: 'What if I send Birr and the seller does not release USDT?',
            a: 'The seller’s USDT is locked inside pre-funded escrow as soon as you open the order. Upload your payment receipt in the trade room and raise an appeal—operations verifies your receipt and releases escrow directly to your wallet.',
          },
          {
            q: 'What should I put in the Telebirr or bank transfer remark?',
            a: 'Never write "USDT", "Crypto", or "P2P" in any bank or Telebirr note. Leave it blank or use "Personal".',
          },
          {
            q: 'Can I pay from a friend or family member’s account?',
            a: 'No. Your Telebirr or Ethiopian bank account holder name must match your KYC-verified Fetan P2P name.',
          },
          {
            q: 'How do I become a Merchant and post offers?',
            a: 'Complete Platform KYC (Fayda ID, Passport, or Driver’s License) and hold at least 10 USDT in your wallet, then submit the Merchant application.',
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

  const activeOffersTotal =
    (liveStats?.activeSellOffersCount ?? 0) + (liveStats?.activeBuyOffersCount ?? 0);

  return (
    <div className="space-y-8 pb-8">
      {/* 1. Asymmetric Liquid Glass Hero */}
      <section className="liquid-glass-card rounded-[28px] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left Column */}
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-11 flex flex-col justify-between gap-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-buy/10 border border-brand-buy/20 text-brand-buy text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t.heroBadge}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-[44px] font-bold tracking-[-0.03em] text-brand-ink leading-[1.08]">
                {t.heroTitle}
              </h1>

              <p className="text-sm sm:text-base text-brand-ink-soft leading-relaxed max-w-xl">
                {t.heroSub}
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-2.5">
                {currentUser ? (
                  <>
                    <Link
                      href="/market"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-ink hover:bg-black text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm"
                    >
                      <span>{t.btnStartTrading}</span>
                      <ArrowRight className="w-4 h-4 text-brand-buy-400" />
                    </Link>

                    <Link
                      href="/wallet"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/80 border border-black/[0.08] hover:bg-white text-brand-ink text-xs sm:text-sm font-semibold transition-colors"
                    >
                      <Wallet className="w-4 h-4 text-brand-buy" />
                      <span>Wallet</span>
                    </Link>

                    {currentUser.role === 'USER' && (
                      <button
                        type="button"
                        onClick={() => setMerchantModalOpen(true)}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/70 border border-black/[0.08] hover:bg-white text-brand-ink-soft text-xs sm:text-sm font-semibold transition-colors"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>{t.btnBecomeMerchant}</span>
                      </button>
                    )}

                    {latestActiveOrderId && (
                      <Link
                        href={`/trade/${latestActiveOrderId}`}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-brand-buy/10 border border-brand-buy/20 text-brand-buy text-xs sm:text-sm font-semibold hover:bg-brand-buy/15 transition-colors"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Active Order</span>
                      </Link>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openAuthModal()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-ink hover:bg-black text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm"
                    >
                      <span>Sign In / Create Account</span>
                      <ArrowRight className="w-4 h-4 text-brand-buy-400" />
                    </button>

                    <Link
                      href="/market"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/80 border border-black/[0.08] hover:bg-white text-brand-ink text-xs sm:text-sm font-semibold transition-colors"
                    >
                      <span>Browse P2P Orderbook</span>
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Live Database Telemetry Strip (Zero Fake Data) */}
            <div className="pt-5 border-t border-black/[0.06] grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[11px] font-medium text-brand-ink-soft">Best Buy (1 USDT)</div>
                <div className="text-sm sm:text-base font-bold font-mono text-brand-buy tabular-nums mt-0.5">
                  {liveStats ? `${liveStats.bestBuyPriceEtb.toFixed(2)} ETB` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-brand-ink-soft">Best Sell (1 USDT)</div>
                <div className="text-sm sm:text-base font-bold font-mono text-brand-ink tabular-nums mt-0.5">
                  {liveStats ? `${liveStats.bestSellPriceEtb.toFixed(2)} ETB` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-brand-ink-soft">Live Desk Ads</div>
                <div className="text-sm sm:text-base font-bold font-mono text-brand-ink tabular-nums mt-0.5">
                  {liveStats ? `${activeOffersTotal} offers` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-brand-ink-soft">24h Settled</div>
                <div className="text-sm sm:text-base font-bold font-mono text-brand-ink tabular-nums mt-0.5">
                  {liveStats ? `${liveStats.volume24hUsdt.toFixed(2)} USDT` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Dark Liquid Glass Focal Console */}
          <div className="lg:col-span-5 liquid-glass-dark text-white p-6 sm:p-8 flex flex-col justify-between">
            {!currentUser ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="inline-flex p-0.5 bg-white/[0.08] rounded-full text-xs font-semibold gap-0.5">
                    <button
                      type="button"
                      onClick={() => setHeroTab('LOGIN')}
                      className={`px-3.5 py-1.5 rounded-full transition-all ${
                        heroTab === 'LOGIN'
                          ? 'bg-white text-brand-ink shadow-sm'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => setHeroTab('CALCULATOR')}
                      className={`px-3.5 py-1.5 rounded-full transition-all ${
                        heroTab === 'CALCULATOR'
                          ? 'bg-white text-brand-ink shadow-sm'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      Quick Quote
                    </button>
                  </div>
                  <span className="text-[11px] font-mono text-brand-buy-400 tabular-nums">
                    1 USDT ≈ {unitRate.toFixed(2)} ETB
                  </span>
                </div>

                {heroTab === 'LOGIN' ? (
                  <div className="space-y-4 py-1">
                    <div className="space-y-1">
                      <h2 className="text-base font-semibold tracking-tight text-white">
                        Access your Fetan desk
                      </h2>
                      <p className="text-xs text-white/65 leading-relaxed">
                        Sign in with Google or a one-time 6-digit email verification code.
                      </p>
                    </div>

                    {authError && (
                      <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between">
                        <span>{authError}</span>
                        <button type="button" onClick={() => setAuthError(null)} className="ml-2 font-bold">
                          ✕
                        </button>
                      </div>
                    )}

                    {authInfo && (
                      <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-xs">
                        {authInfo}
                      </div>
                    )}

                    <GoogleSignInButton
                      clientId={googleClientId}
                      onIdToken={handleInlineGoogleToken}
                      disabled={authLoading}
                      variant="dark"
                    />

                    <div className="relative flex items-center justify-center">
                      <div className="border-t border-white/10 w-full" />
                      <span className="px-2.5 text-[10px] text-white/45 font-semibold uppercase tracking-wider bg-[#0b1813]">
                        or email code
                      </span>
                    </div>

                    {inlineOtpStep === 'EMAIL' ? (
                      <form onSubmit={handleInlineRequestOtp} className="space-y-2.5">
                        <input
                          type="email"
                          value={inlineEmail}
                          onChange={(e) => setInlineEmail(e.target.value)}
                          placeholder="name@example.com"
                          required
                          className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 text-xs focus:outline-none focus:border-brand-buy-400"
                        />
                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full py-2.5 px-4 rounded-full bg-brand-buy-500 hover:bg-brand-buy-400 text-brand-ink text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
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
                          placeholder="Enter 6-digit code"
                          required
                          className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 font-mono text-xs tracking-[0.22em] focus:outline-none focus:border-brand-buy-400"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={authLoading || inlineOtpCode.length !== 6}
                            className="flex-1 py-2.5 px-4 rounded-full bg-brand-buy-500 hover:bg-brand-buy-400 text-brand-ink text-xs font-semibold transition-colors disabled:opacity-50"
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
                            className="px-3.5 py-2.5 rounded-full bg-white/10 text-white/80 text-xs font-medium hover:bg-white/15"
                          >
                            Back
                          </button>
                        </div>
                      </form>
                    )}

                    <p className="text-[11px] text-white/45 text-center pt-1">
                      Protected by pre-funded escrow rules &amp; KYC verification.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleHeroQuoteSubmit} className="space-y-3.5">
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-white/[0.08] text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setCalcSide('BUY')}
                        className={`py-2 rounded-full transition-colors ${
                          calcSide === 'BUY'
                            ? 'bg-brand-buy-500 text-brand-ink'
                            : 'text-white/70 hover:text-white'
                        }`}
                      >
                        {lang === 'am' ? 'USDT ግዛ' : 'Buy USDT'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalcSide('SELL')}
                        className={`py-2 rounded-full transition-colors ${
                          calcSide === 'SELL'
                            ? 'bg-rose-500 text-white'
                            : 'text-white/70 hover:text-white'
                        }`}
                      >
                        {lang === 'am' ? 'USDT ሽጥ' : 'Sell USDT'}
                      </button>
                    </div>

                    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 space-y-1.5">
                      <div className="flex justify-between text-[11px] text-white/55">
                        <span>You {calcSide === 'BUY' ? 'pay' : 'receive'} (ETB)</span>
                        <span>300 – 850,000 ETB</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="number"
                          value={etbInput}
                          onChange={(e) => setEtbInput(e.target.value)}
                          placeholder="15000"
                          className="w-full bg-transparent text-xl font-bold font-mono text-white tabular-nums focus:outline-none"
                        />
                        <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-[11px] font-semibold text-white/80">
                          ETB
                        </span>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 space-y-1">
                      <div className="text-[11px] text-white/55">
                        Estimated {calcSide === 'BUY' ? 'Received' : 'Sold'} (0% fee)
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-bold font-mono text-brand-buy-400 tabular-nums">
                          {calculatedUsdt.toFixed(2)}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-brand-buy/20 text-[11px] font-semibold text-brand-buy-300">
                          USDT
                        </span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-3 px-4 rounded-full bg-white text-brand-ink hover:bg-white/90 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Explore Live Offers</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}
              </div>
            ) : (
              /* Signed-in Hero Quick Quote + Account Readiness */
              <form onSubmit={handleHeroQuoteSubmit} className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-brand-buy-400 shrink-0" />
                    <span className="text-xs font-semibold text-white truncate">
                      {currentUser.name}
                    </span>
                    {currentUser.kycStatus === 'VERIFIED' ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-buy/20 text-brand-buy-300 font-semibold">
                        Verified
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setKycModalOpen(true)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 font-semibold hover:bg-amber-500/30"
                      >
                        KYC: {currentUser.kycStatus}
                      </button>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-brand-buy-400 tabular-nums shrink-0">
                    1 USDT ≈ {unitRate.toFixed(2)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-white/[0.08] text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setCalcSide('BUY')}
                    className={`py-2 rounded-full transition-colors ${
                      calcSide === 'BUY'
                        ? 'bg-brand-buy-500 text-brand-ink'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {lang === 'am' ? 'USDT ግዛ' : 'Buy USDT'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcSide('SELL')}
                    className={`py-2 rounded-full transition-colors ${
                      calcSide === 'SELL'
                        ? 'bg-rose-500 text-white'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {lang === 'am' ? 'USDT ሽጥ' : 'Sell USDT'}
                  </button>
                </div>

                <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 space-y-2">
                  <div className="flex justify-between text-[11px] text-white/55">
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
                      className="w-full bg-transparent text-2xl font-bold font-mono text-white tabular-nums focus:outline-none"
                    />
                    <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-[11px] font-semibold text-white/80">
                      ETB
                    </span>
                  </div>
                  <div className="flex gap-1.5 pt-0.5">
                    {['2000', '10000', '25000', '100000'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEtbInput(preset)}
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                          etbInput === preset
                            ? 'bg-brand-buy/30 text-brand-buy-300 border border-brand-buy/40'
                            : 'bg-white/[0.07] text-white/70 hover:bg-white/15'
                        }`}
                      >
                        {Number(preset).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 space-y-1">
                  <div className="flex justify-between text-[11px] text-white/55">
                    <span>{calcSide === 'BUY' ? 'You receive (0% fee)' : 'You sell'}</span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-white/40" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold font-mono text-brand-buy-400 tabular-nums">
                      {calculatedUsdt.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-brand-buy/20 text-[11px] font-semibold text-brand-buy-300">
                      USDT
                    </span>
                  </div>
                </div>

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
                            ? 'bg-white text-brand-ink border-white font-semibold'
                            : 'bg-white/[0.06] text-white/75 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <span
                          className="w-1.5 h-3.5 rounded-full shrink-0"
                          style={{ backgroundColor: meta.accentColor }}
                        />
                        <span className="truncate">{meta.shortName}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="submit"
                  className={`w-full py-3 px-4 rounded-full font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors ${
                    calcSide === 'BUY'
                      ? 'bg-brand-buy-500 hover:bg-brand-buy-400 text-brand-ink'
                      : 'bg-rose-500 hover:bg-rose-400 text-white'
                  }`}
                >
                  <span>{calcSide === 'BUY' ? 'See Buy Offers' : 'See Sell Offers'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* 2. Supported Ethiopian Payment Rails */}
      <section className="liquid-glass-card rounded-[24px] p-5 sm:p-7 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-brand-ink tracking-tight">{t.railsTitle}</h2>
            <p className="text-xs text-brand-ink-soft mt-0.5">{t.railsSub}</p>
          </div>
          <Link
            href="/wallet"
            className="text-xs font-semibold text-brand-ink bg-white/80 hover:bg-white border border-black/[0.08] px-3.5 py-1.5 rounded-full self-start sm:self-auto transition-colors"
          >
            Manage Payout Accounts →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {featuredRails.map((railId) => {
            const meta = PAYMENT_METHODS_META[railId];
            return (
              <Link
                key={railId}
                href={`/market?method=${railId}`}
                className="group rounded-2xl bg-white/65 hover:bg-white border border-black/[0.06] p-4 transition-all flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-4 rounded-full"
                      style={{ backgroundColor: meta.accentColor }}
                    />
                    <span className="font-semibold text-brand-ink text-sm">
                      {lang === 'am' ? meta.nameAm : meta.name}
                    </span>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] text-brand-ink-soft">
                    {meta.settlementTime}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-brand-ink-soft pl-3.5">
                  <span className="truncate">{meta.channelHint}</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 3. How Escrow Works (Crisp 3-Column Strip) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-brand-ink tracking-tight">
              {t.whatIsEscrowTitle}
            </h2>
            <p className="text-xs sm:text-sm text-brand-ink-soft mt-0.5 max-w-2xl">
              {t.whatIsEscrowDesc}
            </p>
          </div>
          {latestActiveOrderId && (
            <Link
              href={`/trade/${latestActiveOrderId}`}
              className="text-xs font-semibold text-brand-buy hover:underline inline-flex items-center gap-1 shrink-0"
            >
              <span>{t.btnEscrowDemo}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <div className="liquid-glass-card rounded-[22px] p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-ink text-white font-mono text-[11px] font-bold">
                01
              </span>
              <h3 className="text-sm font-bold text-brand-ink">{t.step1Title}</h3>
              <p className="text-xs text-brand-ink-soft leading-relaxed">{t.step1Desc}</p>
            </div>
            <Link
              href="/market"
              className="text-xs font-semibold text-brand-ink hover:text-brand-buy inline-flex items-center gap-1"
            >
              <span>Open Market</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="liquid-glass-card rounded-[22px] p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-ink text-white font-mono text-[11px] font-bold">
                02
              </span>
              <h3 className="text-sm font-bold text-brand-ink">{t.step2Title}</h3>
              <p className="text-xs text-brand-ink-soft leading-relaxed">{t.step2Desc}</p>
            </div>
            {currentUser?.kycStatus === 'VERIFIED' ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-buy">
                <CheckCircle2 className="w-3.5 h-3.5" /> KYC Verified
              </span>
            ) : (
              <button
                type="button"
                onClick={() => (currentUser ? setKycModalOpen(true) : openAuthModal())}
                className="text-xs font-semibold text-brand-ink hover:text-brand-buy inline-flex items-center gap-1 self-start"
              >
                <span>{currentUser ? t.verifyId : 'Sign In to Verify ID'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="liquid-glass-card rounded-[22px] p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-buy text-white font-mono text-[11px] font-bold">
                03
              </span>
              <h3 className="text-sm font-bold text-brand-ink">{t.step3Title}</h3>
              <p className="text-xs text-brand-ink-soft leading-relaxed">{t.step3Desc}</p>
            </div>
            <Link
              href="/wallet"
              className="text-xs font-semibold text-brand-buy hover:underline inline-flex items-center gap-1"
            >
              <span>Open Wallet</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Safety Rules & FAQ */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 liquid-glass-dark rounded-[24px] text-white p-6 space-y-4">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-buy-400">
              Escrow Rules
            </span>
            <h3 className="text-lg font-bold tracking-tight">Trade Safely Every Time</h3>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="p-3.5 rounded-2xl bg-white/[0.06] border border-white/10 space-y-1">
              <div className="font-semibold text-white">1. Match Your Legal Name</div>
              <p className="text-white/65 leading-relaxed">
                Send or receive Birr strictly from a Telebirr or bank account in your verified name.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white/[0.06] border border-white/10 space-y-1">
              <div className="font-semibold text-white">2. Keep Payment Notes Neutral</div>
              <p className="text-white/65 leading-relaxed">
                Never write &ldquo;USDT&rdquo;, &ldquo;Crypto&rdquo;, or &ldquo;P2P&rdquo; in transfer notes.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white/[0.06] border border-white/10 space-y-1">
              <div className="font-semibold text-white">3. Verify Settled Balance First</div>
              <p className="text-white/65 leading-relaxed">
                Check your banking app balance directly before releasing escrowed USDT.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setTermsModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/85 hover:text-white underline underline-offset-4 pt-1"
          >
            <Scale className="w-3.5 h-3.5 text-brand-buy-400" />
            <span>Read Terms &amp; Escrow Agreement</span>
          </button>
        </div>

        <div className="lg:col-span-7 liquid-glass-card rounded-[24px] p-6 space-y-3">
          <h3 className="text-lg font-bold text-brand-ink tracking-tight">
            {lang === 'am' ? 'ተደጋጋሚ ጥያቄዎች' : 'Frequently Asked Questions'}
          </h3>

          <div className="divide-y divide-black/[0.06]">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="py-3 first:pt-1 last:pb-1">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between text-left gap-4 py-1 text-sm font-semibold text-brand-ink hover:text-brand-buy transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-brand-ink-soft shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-brand-buy' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-1.5 text-xs sm:text-sm text-brand-ink-soft leading-relaxed pr-6">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Minimalist Footer */}
      <footer className="border-t border-black/[0.07] pt-6 pb-2 text-xs text-brand-ink-soft flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-brand-ink">Fetan P2P</span>
          <span>•</span>
          <span>Ethiopia USDT Escrow</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-medium">
          <Link href="/market" className="hover:text-brand-ink transition-colors">
            P2P Market
          </Link>
          <Link href="/orders" className="hover:text-brand-ink transition-colors">
            Orders
          </Link>
          <Link href="/wallet" className="hover:text-brand-ink transition-colors">
            Wallet
          </Link>
          <button
            type="button"
            onClick={() => setSupportModalOpen(true)}
            className="hover:text-brand-ink inline-flex items-center gap-1 transition-colors"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Support</span>
          </button>
          <button
            type="button"
            onClick={() => setTermsModalOpen(true)}
            className="hover:text-brand-ink underline underline-offset-2 transition-colors"
          >
            Terms &amp; Escrow
          </button>
        </div>
      </footer>

      {/* Modals */}
      <ApplyMerchantModal isOpen={merchantModalOpen} onClose={() => setMerchantModalOpen(false)} />
      <KycModal isOpen={kycModalOpen} onClose={() => setKycModalOpen(false)} />
      <TermsModal isOpen={termsModalOpen} onClose={() => setTermsModalOpen(false)} />
      <SupportModal isOpen={supportModalOpen} onClose={() => setSupportModalOpen(false)} />
    </div>
  );
}
