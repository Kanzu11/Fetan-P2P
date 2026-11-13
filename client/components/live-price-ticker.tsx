'use client';

import React, { useState, useEffect } from 'react';
import type { MarketPriceStats } from '@/client/pricing';
import { useI18n } from '@/client/i18n';
import {
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  Activity,
} from 'lucide-react';

export function LivePriceTicker() {
  const { lang } = useI18n();
  const [stats, setStats] = useState<MarketPriceStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPrices = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/prices/live');
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch (e) {
      console.error('Failed to fetch live prices:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPrices();
    const interval = setInterval(fetchPrices, 8000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) {
    return (
      <div className="liquid-glass-card rounded-[24px] p-5 animate-pulse">
        <div className="h-5 w-48 bg-black/[0.06] rounded-full mb-4" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-20 rounded-2xl bg-black/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="liquid-glass-card rounded-[24px] p-4 sm:p-5 space-y-4">
      {/* Top row: Average market price */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex rounded-full h-2 w-2 bg-brand-buy shadow-[0_0_0_4px_rgba(0,135,81,0.14)]" />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-brand-ink-soft font-semibold text-[11px] uppercase tracking-wider">
              {lang === 'am' ? 'አማካይ የገበያ ዋጋ (1 USDT)' : 'Reference Desk Rate (1 USDT)'}
            </span>
            <span className="text-lg font-bold font-mono text-brand-ink tabular-nums">
              {stats.referencePriceEtb.toFixed(2)}{' '}
              <span className="text-xs font-sans font-medium text-brand-ink-soft">ETB</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs text-brand-ink-soft">
          <span className="bg-white/75 border border-black/[0.06] px-2.5 py-1 rounded-full">
            {lang === 'am' ? 'የዋጋ ልዩነት' : 'Spread'}:{' '}
            <strong className="text-brand-ink font-mono font-semibold tabular-nums">
              {stats.spreadEtb.toFixed(2)} ETB
            </strong>{' '}
            <span className="text-brand-ink-soft/70">({stats.spreadPercent}%)</span>
          </span>
          <button
            type="button"
            onClick={fetchPrices}
            disabled={loading}
            className="p-1.5 rounded-full bg-white/80 border border-black/[0.07] text-brand-ink-soft hover:text-brand-ink transition-colors"
            title="Refresh Prices"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-brand-ink' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Live DB Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white/65 border border-black/[0.05] p-3.5 space-y-1">
          <div className="text-[11px] text-brand-ink-soft font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'ምርጥ የመግዣ ዋጋ' : 'Best Buy'}</span>
            <ArrowDownRight className="w-3.5 h-3.5 text-brand-buy" />
          </div>
          <div className="text-base font-bold font-mono text-brand-buy tabular-nums">
            {stats.bestBuyPriceEtb.toFixed(2)} <span className="text-[11px] font-sans font-medium">ETB</span>
          </div>
          <div className="text-[11px] text-brand-ink-soft/80">
            {stats.activeSellOffersCount} {lang === 'am' ? 'ንቁ ሻጮች' : 'active sell offers'}
          </div>
        </div>

        <div className="rounded-2xl bg-white/65 border border-black/[0.05] p-3.5 space-y-1">
          <div className="text-[11px] text-brand-ink-soft font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'ምርጥ የመሸጫ ዋጋ' : 'Best Sell'}</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-brand-sell" />
          </div>
          <div className="text-base font-bold font-mono text-brand-sell tabular-nums">
            {stats.bestSellPriceEtb.toFixed(2)} <span className="text-[11px] font-sans font-medium">ETB</span>
          </div>
          <div className="text-[11px] text-brand-ink-soft/80">
            {stats.activeBuyOffersCount} {lang === 'am' ? 'ንቁ ገዢዎች' : 'active buy offers'}
          </div>
        </div>

        <div className="rounded-2xl bg-white/65 border border-black/[0.05] p-3.5 space-y-1">
          <div className="text-[11px] text-brand-ink-soft font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'የ24 ሰዓት ክልል' : '24h Range'}</span>
            <Activity className="w-3.5 h-3.5 text-brand-ink-soft" />
          </div>
          <div className="text-sm font-bold font-mono text-brand-ink tabular-nums pt-0.5">
            {stats.low24hEtb.toFixed(2)} – {stats.high24hEtb.toFixed(2)}
          </div>
          <div className="text-[11px] text-brand-ink-soft/80">
            {stats.activeMerchantsCount} {lang === 'am' ? 'ንቁ ነጋዴዎች' : 'active merchants'}
          </div>
        </div>

        <div className="rounded-2xl bg-white/65 border border-black/[0.05] p-3.5 space-y-1">
          <div className="text-[11px] text-brand-ink-soft font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'የተፈቀደ ዋጋ' : 'Allowed Band'}</span>
            <ShieldCheck className="w-3.5 h-3.5 text-brand-ink-soft" />
          </div>
          <div className="text-sm font-bold font-mono text-brand-ink tabular-nums pt-0.5">
            {stats.minPriceLimitEtb.toFixed(2)} – {stats.maxPriceLimitEtb.toFixed(2)}
          </div>
          <div className="text-[11px] text-brand-ink-soft/80">
            {lang === 'am' ? '±15% የገበያ ጥበቃ' : '±15% escrow band'}
          </div>
        </div>
      </div>
    </div>
  );
}
