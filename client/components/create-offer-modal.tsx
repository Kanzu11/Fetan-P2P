'use client';

import React, { useState, useEffect } from 'react';
import { useRealtime } from './realtime-provider';
import { useI18n } from '@/client/i18n';
import { OfferType, PaymentMethod, PAYMENT_METHODS_META } from '@/client/types';
import { MarketPriceStats } from '@/client/pricing';
import { Tag, Plus, Check, ShieldAlert, X } from 'lucide-react';

export function CreateOfferModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { currentUser, setNotification } = useRealtime();
  const { lang } = useI18n();

  const [offerType, setOfferType] = useState<OfferType>('SELL');
  const [pricingType, setPricingType] = useState<'FIXED' | 'FLOATING'>('FIXED');

  // Pricing values
  const [fixedPrice, setFixedPrice] = useState('158.50');
  const [floatingMargin, setFloatingMargin] = useState('100.0');

  // Order quantities and limits
  const [minLimitEtb, setMinLimitEtb] = useState('1000');
  const [maxLimitEtb, setMaxLimitEtb] = useState('75000');
  const [totalAvailable, setTotalAvailable] = useState('500');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(['TELEBIRR', 'CBE']);
  const [terms, setTerms] = useState(
    'Online now. Please send from an account with your own name and do not write crypto in the payment note.'
  );

  const [marketStats, setMarketStats] = useState<MarketPriceStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/prices/live')
      .then((res) => res.json())
      .then((data) => {
        if (data.stats) {
          setMarketStats(data.stats);
          setFixedPrice(data.stats.referencePriceEtb.toFixed(2));
        }
      })
      .catch(console.error);
  }, [isOpen]);

  if (!isOpen || !currentUser) return null;

  const effectivePrice =
    pricingType === 'FIXED'
      ? Number(fixedPrice) || 0
      : marketStats
      ? Number((marketStats.referencePriceEtb * (Number(floatingMargin) / 100)).toFixed(2))
      : 0;

  const togglePaymentMethod = (method: PaymentMethod) => {
    if (paymentMethods.includes(method)) {
      if (paymentMethods.length > 1) {
        setPaymentMethods(paymentMethods.filter((m) => m !== method));
      }
    } else {
      setPaymentMethods([...paymentMethods, method]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (marketStats) {
      if (effectivePrice < marketStats.minPriceLimitEtb) {
        setError(
          lang === 'am'
            ? `ዋጋው ከተፈቀደው ዝቅተኛ ገደብ (${marketStats.minPriceLimitEtb} ETB) በታች ነው።`
            : `Price is below the minimum allowed price (${marketStats.minPriceLimitEtb} ETB).`
        );
        return;
      }
      if (effectivePrice > marketStats.maxPriceLimitEtb) {
        setError(
          lang === 'am'
            ? `ዋጋው ከተፈቀደው ከፍተኛ ገደብ (${marketStats.maxPriceLimitEtb} ETB) በላይ ነው።`
            : `Price is above the maximum allowed price (${marketStats.maxPriceLimitEtb} ETB).`
        );
        return;
      }
    }

    setLoading(true);

    try {
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: currentUser.id,
          offerType,
          pricePerUsdtEtb: effectivePrice,
          minLimitEtb: Number(minLimitEtb),
          maxLimitEtb: Number(maxLimitEtb),
          totalAvailable: Number(totalAvailable),
          paymentMethods,
          terms,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post ad');

      setNotification(
        `Posted ${offerType === 'SELL' ? 'Sell' : 'Buy'} USDT ad at ${effectivePrice.toFixed(2)} ETB`
      );
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error creating ad');
    } finally {
      setLoading(false);
    }
  };

  const allMethods: PaymentMethod[] = [
    'TELEBIRR',
    'CBE',
    'ABYSSINIA',
    'AWASH',
    'CBE_BIRR',
    'DASHEN',
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
              <Tag className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                {lang === 'am' ? 'አዲስ ማስታወቂያ ያውጡ' : 'Post New P2P Ad'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {lang === 'am'
                  ? 'የእርስዎን የUSDT ዋጋ እና የክፍያ ዘዴዎች ይምረጡ'
                  : 'Set your USDT price, order limits, and payment methods'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Offer Type Switcher */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              {lang === 'am' ? 'ምን ማድረግ ይፈልጋሉ?' : 'What do you want to do?'}
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setOfferType('SELL')}
                className={`py-2.5 rounded-lg text-center font-bold transition-colors ${
                  offerType === 'SELL'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'am' ? 'USDT መሸጥ (ብር ተቀበል)' : 'I Want to Sell USDT'}
              </button>
              <button
                type="button"
                onClick={() => setOfferType('BUY')}
                className={`py-2.5 rounded-lg text-center font-bold transition-colors ${
                  offerType === 'BUY'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'am' ? 'USDT መግዛት (ብር ክፈል)' : 'I Want to Buy USDT'}
              </button>
            </div>
          </div>

          {/* Pricing Strategy */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50 space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-900 text-xs">
                {lang === 'am' ? 'የዋጋ ዓይነት' : 'How to Set Your Price'}
              </span>
              {marketStats && (
                <span className="text-[11px] text-slate-500">
                  Market Price:{' '}
                  <strong className="text-slate-900 tabular-nums">
                    {marketStats.referencePriceEtb.toFixed(2)} ETB
                  </strong>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPricingType('FIXED')}
                className={`py-2 rounded-lg border text-center font-semibold transition-colors ${
                  pricingType === 'FIXED'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                {lang === 'am' ? 'ቋሚ ዋጋ' : 'Fixed Price'}
              </button>
              <button
                type="button"
                onClick={() => setPricingType('FLOATING')}
                className={`py-2 rounded-lg border text-center font-semibold transition-colors ${
                  pricingType === 'FLOATING'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                {lang === 'am' ? 'ከገበያ ጋር የሚቀያየር (%)' : 'Follow Market (%)'}
              </button>
            </div>

            {pricingType === 'FIXED' ? (
              <div className="space-y-1">
                <label className="block text-slate-600 text-[11px] font-medium">
                  {lang === 'am' ? 'የአንዱ USDT ዋጋ በብር' : 'Your Price for 1 USDT'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                    className="w-full pl-3.5 pr-14 py-2.5 rounded-lg border border-slate-300 font-bold text-sm text-slate-900 tabular-nums focus:outline-none focus:border-slate-900 bg-white"
                  />
                  <span className="absolute right-3.5 top-2.5 text-slate-500 font-semibold text-xs">
                    ETB
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Market Percentage:</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {floatingMargin}% → {effectivePrice.toFixed(2)} ETB
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="90.0"
                    max="110.0"
                    step="0.1"
                    value={floatingMargin}
                    onChange={(e) => setFloatingMargin(e.target.value)}
                    className="flex-1 accent-emerald-600"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="90"
                    max="110"
                    value={floatingMargin}
                    onChange={(e) => setFloatingMargin(e.target.value)}
                    className="w-20 px-2 py-1.5 rounded-lg border border-slate-300 text-center font-bold bg-white tabular-nums"
                  />
                </div>
              </div>
            )}

            {marketStats && (
              <div className="flex justify-between items-center text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                <span>
                  Allowed:{' '}
                  <strong className="text-slate-700 tabular-nums">
                    {marketStats.minPriceLimitEtb.toFixed(2)} – {marketStats.maxPriceLimitEtb.toFixed(2)} ETB
                  </strong>
                </span>
                <span>0% Ad Fee</span>
              </div>
            )}
          </div>

          {/* Total USDT & Limits */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {lang === 'am' ? 'ጠቅላላ መጠን (USDT)' : 'Total USDT Amount'}
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={totalAvailable}
                onChange={(e) => setTotalAvailable(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold tabular-nums focus:outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {lang === 'am' ? 'ዝቅተኛ ትዕዛዝ (ETB)' : 'Min Order (ETB)'}
              </label>
              <input
                type="number"
                required
                value={minLimitEtb}
                onChange={(e) => setMinLimitEtb(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold tabular-nums focus:outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {lang === 'am' ? 'ከፍተኛ ትዕዛዝ (ETB)' : 'Max Order (ETB)'}
              </label>
              <input
                type="number"
                required
                value={maxLimitEtb}
                onChange={(e) => setMaxLimitEtb(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold tabular-nums focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          {/* Payment Methods */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              {lang === 'am' ? 'የክፍያ ዘዴዎች' : 'Payment Methods'}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {allMethods.map((method) => {
                const selected = paymentMethods.includes(method);
                const meta = PAYMENT_METHODS_META[method];
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => togglePaymentMethod(method)}
                    className={`px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-colors ${
                      selected
                        ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="w-1.5 h-3.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: meta.accentColor }}
                      />
                      <span className="truncate">{meta.shortName}</span>
                    </div>
                    {selected && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Merchant Terms */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {lang === 'am' ? 'ለገዢ/ሻጭ መልእክት' : 'Note for Buyers / Sellers'}
            </label>
            <textarea
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
              placeholder="e.g. Please send from your own account and do not write crypto in the payment note..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
            >
              {lang === 'am' ? 'ተመለስ' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{loading ? 'Posting...' : lang === 'am' ? 'ማስታወቂያ ለጥፍ' : 'Post Ad'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
