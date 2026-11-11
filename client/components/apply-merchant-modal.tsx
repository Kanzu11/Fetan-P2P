'use client';

import React, { useState } from 'react';
import { useRealtime } from './realtime-provider';
import { KycDocType } from '@/client/types';
import {
  ShieldCheck,
  AlertTriangle,
  Send,
  CheckCircle2,
  X,
  PlusCircle,
  Upload,
  Loader2,
  Building,
  FileText,
} from 'lucide-react';

export function ApplyMerchantModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { currentUser, refreshUser, depositUsdt, setNotification } = useRealtime();
  const [businessName, setBusinessName] = useState(currentUser?.nickname || '');
  const [telegramHandle, setTelegramHandle] = useState(currentUser?.telegramHandle || '');
  const [terms, setTerms] = useState('Payment within 15 minutes. Fast release after checking bank.');
  const [tradeExperience, setTradeExperience] = useState('1+ years P2P trading experience');
  const [proofDocumentUrl, setProofDocumentUrl] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !currentUser) return null;

  const hasEnoughBalance = currentUser.usdtBalance >= 10.0;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingDoc(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'fetan_p2p/receipts');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success && data.url) {
        setProofDocumentUrl(data.url);
        setNotification('Business/Trading document uploaded to Cloudinary!');
      } else {
        setError(data.error || 'Failed to upload document');
      }
    } catch {
      setError('Network error while uploading document');
    } finally {
      setUploadingDoc(false);
    }
  };

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
          proofDocumentUrl: proofDocumentUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit merchant application');
      }

      setSubmitted(true);
      await refreshUser();
      setNotification('Merchant application sent to Superadmin @kanzedin for review.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Become a Certified P2P Merchant</h2>
              <p className="text-[11px] text-slate-400">
                Separate from basic platform KYC: post Buy & Sell ads with custom terms
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
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Balance Requirement Check */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3.5 text-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Required Wallet Balance:</span>
              <span className="font-bold text-slate-900 dark:text-white tabular-nums">10.00 USDT</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Your Current Balance:</span>
              <span
                className={`font-bold tabular-nums ${
                  hasEnoughBalance ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'
                }`}
              >
                {currentUser.usdtBalance.toFixed(2)} USDT
              </span>
            </div>

            {!hasEnoughBalance && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                <span className="text-[11px] text-rose-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Need +{(10 - currentUser.usdtBalance).toFixed(2)} USDT
                </span>
                <button
                  onClick={() => depositUsdt(100)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm transition-colors"
                >
                  <PlusCircle className="w-3 h-3" />
                  Top Up Test USDT
                </button>
              </div>
            )}
          </div>

          {submitted || currentUser.merchantStatus === 'PENDING' ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Application Under Review
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                Your merchant application was submitted to Superadmin <b>@kanzedin</b>. You will receive an instant notification once approved.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              {error && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Merchant Trading / Business Name
                </label>
                <div className="relative">
                  <Building className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Addis_Fast_FX or Bole_Prime"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Telegram Username (For Order Alerts)
                </label>
                <input
                  type="text"
                  required
                  value={telegramHandle}
                  onChange={(e) => setTelegramHandle(e.target.value)}
                  placeholder="@your_username"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Trading Experience / Platforms
                </label>
                <input
                  type="text"
                  value={tradeExperience}
                  onChange={(e) => setTradeExperience(e.target.value)}
                  placeholder="e.g. Active P2P trader on Binance / Bybit"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Default Payment Terms for Buyers/Sellers
                </label>
                <textarea
                  rows={2}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Payment instructions..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Cloudinary Document Upload */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Proof of Business or Trade History (Cloudinary Upload)
                </label>

                {proofDocumentUrl ? (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-900 text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Document Uploaded</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProofDocumentUrl('')}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-950/40 cursor-pointer transition-colors text-xs font-medium text-slate-600 dark:text-slate-300">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={uploadingDoc}
                    />
                    {uploadingDoc ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    ) : (
                      <Upload className="w-4 h-4 text-slate-400" />
                    )}
                    <span>{uploadingDoc ? 'Uploading to Cloudinary...' : 'Upload Business / Trade License'}</span>
                  </label>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !hasEnoughBalance || uploadingDoc}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-sm"
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
