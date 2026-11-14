'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRealtime } from '@/client/components/realtime-provider';
import { useI18n } from '@/client/i18n';
import {
  P2POffer,
  PaymentMethod,
  OfferType,
  PAYMENT_METHODS_META,
  displayName,
  isAdminRole,
} from '@/client/types';
import {
  ShieldCheck,
  Plus,
  UserCheck,
  Clock,
  Zap,
  SlidersHorizontal,
  ArrowRight,
  X,
  CheckCircle2,
  AlertCircle,
  Search,
} from 'lucide-react';
import { CreateOfferModal } from '@/client/components/create-offer-modal';
import { ApplyMerchantModal } from '@/client/components/apply-merchant-modal';
import { KycModal } from '@/client/components/kyc-modal';
import { LivePriceTicker } from '@/client/components/live-price-ticker';
import { ProtectedRoute } from '@/client/components/protected-route';

function MarketContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, refreshUser, setNotification } = useRealtime();
  const { lang, t } = useI18n();

  // Mode: 'ORDERBOOK' | 'EXPRESS'
  const [marketMode, setMarketMode] = useState<'ORDERBOOK' | 'EXPRESS'>('ORDERBOOK');

  // 'SELL' offer = Merchant sells USDT -> User BUYS USDT
  // 'BUY' offer  = Merchant buys USDT  -> User SELLS USDT
  const [offerType, setOfferType] = useState<OfferType>('SELL');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('ALL');
  const [amountFilterEtb, setAmountFilterEtb] = useState<string>('');
  const [sortBy, setSortBy] = useState<'PRICE' | 'TRADES' | 'RATE'>('PRICE');

  const [offers, setOffers] = useState<P2POffer[]>([]);
  const [loading, setLoading] = useState(true);

  // Express Mode State
  const [expressEtb, setExpressEtb] = useState<string>('10000');
  const [expressMethod, setExpressMethod] = useState<PaymentMethod>('TELEBIRR');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);

  // Trade Initiation Drawer / Modal
  const [selectedOffer, setSelectedOffer] = useState<P2POffer | null>(null);
  const [tradeUsdtAmount, setTradeUsdtAmount] = useState<string>('50');
  const [tradeEtbInput, setTradeEtbInput] = useState<string>('');
  const [tradePaymentMethod, setTradePaymentMethod] = useState<PaymentMethod>('TELEBIRR');
  const [sellerAccountNumber, setSellerAccountNumber] = useState<string>('');
  const [initiatingTrade, setInitiatingTrade] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Sync URL query params on mount
  useEffect(() => {
    const sideParam = searchParams.get('side');
    const amountParam = searchParams.get('amount');
    const methodParam = searchParams.get('method');

    if (sideParam === 'SELL') {
      setOfferType('BUY'); // User selling USDT -> look at Merchant BUY ads
    } else if (sideParam === 'BUY') {
      setOfferType('SELL');
    }

    if (amountParam) {
      setAmountFilterEtb(amountParam);
      setExpressEtb(amountParam);
    }

    if (methodParam && methodParam in PAYMENT_METHODS_META) {
      setSelectedPaymentMethod(methodParam);
      setExpressMethod(methodParam as PaymentMethod);
    }
  }, [searchParams]);

  const fetchOffers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/offers');
      if (res.ok) {
        const data = await res.json();
        setOffers(data.offers || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();
  }, []);

  // Pre-fill seller's saved payout account number when selling USDT
  useEffect(() => {
    if (!currentUser || !tradePaymentMethod) return;
    const meta = PAYMENT_METHODS_META[tradePaymentMethod];
    const savedVal = meta && currentUser.paymentDetails?.[meta.accountField];
    setSellerAccountNumber(savedVal || currentUser.phone || '');
  }, [currentUser, tradePaymentMethod]);

  const filteredOffers = useMemo(() => {
    const list = offers.filter((offer) => {
      if (offer.offerType !== offerType) return false;
      if (offer.totalAvailable <= 0) return false;

      if (
        selectedPaymentMethod !== 'ALL' &&
        !offer.paymentMethods.includes(selectedPaymentMethod as PaymentMethod)
      ) {
        return false;
      }

      if (amountFilterEtb) {
        const amt = parseFloat(amountFilterEtb);
        if (!isNaN(amt) && amt > 0) {
          if (amt < offer.minLimitEtb || amt > offer.maxLimitEtb) return false;
        }
      }

      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'PRICE') {
        return offerType === 'SELL'
          ? a.pricePerUsdtEtb - b.pricePerUsdtEtb // Lowest price first when buying
          : b.pricePerUsdtEtb - a.pricePerUsdtEtb; // Highest price first when selling
      }
      if (sortBy === 'TRADES') return b.completedTrades - a.completedTrades;
      return b.completionRate - a.completionRate;
    });
  }, [offers, offerType, selectedPaymentMethod, amountFilterEtb, sortBy]);

  // Best matched offer for Express Mode
  const expressMatchedOffer = useMemo(() => {
    const amt = parseFloat(expressEtb) || 0;
    const candidates = offers.filter((o) => {
      if (o.offerType !== offerType) return false;
      if (o.merchantId === currentUser?.id) return false;
      if (!o.paymentMethods.includes(expressMethod)) return false;
      if (amt > 0 && (amt < o.minLimitEtb || amt > o.maxLimitEtb)) return false;
      const reqUsdt = amt / o.pricePerUsdtEtb;
      if (reqUsdt > o.totalAvailable) return false;
      return true;
    });

    if (candidates.length === 0) {
      const methodCandidates = offers.filter(
        (o) =>
          o.offerType === offerType &&
          o.merchantId !== currentUser?.id &&
          o.paymentMethods.includes(expressMethod)
      );
      return (
        methodCandidates[0] ||
        offers.find((o) => o.offerType === offerType && o.merchantId !== currentUser?.id) ||
        null
      );
    }

    return candidates.sort((a, b) =>
      offerType === 'SELL'
        ? a.pricePerUsdtEtb - b.pricePerUsdtEtb
        : b.pricePerUsdtEtb - a.pricePerUsdtEtb
    )[0];
  }, [offers, offerType, expressEtb, expressMethod, currentUser?.id]);

  const handleOpenTradeModal = (offer: P2POffer, prefillEtb?: string) => {
    setSelectedOffer(offer);
    const targetEtb = prefillEtb
      ? Math.max(
          offer.minLimitEtb,
          Math.min(offer.maxLimitEtb, parseFloat(prefillEtb) || offer.minLimitEtb)
        )
      : Math.max(offer.minLimitEtb, Math.min(offer.maxLimitEtb, 5000));

    const usdt = Number((targetEtb / offer.pricePerUsdtEtb).toFixed(2));
    setTradeUsdtAmount(usdt.toString());
    setTradeEtbInput(Math.round(usdt * offer.pricePerUsdtEtb).toString());
    const initialMethod =
      selectedPaymentMethod !== 'ALL' &&
      offer.paymentMethods.includes(selectedPaymentMethod as PaymentMethod)
        ? (selectedPaymentMethod as PaymentMethod)
        : offer.paymentMethods[0];
    setTradePaymentMethod(initialMethod);

    if (currentUser) {
      const meta = PAYMENT_METHODS_META[initialMethod];
      const savedVal = meta && currentUser.paymentDetails?.[meta.accountField];
      setSellerAccountNumber(savedVal || currentUser.phone || '');
    }

    setTradeError(null);
  };

  const handleUsdtChange = (val: string) => {
    setTradeUsdtAmount(val);
    if (selectedOffer) {
      const num = parseFloat(val);
      setTradeEtbInput(!isNaN(num) ? (num * selectedOffer.pricePerUsdtEtb).toFixed(2) : '');
    }
  };

  const handleEtbChange = (val: string) => {
    setTradeEtbInput(val);
    if (selectedOffer) {
      const num = parseFloat(val);
      setTradeUsdtAmount(!isNaN(num) ? (num / selectedOffer.pricePerUsdtEtb).toFixed(2) : '');
    }
  };

  const handleQuickFill = (fraction: 'MIN' | 'HALF' | 'MAX') => {
    if (!selectedOffer) return;
    if (fraction === 'MIN') {
      handleEtbChange(selectedOffer.minLimitEtb.toString());
      return;
    }

    let maxEtb = Math.min(
      selectedOffer.maxLimitEtb,
      selectedOffer.totalAvailable * selectedOffer.pricePerUsdtEtb
    );

    // If user is selling USDT, cap by their available wallet balance
    if (selectedOffer.offerType === 'BUY' && currentUser) {
      maxEtb = Math.min(maxEtb, currentUser.usdtBalance * selectedOffer.pricePerUsdtEtb);
    }

    if (fraction === 'HALF') {
      const half = Math.max(selectedOffer.minLimitEtb, Math.floor(maxEtb / 2));
      handleEtbChange(half.toString());
    } else {
      handleEtbChange(Math.floor(maxEtb).toString());
    }
  };

  const calculatedEtb = useMemo(() => {
    if (!selectedOffer || !tradeUsdtAmount) return 0;
    const num = parseFloat(tradeUsdtAmount);
    return isNaN(num) ? 0 : num * selectedOffer.pricePerUsdtEtb;
  }, [selectedOffer, tradeUsdtAmount]);

  const handleConfirmTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOffer || !currentUser) return;

    // Mandatory KYC check for regular users (Admins/Superadmins are auto-verified)
    if (currentUser.kycStatus !== 'VERIFIED' && !isAdminRole(currentUser.role)) {
      setTradeError(
        'Identity verification (KYC) is required for all users before buying or selling USDT. Click "Verify ID Now" below.'
      );
      return;
    }

    // If user is selling USDT, ensure they entered an account number where buyer can pay them
    if (selectedOffer.offerType === 'BUY' && !sellerAccountNumber.trim()) {
      setTradeError(
        `Please enter your ${PAYMENT_METHODS_META[tradePaymentMethod]?.accountLabel || 'account number'} so the buyer can send you Birr.`
      );
      return;
    }

    setInitiatingTrade(true);
    setTradeError(null);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: selectedOffer.id,
          buyerId: currentUser.id,
          usdtAmount: Number(tradeUsdtAmount),
          paymentMethod: tradePaymentMethod,
          sellerAccountNumber:
            selectedOffer.offerType === 'BUY' ? sellerAccountNumber.trim() : undefined,
          sellerAccountName:
            selectedOffer.offerType === 'BUY' ? displayName(currentUser.name) : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start order');

      await refreshUser();
      setNotification(`Order #${data.order.id} started! USDT is locked in escrow.`);
      router.push(`/trade/${data.order.id}`);
    } catch (err: unknown) {
      setTradeError(err instanceof Error ? err.message : 'Could not start order');
      setInitiatingTrade(false);
    }
  };

  const isMerchant =
    currentUser?.role === 'MERCHANT' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.role === 'SUPERADMIN';

  const paymentFilterOptions: ('ALL' | PaymentMethod)[] = [
    'ALL',
    'TELEBIRR',
    'CBE',
    'ABYSSINIA',
    'AWASH',
    'CBE_BIRR',
    'DASHEN',
  ];

  const isUserBuying = offerType === 'SELL';

  return (
    <div className="space-y-6 pb-8">
      {/* Mandatory KYC Banner for Unverified / Pending Users (hidden for Admins) */}
      {currentUser && currentUser.kycStatus !== 'VERIFIED' && !isAdminRole(currentUser.role) && (
        <div className="liquid-glass-card rounded-[24px] border-amber-300/70 bg-amber-50/75 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-amber-700" />
            </div>
            <div>
              <div className="text-xs sm:text-sm font-bold text-amber-950">
                {currentUser.kycStatus === 'PENDING'
                  ? 'Identity Verification (KYC) in Review'
                  : 'Identity Verification (KYC) Required'}
              </div>
              <p className="text-xs text-amber-900/90 mt-0.5">
                {currentUser.kycStatus === 'PENDING'
                  ? 'Our compliance team has been notified via Telegram and email. Once approved, trading unlocks immediately.'
                  : 'Complete a one-time ID verification here or via @fetanp2probot before buying or selling USDT.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setKycModalOpen(true)}
              className="px-4 py-2 rounded-full bg-brand-ink hover:bg-neutral-800 text-white text-xs font-semibold transition-colors shadow-sm"
            >
              {currentUser.kycStatus === 'PENDING' ? 'View KYC Status' : 'Verify ID Now'}
            </button>
            <a
              href={`https://t.me/fetanp2probot?start=kyc_${currentUser.id}`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-full border border-amber-400/70 bg-white/80 hover:bg-white text-amber-950 text-xs font-semibold transition-colors"
            >
              Telegram Bot
            </a>
          </div>
        </div>
      )}

      {/* Top Header & Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-brand-ink">
            {t.marketTitle}
          </h1>
          <p className="text-xs sm:text-sm text-brand-ink-soft mt-0.5">{t.marketSub}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* All Ads vs Fast Match Switcher */}
          <div className="liquid-pill-track inline-flex items-center p-1 rounded-full text-xs font-semibold">
            <button
              onClick={() => setMarketMode('ORDERBOOK')}
              className={`px-4 py-1.5 rounded-full transition-all ${
                marketMode === 'ORDERBOOK'
                  ? 'bg-white text-brand-ink shadow-sm font-bold'
                  : 'text-brand-ink-soft hover:text-brand-ink'
              }`}
            >
              {t.modeOrderbook}
            </button>
            <button
              onClick={() => setMarketMode('EXPRESS')}
              className={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                marketMode === 'EXPRESS'
                  ? 'bg-white text-brand-ink shadow-sm font-bold'
                  : 'text-brand-ink-soft hover:text-brand-ink'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-brand-buy-600" />
              <span>{t.modeExpress}</span>
            </button>
          </div>

          {isMerchant ? (
            <button
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-ink text-white text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4 text-brand-buy-400" />
              <span>{t.postAd}</span>
            </button>
          ) : (
            <button
              onClick={() => setMerchantModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/75 border border-black/10 backdrop-blur-md text-brand-ink text-xs font-semibold hover:bg-white transition-colors shadow-sm"
            >
              <UserCheck className="w-4 h-4 text-brand-ink-soft" />
              <span>{t.applyMerchant}</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Market Prices */}
      <LivePriceTicker />

      {marketMode === 'EXPRESS' ? (
        /* FAST MATCH (EXPRESS) MODE */
        <div className="max-w-xl mx-auto liquid-glass-card rounded-[28px] overflow-hidden">
          <div className="liquid-glass-dark p-6 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-brand-buy-500/20 border border-brand-buy-400/30 flex items-center justify-center">
                <Zap className="w-5 h-5 text-brand-buy-400" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight">Fast Match</h2>
                <p className="text-xs text-white/60">
                  Instant rate match from live escrow liquidity
                </p>
              </div>
            </div>
            <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-brand-buy-500/20 text-brand-buy-300 border border-brand-buy-400/30">
              0% Fee
            </span>
          </div>

          <div className="p-6 space-y-5">
            {/* Buy / Sell Toggle */}
            <div className="liquid-pill-track grid grid-cols-2 gap-1.5 p-1 rounded-full text-xs font-bold">
              <button
                type="button"
                onClick={() => setOfferType('SELL')}
                className={`py-2.5 rounded-full transition-all ${
                  offerType === 'SELL'
                    ? 'bg-brand-buy-600 text-white shadow-sm'
                    : 'text-brand-ink-soft hover:text-brand-ink'
                }`}
              >
                {t.btnBuyUsdt} (Pay Birr)
              </button>
              <button
                type="button"
                onClick={() => setOfferType('BUY')}
                className={`py-2.5 rounded-full transition-all ${
                  offerType === 'BUY'
                    ? 'bg-brand-sell text-white shadow-sm'
                    : 'text-brand-ink-soft hover:text-brand-ink'
                }`}
              >
                {t.btnSellUsdt} (Get Birr)
              </button>
            </div>

            {/* Amount in ETB */}
            <div className="rounded-2xl border border-black/10 bg-white/60 backdrop-blur-sm p-4 space-y-2.5">
              <div className="flex justify-between text-xs text-brand-ink-soft font-medium">
                <span>{isUserBuying ? 'I want to pay' : 'I want to receive'}</span>
                <span>Ethiopian Birr (ETB)</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <input
                  type="number"
                  value={expressEtb}
                  onChange={(e) => setExpressEtb(e.target.value)}
                  className="w-full bg-transparent text-2xl font-bold font-mono text-brand-ink tabular-nums focus:outline-none"
                  placeholder="10000"
                />
                <span className="px-3 py-1 rounded-full bg-white/90 border border-black/10 text-xs font-bold text-brand-ink shrink-0">
                  ETB
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['1000', '5000', '15000', '50000'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setExpressEtb(preset)}
                    className="px-3 py-1 rounded-full bg-white/80 border border-black/10 text-[11px] font-mono font-semibold text-brand-ink-soft hover:text-brand-ink hover:bg-white transition-colors"
                  >
                    {Number(preset).toLocaleString()} ETB
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-brand-ink">
                Choose Payment Rail
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {(
                  ['TELEBIRR', 'CBE', 'ABYSSINIA', 'AWASH', 'CBE_BIRR', 'DASHEN'] as PaymentMethod[]
                ).map((m) => {
                  const meta = PAYMENT_METHODS_META[m];
                  const active = expressMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExpressMethod(m)}
                      className={`p-2.5 rounded-2xl border text-left flex items-center gap-2 transition-all ${
                        active
                          ? 'border-brand-ink bg-brand-ink text-white font-semibold shadow-sm'
                          : 'border-black/10 bg-white/65 text-brand-ink-soft hover:bg-white hover:text-brand-ink'
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

            {/* Matched Merchant Summary */}
            {expressMatchedOffer && (
              <div className="rounded-2xl border border-brand-buy-300/60 bg-brand-buy-50/80 backdrop-blur-sm p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-brand-buy-900/80 font-medium">Best Live Match:</span>
                  <span className="font-bold text-brand-ink flex items-center gap-1">
                    <span>{expressMatchedOffer.merchantName}</span>
                    <ShieldCheck className="w-4 h-4 text-brand-buy-600" />
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-brand-buy-900/80 font-medium">Unit Price:</span>
                  <span className="font-mono font-bold text-brand-ink tabular-nums">
                    {expressMatchedOffer.pricePerUsdtEtb.toFixed(2)} ETB / USDT
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-brand-buy-300/40">
                  <span className="text-brand-buy-900 font-semibold">
                    {isUserBuying ? 'Estimated USDT You Receive:' : 'Estimated USDT You Sell:'}
                  </span>
                  <span className="text-base font-mono font-bold text-brand-buy-700 tabular-nums">
                    {((parseFloat(expressEtb) || 0) / expressMatchedOffer.pricePerUsdtEtb).toFixed(
                      2
                    )}{' '}
                    USDT
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!expressMatchedOffer}
              onClick={() =>
                expressMatchedOffer && handleOpenTradeModal(expressMatchedOffer, expressEtb)
              }
              className={`w-full py-3.5 px-5 rounded-full font-bold text-sm text-white flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50 ${
                isUserBuying
                  ? 'bg-brand-buy-600 hover:bg-brand-buy-700'
                  : 'bg-brand-sell hover:opacity-95'
              }`}
            >
              <span>{isUserBuying ? 'Continue to Buy USDT' : 'Continue to Sell USDT'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* ALL ADS (ORDERBOOK) MODE */
        <>
          {/* Filter & Control Card */}
          <div className="liquid-glass-card rounded-[26px] p-4 sm:p-5 space-y-4">
            {/* Top Row: Buy / Sell Switcher + Sort + Count */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/[0.07] pb-4">
              <div className="liquid-pill-track inline-flex p-1 rounded-full text-xs font-bold self-start">
                <button
                  onClick={() => setOfferType('SELL')}
                  className={`px-5 py-2 rounded-full transition-all ${
                    offerType === 'SELL'
                      ? 'bg-brand-buy-600 text-white shadow-sm'
                      : 'text-brand-ink-soft hover:text-brand-ink'
                  }`}
                >
                  {t.btnBuyUsdt}
                </button>
                <button
                  onClick={() => setOfferType('BUY')}
                  className={`px-5 py-2 rounded-full transition-all ${
                    offerType === 'BUY'
                      ? 'bg-brand-sell text-white shadow-sm'
                      : 'text-brand-ink-soft hover:text-brand-ink'
                  }`}
                >
                  {t.btnSellUsdt}
                </button>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 text-xs">
                <div className="flex items-center gap-1.5 text-brand-ink-soft">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="bg-white/75 border border-black/10 rounded-full px-3 py-1.5 font-semibold text-brand-ink focus:outline-none focus:border-black/30"
                  >
                    <option value="PRICE">
                      {isUserBuying ? 'Lowest Price First' : 'Highest Price First'}
                    </option>
                    <option value="RATE">Highest Completion %</option>
                    <option value="TRADES">Most Completed Orders</option>
                  </select>
                </div>

                <span className="text-brand-ink-soft font-mono font-medium hidden sm:inline tabular-nums">
                  • {filteredOffers.length} {filteredOffers.length === 1 ? 'ad' : 'ads'}
                </span>
              </div>
            </div>

            {/* Second Row: Amount Input & Payment Method Filter Pills */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              {/* Amount Input */}
              <div className="lg:col-span-4 space-y-1.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-3" />
                  <input
                    type="number"
                    placeholder="Filter by amount in Birr (e.g. 5000)"
                    value={amountFilterEtb}
                    onChange={(e) => setAmountFilterEtb(e.target.value)}
                    className="w-full pl-9 pr-16 py-2 rounded-full border border-black/10 bg-white/65 text-xs font-mono font-semibold text-brand-ink tabular-nums focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                  {amountFilterEtb ? (
                    <button
                      onClick={() => setAmountFilterEtb('')}
                      className="absolute right-3.5 top-2.5 text-brand-ink-soft hover:text-brand-ink text-xs"
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="absolute right-3.5 top-2.5 text-[11px] font-bold text-brand-ink-soft">
                      ETB
                    </span>
                  )}
                </div>
              </div>

              {/* Payment Method Pills */}
              <div className="lg:col-span-8 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {paymentFilterOptions.map((method) => {
                  const active = selectedPaymentMethod === method;
                  const meta = method !== 'ALL' ? PAYMENT_METHODS_META[method] : null;
                  return (
                    <button
                      key={method}
                      onClick={() => setSelectedPaymentMethod(method)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                        active
                          ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                          : 'bg-white/65 text-brand-ink-soft border-black/10 hover:bg-white hover:text-brand-ink'
                      }`}
                    >
                      {meta && (
                        <span
                          className="w-1.5 h-3 rounded-full"
                          style={{ backgroundColor: meta.accentColor }}
                        />
                      )}
                      <span>{meta ? meta.shortName : t.allPayments}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Offers List: Desktop Table & Mobile Cards */}
          <div className="liquid-glass-card rounded-[26px] overflow-hidden">
            {loading ? (
              <div className="divide-y divide-black/[0.06] p-4 sm:p-5 space-y-1">
                {[0, 1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="py-3.5 flex items-center justify-between gap-4 animate-pulse"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-black/[0.08]" />
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-32 rounded-full bg-black/[0.08]" />
                        <div className="h-2.5 w-24 rounded-full bg-black/[0.06]" />
                      </div>
                    </div>
                    <div className="hidden sm:block h-5 w-24 rounded-full bg-black/[0.08]" />
                    <div className="hidden md:block h-4 w-36 rounded-full bg-black/[0.06]" />
                    <div className="h-8 w-24 rounded-full bg-black/[0.08]" />
                  </div>
                ))}
              </div>
            ) : filteredOffers.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <p className="text-brand-ink-soft text-sm font-medium">
                  No active liquidity matches your current filter.
                </p>
                <button
                  onClick={() => {
                    setSelectedPaymentMethod('ALL');
                    setAmountFilterEtb('');
                  }}
                  className="px-5 py-2 rounded-full bg-brand-ink text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-black/[0.07] bg-white/50 text-brand-ink-soft text-[11px] font-semibold uppercase tracking-wider">
                        <th className="py-3.5 px-5">{t.advertiser}</th>
                        <th className="py-3.5 px-5">{t.unitPrice}</th>
                        <th className="py-3.5 px-5">{t.availableLimit}</th>
                        <th className="py-3.5 px-5">{t.filterPayment}</th>
                        <th className="py-3.5 px-5 text-right">{t.action}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.06]">
                      {filteredOffers.map((offer) => {
                        const initial = offer.merchantName.charAt(0).toUpperCase();
                        const isOwnAd = offer.merchantId === currentUser?.id;
                        return (
                          <tr
                            key={offer.id}
                            className="hover:bg-white/75 transition-colors group"
                          >
                            {/* Merchant Info */}
                            <td className="py-4 px-5">
                              <div className="flex items-start gap-3">
                                <div className="relative flex-shrink-0">
                                  <div className="w-9 h-9 rounded-full bg-brand-ink text-white font-bold text-xs flex items-center justify-center shadow-sm">
                                    {initial}
                                  </div>
                                  <span
                                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-buy-500 border-2 border-white"
                                    title="Verified Merchant"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 font-bold text-brand-ink text-sm">
                                    <span>{offer.merchantName}</span>
                                    <ShieldCheck className="w-4 h-4 text-brand-buy-600 flex-shrink-0" />
                                    {isOwnAd && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/[0.06] text-brand-ink">
                                        Your Ad
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-brand-ink-soft font-mono tabular-nums">
                                    <span>{offer.completedTrades.toLocaleString()} orders</span>
                                    <span>•</span>
                                    <span className="text-brand-buy-700 font-semibold">
                                      {offer.completionRate}% filled
                                    </span>
                                    <span>•</span>
                                    <span className="inline-flex items-center gap-0.5">
                                      <Clock className="w-3 h-3" />
                                      ~{offer.avgReleaseTimeMins || 1}m
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Price */}
                            <td className="py-4 px-5">
                              <div className="flex items-baseline gap-1">
                                <span className="text-xl font-bold font-mono text-brand-ink tabular-nums tracking-tight">
                                  {offer.pricePerUsdtEtb.toFixed(2)}
                                </span>
                                <span className="text-xs font-semibold text-brand-ink-soft">
                                  ETB
                                </span>
                              </div>
                            </td>

                            {/* Available & Limits */}
                            <td className="py-4 px-5 space-y-1 font-mono tabular-nums">
                              <div className="text-brand-ink-soft">
                                <span className="opacity-70 mr-1.5">{t.available}:</span>
                                <span className="font-bold text-brand-ink">
                                  {offer.totalAvailable.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  USDT
                                </span>
                              </div>
                              <div className="text-brand-ink-soft">
                                <span className="opacity-70 mr-1.5">{t.limits}:</span>
                                <span className="font-semibold text-brand-ink">
                                  {offer.minLimitEtb.toLocaleString()} –{' '}
                                  {offer.maxLimitEtb.toLocaleString()} ETB
                                </span>
                              </div>
                            </td>

                            {/* Payment Methods */}
                            <td className="py-4 px-5">
                              <div className="flex flex-wrap gap-1.5">
                                {offer.paymentMethods.map((m) => {
                                  const meta = PAYMENT_METHODS_META[m];
                                  return (
                                    <span
                                      key={m}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 border border-black/10 text-[11px] font-medium text-brand-ink"
                                    >
                                      <span
                                        className="w-1.5 h-3 rounded-full"
                                        style={{ backgroundColor: meta?.accentColor || '#059669' }}
                                      />
                                      <span>{meta?.shortName || m}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            </td>

                            {/* Trade Action */}
                            <td className="py-4 px-5 text-right">
                              {isOwnAd ? (
                                <button
                                  onClick={() => router.push('/orders?tab=ads')}
                                  className="px-4 py-2 rounded-full text-xs font-semibold border border-black/10 bg-white/80 text-brand-ink hover:bg-white transition-colors"
                                >
                                  Manage Ad
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleOpenTradeModal(offer, amountFilterEtb)}
                                  className={`px-5 py-2.5 rounded-full text-xs font-bold text-white transition-colors shadow-sm ${
                                    isUserBuying
                                      ? 'bg-brand-buy-600 hover:bg-brand-buy-700'
                                      : 'bg-brand-sell hover:opacity-95'
                                  }`}
                                >
                                  {isUserBuying ? t.btnBuyUsdt : t.btnSellUsdt}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden divide-y divide-black/[0.06]">
                  {filteredOffers.map((offer) => {
                    const initial = offer.merchantName.charAt(0).toUpperCase();
                    const isOwnAd = offer.merchantId === currentUser?.id;
                    return (
                      <div key={offer.id} className="p-4 space-y-3.5">
                        {/* Top row: Merchant + Price */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative flex-shrink-0">
                              <div className="w-8 h-8 rounded-full bg-brand-ink text-white font-bold text-xs flex items-center justify-center">
                                {initial}
                              </div>
                              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-buy-500 border-2 border-white" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 font-bold text-brand-ink text-sm truncate">
                                <span className="truncate">{offer.merchantName}</span>
                                <ShieldCheck className="w-3.5 h-3.5 text-brand-buy-600 flex-shrink-0" />
                              </div>
                              <div className="text-[11px] font-mono text-brand-ink-soft tabular-nums">
                                {offer.completedTrades} orders • {offer.completionRate}% • ~
                                {offer.avgReleaseTimeMins || 1}m
                              </div>
                            </div>
                          </div>

                          <div className="text-right flex-shrink-0">
                            <div className="text-[10px] text-brand-ink-soft uppercase font-medium">
                              Price
                            </div>
                            <div className="text-lg font-mono font-bold text-brand-ink tabular-nums">
                              {offer.pricePerUsdtEtb.toFixed(2)}{' '}
                              <span className="text-xs font-semibold text-brand-ink-soft">ETB</span>
                            </div>
                          </div>
                        </div>

                        {/* Middle row: Quantity & Limits */}
                        <div className="rounded-2xl bg-white/65 border border-black/[0.08] p-3 text-xs space-y-1 font-mono tabular-nums">
                          <div className="flex justify-between">
                            <span className="text-brand-ink-soft">{t.available}:</span>
                            <span className="font-bold text-brand-ink">
                              {offer.totalAvailable.toFixed(2)} USDT
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-brand-ink-soft">{t.limits}:</span>
                            <span className="font-semibold text-brand-ink">
                              {offer.minLimitEtb.toLocaleString()} –{' '}
                              {offer.maxLimitEtb.toLocaleString()} ETB
                            </span>
                          </div>
                        </div>

                        {/* Bottom row: Payment methods + CTA */}
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div className="flex flex-wrap gap-1">
                            {offer.paymentMethods.map((m) => {
                              const meta = PAYMENT_METHODS_META[m];
                              return (
                                <span
                                  key={m}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/75 border border-black/10 text-[10px] font-medium text-brand-ink"
                                >
                                  <span
                                    className="w-1 h-2.5 rounded-full"
                                    style={{ backgroundColor: meta?.accentColor || '#059669' }}
                                  />
                                  <span>{meta?.shortName || m}</span>
                                </span>
                              );
                            })}
                          </div>

                          {isOwnAd ? (
                            <button
                              onClick={() => router.push('/orders?tab=ads')}
                              className="px-4 py-2 rounded-full text-xs font-semibold border border-black/10 bg-white/80 text-brand-ink"
                            >
                              Your Ad
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenTradeModal(offer, amountFilterEtb)}
                              className={`px-5 py-2 rounded-full text-xs font-bold text-white flex-shrink-0 shadow-sm ${
                                isUserBuying ? 'bg-brand-buy-600' : 'bg-brand-sell'
                              }`}
                            >
                              {isUserBuying ? t.btnBuyUsdt : t.btnSellUsdt}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Order Creation Modal / Sheet */}
      {selectedOffer && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="liquid-glass-card rounded-t-[28px] sm:rounded-[28px] w-full max-w-lg overflow-hidden max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="liquid-glass-dark p-4 sm:p-5 text-white flex justify-between items-center">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                      selectedOffer.offerType === 'SELL'
                        ? 'bg-brand-buy-500 text-neutral-950'
                        : 'bg-brand-sell text-white'
                    }`}
                  >
                    {selectedOffer.offerType === 'SELL' ? 'Buy USDT' : 'Sell USDT'}
                  </span>
                  <h3 className="text-sm font-bold">{selectedOffer.merchantName}</h3>
                </div>
                <p className="text-[11px] text-white/65 font-mono tabular-nums">
                  Price: <strong className="text-white">{selectedOffer.pricePerUsdtEtb.toFixed(2)} ETB</strong> •
                  15 min to pay • 0% Fee
                </p>
              </div>
              <button
                onClick={() => setSelectedOffer(null)}
                className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmTrade}
              className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs"
            >
              {tradeError && (
                <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span>{tradeError}</span>
                </div>
              )}

              {currentUser && currentUser.kycStatus !== 'VERIFIED' && !isAdminRole(currentUser.role) && (
                <div className="p-3.5 rounded-2xl bg-amber-50/90 border border-amber-300/70 text-amber-950 space-y-2">
                  <div className="font-bold text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-700" />
                    <span>Identity Verification (KYC) Required</span>
                  </div>
                  <p className="text-[11px] text-amber-900 leading-relaxed">
                    All users must verify their ID before placing a Buy or Sell order on Fetan P2P.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOffer(null);
                        setKycModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-brand-ink text-white text-xs font-semibold"
                    >
                      Verify ID on Website
                    </button>
                    <a
                      href={`https://t.me/fetanp2probot?start=kyc_${currentUser.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-1.5 rounded-full border border-amber-400/70 bg-white/80 text-amber-950 text-xs font-semibold"
                    >
                      @fetanp2probot
                    </a>
                  </div>
                </div>
              )}

              {/* Offer Summary & Balance Check when Selling */}
              <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] space-y-1.5 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-brand-ink-soft">Order Limits:</span>
                  <span className="font-semibold text-brand-ink">
                    {selectedOffer.minLimitEtb.toLocaleString()} –{' '}
                    {selectedOffer.maxLimitEtb.toLocaleString()} ETB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-ink-soft">Available on Ad:</span>
                  <span className="font-semibold text-brand-ink">
                    {selectedOffer.totalAvailable.toFixed(2)} USDT
                  </span>
                </div>
                {selectedOffer.offerType === 'BUY' && currentUser && (
                  <div className="flex justify-between pt-1.5 border-t border-black/[0.07]">
                    <span className="text-brand-ink-soft font-medium">Your Wallet Balance:</span>
                    <span className="font-bold text-brand-buy-700">
                      {currentUser.usdtBalance.toFixed(2)} USDT
                    </span>
                  </div>
                )}
              </div>

              {/* Dual Inputs: ETB & USDT */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="font-semibold text-brand-ink">
                      {selectedOffer.offerType === 'SELL' ? 'You Pay (ETB)' : 'You Get (ETB)'}
                    </label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleQuickFill('MIN')}
                        className="text-[10px] font-bold text-brand-ink-soft hover:text-brand-ink px-2 py-0.5 rounded-full bg-black/[0.06]"
                      >
                        Min
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickFill('HALF')}
                        className="text-[10px] font-bold text-brand-ink-soft hover:text-brand-ink px-2 py-0.5 rounded-full bg-black/[0.06]"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickFill('MAX')}
                        className="text-[10px] font-bold text-brand-buy-700 hover:text-brand-buy-900 px-2 py-0.5 rounded-full bg-brand-buy-50"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tradeEtbInput}
                      onChange={(e) => handleEtbChange(e.target.value)}
                      className="w-full pl-3.5 pr-12 py-2.5 rounded-2xl border border-black/10 bg-white/75 text-sm font-mono font-bold text-brand-ink tabular-nums focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                    <span className="absolute right-3.5 top-3 text-brand-ink-soft font-semibold">
                      ETB
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-brand-ink mb-1.5">
                    {selectedOffer.offerType === 'SELL' ? 'You Get (USDT)' : 'You Sell (USDT)'}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tradeUsdtAmount}
                      onChange={(e) => handleUsdtChange(e.target.value)}
                      className="w-full pl-3.5 pr-14 py-2.5 rounded-2xl border border-black/10 bg-white/75 text-sm font-mono font-bold text-brand-ink tabular-nums focus:outline-none focus:bg-white focus:border-brand-ink"
                    />
                    <span className="absolute right-3.5 top-3 text-brand-ink-soft font-semibold">
                      USDT
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="block font-semibold text-brand-ink mb-1.5">
                  {selectedOffer.offerType === 'SELL'
                    ? 'How will you pay the seller?'
                    : 'How do you want to receive Birr?'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {selectedOffer.paymentMethods.map((m) => {
                    const meta = PAYMENT_METHODS_META[m];
                    const active = tradePaymentMethod === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTradePaymentMethod(m)}
                        className={`p-2.5 rounded-2xl text-left border transition-all flex items-center justify-between ${
                          active
                            ? 'border-brand-ink bg-brand-ink text-white font-semibold shadow-sm'
                            : 'border-black/10 bg-white/65 text-brand-ink hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-1.5 h-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: meta?.accentColor || '#059669' }}
                          />
                          <span className="truncate">{meta?.shortName || m}</span>
                        </div>
                        {active && <CheckCircle2 className="w-3.5 h-3.5 text-brand-buy-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* When User is Selling USDT: Confirm Payout Account Number */}
              {selectedOffer.offerType === 'BUY' && (
                <div className="p-3.5 rounded-2xl bg-white/65 border border-black/[0.08] space-y-2">
                  <label className="block font-semibold text-brand-ink">
                    Your {PAYMENT_METHODS_META[tradePaymentMethod]?.accountLabel || 'Account Number'}{' '}
                    (where buyer will send Birr)
                  </label>
                  <input
                    type="text"
                    required
                    value={sellerAccountNumber}
                    onChange={(e) => setSellerAccountNumber(e.target.value)}
                    placeholder={
                      PAYMENT_METHODS_META[tradePaymentMethod]?.placeholder ||
                      'Enter account or phone number'
                    }
                    className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/85 font-mono text-xs text-brand-ink focus:outline-none focus:border-brand-ink"
                  />
                  <p className="text-[11px] text-brand-ink-soft">
                    Account holder name: <strong className="text-brand-ink">{displayName(currentUser?.name)}</strong>
                  </p>
                </div>
              )}

              {/* Merchant Note */}
              {selectedOffer.terms && (
                <div className="p-3.5 rounded-2xl bg-amber-50/85 border border-amber-300/60 text-amber-950 space-y-1">
                  <div className="font-bold text-[11px] uppercase tracking-wider text-amber-800">
                    Seller / Buyer Note
                  </div>
                  <p className="text-xs leading-relaxed text-amber-900">{selectedOffer.terms}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-black/[0.07]">
                <button
                  type="button"
                  onClick={() => setSelectedOffer(null)}
                  className="px-4 py-2.5 rounded-full border border-black/10 bg-white/75 font-semibold text-brand-ink hover:bg-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={initiatingTrade || calculatedEtb <= 0}
                  className={`px-6 py-2.5 rounded-full text-white font-bold transition-colors shadow-sm disabled:opacity-50 ${
                    selectedOffer.offerType === 'SELL'
                      ? 'bg-brand-buy-600 hover:bg-brand-buy-700'
                      : 'bg-brand-sell hover:opacity-95'
                  }`}
                >
                  {initiatingTrade
                    ? 'Starting Order...'
                    : selectedOffer.offerType === 'SELL'
                    ? `Buy ${Number(tradeUsdtAmount || 0).toFixed(2)} USDT`
                    : `Sell ${Number(tradeUsdtAmount || 0).toFixed(2)} USDT`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateOfferModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={fetchOffers}
      />
      <ApplyMerchantModal
        isOpen={merchantModalOpen}
        onClose={() => setMerchantModalOpen(false)}
      />
      <KycModal
        isOpen={kycModalOpen}
        onClose={() => setKycModalOpen(false)}
      />
    </div>
  );
}

export default function MarketPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <div className="liquid-glass-card rounded-[26px] p-12 text-center text-brand-ink-soft text-xs animate-pulse">
            Loading P2P Market...
          </div>
        }
      >
        <MarketContent />
      </Suspense>
    </ProtectedRoute>
  );
}
