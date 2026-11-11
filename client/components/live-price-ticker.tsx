'use client';

import React, { useState, useEffect } from 'react';
import { MarketPriceStats } from '@/client/pricing';
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
    fetchPrices();
    const interval = setInterval(fetchPrices, 8000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Top row: Average market price */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-slate-500 font-semibold text-xs uppercase tracking-wider">
              {lang === 'am' ? 'አማካይ የገበያ ዋጋ (1 USDT)' : 'Average Market Price (1 USDT)'}
            </span>
            <span className="text-lg font-bold text-slate-900 tabular-nums">
              {stats.referencePriceEtb.toFixed(2)}{' '}
              <span className="text-xs font-medium text-slate-500">ETB</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
            {lang === 'am' ? 'የዋጋ ልዩነት' : 'Price Difference'}:{' '}
            <strong className="text-slate-900 font-semibold tabular-nums">
              {stats.spreadEtb.toFixed(2)} ETB
            </strong>{' '}
            <span className="text-slate-400">({stats.spreadPercent}%)</span>
          </span>
          <button
            onClick={fetchPrices}
            disabled={loading}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            title="Refresh Prices"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-slate-900' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Simple Market Numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Best Buy Price */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-1">
          <div className="text-xs text-slate-500 font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'ምርጥ የመግዣ ዋጋ' : 'Best Price to Buy'}</span>
            <ArrowDownRight className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-base font-bold text-emerald-700 tabular-nums">
            {stats.bestBuyPriceEtb.toFixed(2)} <span className="text-xs font-medium">ETB</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {lang === 'am' ? 'ዝቅተኛው የሻጭ ዋጋ' : 'Lowest seller price right now'}
          </div>
        </div>

        {/* Best Sell Price */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-1">
          <div className="text-xs text-slate-500 font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'ምርጥ የመሸጫ ዋጋ' : 'Best Price to Sell'}</span>
            <ArrowUpRight className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-base font-bold text-rose-700 tabular-nums">
            {stats.bestSellPriceEtb.toFixed(2)} <span className="text-xs font-medium">ETB</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {lang === 'am' ? 'ከፍተኛው የገዢ ዋጋ' : 'Highest buyer price right now'}
          </div>
        </div>

        {/* Today's Range */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-1">
          <div className="text-xs text-slate-500 font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'የዛሬ የዋጋ ክልል' : "Today's Price Range"}</span>
            <Activity className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-sm font-bold text-slate-900 tabular-nums">
            {stats.low24hEtb.toFixed(2)} – {stats.high24hEtb.toFixed(2)} ETB
          </div>
          <div className="text-[11px] text-slate-500">
            {lang === 'am' ? 'የ24 ሰዓት ዝቅተኛ እና ከፍተኛ' : 'Lowest and highest in 24h'}
          </div>
        </div>

        {/* Allowed Ad Price Range */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-1">
          <div className="text-xs text-slate-500 font-medium flex items-center justify-between">
            <span>{lang === 'am' ? 'የተፈቀደ የማስታወቂያ ዋጋ' : 'Allowed Ad Price'}</span>
            <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
          </div>
          <div className="text-sm font-bold text-slate-900 tabular-nums">
            {stats.minPriceLimitEtb.toFixed(2)} – {stats.maxPriceLimitEtb.toFixed(2)} ETB
          </div>
          <div className="text-[11px] text-slate-500">
            {lang === 'am' ? '±10% ፍትሃዊ የዋጋ ገደብ' : 'Safe price limit (±10%)'}
          </div>
        </div>
      </div>
    </div>
  );
}
