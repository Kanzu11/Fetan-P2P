'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRealtime } from './realtime-provider';
import { KycDocType } from '@/client/types';
import {
  ShieldCheck,
  AlertTriangle,
  Send,
  CheckCircle2,
  X,
  Loader2,
  Building,
  FileText,
  ArrowRight,
} from 'lucide-react';

export function ApplyMerchantModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { currentUser, refreshUser, setNotification } = useRealtime();
  const [businessName, setBusinessName] = useState(currentUser?.nickname || '');
  const [telegramHandle, setTelegramHandle] = useState(currentUser?.telegramHandle || '');
  const [terms, setTerms] = useState('Payment within 15 minutes. Fast release after checking bank.');
  const [tradeExperience, setTradeExperience] = useState('Active P2P trader');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !currentUser) return null;

  const hasEnoughBalance = currentUser.usdtBalance >= 10.0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/user/apply-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          businessName: businessName.trim(),
          telegramHandle: telegramHandle.trim(),
          terms: terms.trim(),
          tradeExperience: tradeExperience.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit merchant application');
      }

      setSubmitted(true);
      await refreshUser();
      setNotification('Merchant application sent to our review team.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="liquid-glass-card rounded-t-[28px] sm:rounded-[28px] w-full max-w-lg overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="liquid-glass-dark p-4 sm:p-5 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-brand-buy-500/20 border border-brand-buy-400/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-brand-buy-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Become a Certified P2P Merchant</h2>
              <p className="text-[11px] text-white/65">
                Post public Buy & Sell ads with custom rates and terms
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Balance Requirement Check */}
          <div className="rounded-2xl border border-black/[0.08] bg-white/65 p-4 text-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-brand-ink-soft font-medium">Required Wallet Balance:</span>
              <span className="font-mono font-bold text-brand-ink tabular-nums">10.00 USDT</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-brand-ink-soft font-medium">Your Current Balance:</span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  hasEnoughBalance ? 'text-brand-buy-700' : 'text-brand-sell'
                }`}
              >
                {currentUser.usdtBalance.toFixed(2)} USDT
              </span>
            </div>

            {!hasEnoughBalance && (
              <div className="pt-2 border-t border-black/[0.07] flex items-center justify-between gap-2">
                <span className="text-[11px] text-brand-sell font-mono flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Need +{(10 - currentUser.usdtBalance).toFixed(2)} USDT
                </span>
                <Link
                  href="/wallet"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-full bg-brand-buy-600 hover:bg-brand-buy-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm transition-colors"
                >
                  <span>Deposit USDT</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>

          {submitted || currentUser.merchantStatus === 'PENDING' ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-brand-buy-50 border border-brand-buy-300/60 text-brand-buy-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-brand-ink">
                Application Under Review
              </h3>
              <p className="text-xs text-brand-ink-soft max-w-sm mx-auto leading-relaxed">
                Your merchant application has been queued for review. You will receive an instant notification once approved.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-full bg-brand-ink hover:bg-neutral-800 text-white text-xs font-bold transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              {error && (
                <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-rose-800 text-xs">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-brand-ink mb-1.5">
                  Merchant Trading / Business Name
                </label>
                <div className="relative">
                  <Building className="w-3.5 h-3.5 text-brand-ink-soft absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Addis_Fast_FX or Bole_Prime"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-brand-ink mb-1.5">
                  Telegram Username (For Order Alerts)
                </label>
                <input
                  type="text"
                  required
                  value={telegramHandle}
                  onChange={(e) => setTelegramHandle(e.target.value)}
                  placeholder="@your_username"
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 font-mono text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-brand-ink mb-1.5">
                  Trading Experience / Platforms
                </label>
                <input
                  type="text"
                  value={tradeExperience}
                  onChange={(e) => setTradeExperience(e.target.value)}
                  placeholder="e.g. Active P2P trader on Binance / Bybit"
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-brand-ink mb-1.5">
                  Default Payment Terms for Buyers/Sellers
                </label>
                <textarea
                  rows={2}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Payment instructions..."
                  className="w-full p-3.5 rounded-2xl border border-black/10 bg-white/80 text-xs text-brand-ink focus:outline-none focus:bg-white focus:border-brand-ink"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !hasEnoughBalance}
                className="w-full py-3 rounded-full bg-brand-buy-600 hover:bg-brand-buy-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Submit Merchant Application
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
