'use client';

import React, { useState } from 'react';
import { useRealtime } from './realtime-provider';
import { KycDocType } from '@/client/types';
import { ShieldCheck, AlertTriangle, Send, CheckCircle2, X, PlusCircle } from 'lucide-react';

export function ApplyMerchantModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { currentUser, refreshUser, depositUsdt, setNotification } = useRealtime();
  const [telegramHandle, setTelegramHandle] = useState(currentUser?.telegramHandle || '');
  const [docType, setDocType] = useState<KycDocType>(currentUser?.kycDocType || 'NATIONAL_ID');
  const [docNumber, setDocNumber] = useState(currentUser?.kycDocNumber || '');
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
          telegramHandle,
          kycDocType: docType,
          kycDocNumber: docNumber,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit request');
      }

      setSubmitted(true);
      await refreshUser();
      setNotification('Merchant request sent to Admin for review.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Become a Verified Merchant</h2>
              <p className="text-[11px] text-slate-400">
                Post your own Buy & Sell USDT ads with zero fee
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

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* Balance Requirement Check */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Required Wallet Balance:</span>
              <span className="font-bold text-slate-900 tabular-nums">10.00 USDT</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Your Current Balance:</span>
              <span
                className={`font-bold tabular-nums ${
                  hasEnoughBalance ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                {currentUser.usdtBalance.toFixed(2)} USDT
              </span>
            </div>

            {!hasEnoughBalance && (
              <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-rose-800">
                <div className="flex items-start gap-1.5 text-[11px]">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span>You need at least 10.00 USDT in your wallet to apply.</span>
                </div>
                <button
                  type="button"
                  onClick={() => depositUsdt(15.0)}
                  className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 flex-shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Add +15 USDT</span>
                </button>
              </div>
            )}
          </div>

          {submitted ? (
            <div className="py-6 text-center space-y-3">
              <CheckCircle2 className="w-11 h-11 text-emerald-600 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">Request Sent</h3>
              <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                Our team received your merchant request. Once approved by an Admin, you can post Buy and Sell ads right away.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {error}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Telegram Username (for order alerts)
                </label>
                <input
                  type="text"
                  required
                  value={telegramHandle}
                  onChange={(e) => setTelegramHandle(e.target.value)}
                  placeholder="@your_telegram"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ID Type</label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as KycDocType)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:border-slate-900"
                >
                  <option value="NATIONAL_ID">Fayda National Digital ID (Ethiopia)</option>
                  <option value="PASSPORT">Ethiopian Passport</option>
                  <option value="DRIVERS_LICENSE">Ethiopian Driver’s License</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ID Number</label>
                <input
                  type="text"
                  required
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="e.g. FAYDA-8821-4920"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-200 pt-3">
                By applying, you agree to only use bank and Telebirr accounts registered under your own name.
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!hasEnoughBalance || loading}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{loading ? 'Sending...' : 'Send Request'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
